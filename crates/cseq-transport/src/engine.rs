#[allow(unused_imports)]
use crate::*;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

#[derive(Debug, Error)]
pub enum TransportError {
    #[error("MIDI error: {0}")]
    Midi(#[from] MidiError),
    #[error("transport not running")]
    NotRunning,
    #[error("invalid tempo: {0} BPM (must be 20..400)")]
    InvalidTempo(f32),
    #[error("invalid score for transport: {0}")]
    InvalidScore(String),
    #[error("invalid playback config: {0}")]
    InvalidPlaybackConfig(String),
    #[error("MIDI destination error: {0}")]
    MidiRoute(String),
    #[error("realization error: {0}")]
    Realize(String),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SynthChannelMode {
    Melodic,
    Percussion,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SynthChannelProgram {
    /// User-facing MIDI channel number, 1-16.
    pub channel: u8,
    pub mode: SynthChannelMode,
    /// Zero-based General MIDI program number, 0-127.
    pub program: u8,
    /// General MIDI percussion key number, used for built-in synth monitoring
    /// when `mode` is percussion.
    pub drum_note: u8,
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

pub(crate) struct TransportShared {
    pub(crate) tempo_bpm: f32,
    pub(crate) is_playing: bool,
    pub(crate) current_tick: u64,
    pub(crate) current_cycle: u64,
    pub(crate) ticks_per_cycle: u64,
    pub(crate) current_score_id: Option<String>,
    pub(crate) parallel_track_positions: Vec<ParallelTrackPosition>,
    /// All playback metadata layers; lifecycle lives in `layers.rs`.
    pub(crate) layers: PlaybackLayers,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct SynthChannelVoice {
    mode: SynthChannelMode,
    program: u8,
    drum_note: u8,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct SynthMonitorEvent {
    /// Dedicated built-in synth bus for the user-facing channel, 1-16.
    bus_channel: u8,
    user_channel: u8,
    voice: SynthChannelVoice,
    bytes: [u8; 3],
    len: usize,
}

pub(crate) struct BuiltinSynthMonitor {
    buses: Vec<BuiltinSynth>,
}

/// When a config-change command takes effect during playback.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ApplyQuantize {
    /// Rebuild the runtime and reapply immediately (the pre-P1 behavior). Used
    /// when stopped, and for a structural change that cannot be applied forward
    /// (e.g. a reference-grid change). While stopped, `NextCycle` behaves the same.
    #[default]
    Immediate,
    /// Apply to the *running* runtime in place (P1): only per-track and global
    /// parameters change, all realization cursors and generative state are kept,
    /// so the edit takes effect at the next un-realized cycle with no queue clear
    /// and no replay-from-zero. Stateless-per-cycle domains stay continuous;
    /// History-mode seed pools on a changed track re-roll from their authored
    /// baseline (the documented "seeds are a discontinuity" caveat).
    NextCycle,
}

pub(crate) enum TransportCommand {
    // These UI-facing commands acknowledge only after the scheduler publishes
    // its new shared snapshot. `send()` alone merely proves that a command was
    // queued; treating that as completion lets stale transport state race the
    // interaction that issued it.
    Play(Sender<()>),
    Stop(Sender<()>),
    Resync(Sender<()>),
    /// Silence everything now (explicit note-offs + CC123 sweep + synth)
    /// WITHOUT stopping the transport: playback and realization continue.
    Panic(Sender<()>),
    /// Route a copy of the output stream to a real CoreMIDI destination
    /// (`None` = back to virtual-only). Acks the connect Result directly —
    /// it carries a payload, unlike the snapshot-gated acks above.
    ConnectMidiDestination {
        dest: Option<MidiDestination>,
        force_reconnect: bool,
        ack: Sender<Result<(), String>>,
    },
    SetTempo(f32, Sender<()>),
    SetScore(Box<Score>, ApplyQuantize),
    SetRhythmPlayback(Option<Box<RhythmPlaybackConfig>>, ApplyQuantize),
    SetParallelPlayback(Option<Box<ParallelPlaybackConfig>>, ApplyQuantize),
    SetSynthPrograms(Vec<SynthChannelProgram>),
    EnableSynth,
    DisableSynth,
    /// Finish the scheduler's silence sweep, drop its MIDI sink, then ack.
    /// The public shutdown path also joins the scheduler before returning.
    Shutdown(Sender<()>),
}

pub(crate) fn wire_channel_to_user_channel(channel: u8) -> u8 {
    (channel & 0x0F) + 1
}

pub(crate) fn user_channel_to_wire_channel(channel: u8) -> u8 {
    channel.clamp(1, 16) - 1
}

pub(crate) fn synth_channel_mode_label(mode: SynthChannelMode) -> &'static str {
    match mode {
        SynthChannelMode::Melodic => "melodic",
        SynthChannelMode::Percussion => "percussion",
    }
}

pub(crate) fn synth_monitor_bus_label(bus_channel: u8) -> String {
    format!("userChannel{}", bus_channel.clamp(1, 16))
}

pub(crate) fn pop_due_event(
    queue: &mut VecDeque<QueuedEvent>,
    dispatch_horizon: u64,
) -> Option<QueuedEvent> {
    if queue
        .front()
        .is_some_and(|event| event.absolute_tick <= dispatch_horizon)
    {
        queue.pop_front()
    } else {
        None
    }
}

pub(crate) fn discard_stale_events_before_tick(
    queue: &mut VecDeque<QueuedEvent>,
    cutoff_tick: u64,
) -> usize {
    let mut discarded = 0;
    while queue
        .front()
        .is_some_and(|event| event.absolute_tick < cutoff_tick)
    {
        queue.pop_front();
        discarded += 1;
    }
    discarded
}

/// Apply a `SetTempo(bpm)` to a parallel runtime. Updates the runtime's
/// `reference_tempo_bpm` (the clamped `bpm`) so the reference clock — and hence
/// the effective dispatch rate and the snapshot tempo, both of which read
/// `project.reference_tempo_bpm` — actually changes. Returns `true` iff the
/// realization grid changed and the queue was requeued.
///
/// The parallel reference tick grid is `reference_cycle_beats * PPQN`, which is
/// independent of tempo. A pure tempo command therefore cannot change what
/// parallel realization produces, so it must leave the queue and realization
/// cursor untouched — clearing the queue here (the pre-P0.1 behavior) stranded
/// the note-offs of every sounding note and re-dispatched the already-played
/// current cycle. The `tpc` guard is defensive: a pure tempo change never trips
/// it, but should a caller ever route a grid change through here the correct
/// requeue still happens.
pub(crate) fn apply_parallel_tempo_change(
    project: &mut ParallelRuntimeConfig,
    event_queue: &mut VecDeque<QueuedEvent>,
    parallel_realized_until_tick: &mut u64,
    bpm: f32,
    tpc_before: u64,
    tpc_after: u64,
) -> bool {
    project.reference_tempo_bpm = bpm.clamp(20.0, 400.0);
    if tpc_before == tpc_after {
        return false;
    }
    project.reset_realization();
    event_queue.clear();
    *parallel_realized_until_tick = 0;
    true
}

pub(crate) fn describe_midi_message(
    bytes: &[u8],
) -> (Option<u8>, &'static str, Option<u8>, Option<u8>) {
    let Some(status) = bytes.first().copied() else {
        return (None, "empty", None, None);
    };

    let channel = if status < 0xF0 {
        Some(wire_channel_to_user_channel(status))
    } else {
        None
    };
    let data1 = bytes.get(1).copied();
    let data2 = bytes.get(2).copied();
    let message_type = match status & 0xF0 {
        0x80 => "noteOff",
        0x90 if data2 == Some(0) => "noteOff",
        0x90 => "noteOn",
        0xA0 => "polyPressure",
        0xB0 => "controlChange",
        0xC0 => "programChange",
        0xD0 => "channelPressure",
        0xE0 => "pitchBend",
        _ => "system",
    };

    (channel, message_type, data1, data2)
}

pub(crate) fn record_midi_debug_event(
    shared: &Arc<Mutex<TransportShared>>,
    absolute_tick: u64,
    ticks_per_cycle: u64,
    bytes: &[u8],
    debug_source: Option<&str>,
) {
    let (channel, message_type, data1, data2) = describe_midi_message(bytes);
    record_midi_debug_event_inner(
        shared,
        absolute_tick,
        ticks_per_cycle,
        channel,
        message_type,
        data1,
        data2,
        bytes,
        debug_source,
        None,
        None,
        None,
        None,
    );
}

pub(crate) fn record_queued_midi_debug_event(
    shared: &Arc<Mutex<TransportShared>>,
    event: &QueuedEvent,
    ticks_per_cycle: u64,
    monitor_event: Option<&SynthMonitorEvent>,
) {
    let (wire_channel, message_type, data1, data2) = describe_midi_message(event.as_bytes());
    record_midi_debug_event_inner(
        shared,
        event.absolute_tick,
        ticks_per_cycle,
        event.user_channel.or(wire_channel),
        message_type,
        data1,
        data2,
        event.as_bytes(),
        Some("queued dispatch"),
        monitor_event,
        event.parallel_track_id.as_deref(),
        event.parallel_track_name.as_deref(),
        event.parallel_conflict.as_ref(),
    );
}

/// Record one realized cycle's playback metadata. The single entry point
/// shared by every scheduler realize site; see `PlaybackLayers::record_cycle`.
pub(crate) fn record_cycle_playback_events(
    shared: &Arc<Mutex<TransportShared>>,
    events: CyclePlaybackEvents,
    ticks_per_cycle: u64,
) {
    shared.lock().layers.record_cycle(events, ticks_per_cycle);
}

/// Reset all realized playback metadata for a (re)started run; see
/// `PlaybackLayers::clear_realized` (debug logs persist by design).
pub(crate) fn clear_realized_playback_layers(shared: &Arc<Mutex<TransportShared>>) {
    shared.lock().layers.clear_realized();
}

#[cfg(test)]
pub(crate) fn take_due_events_for_immediate_dispatch(
    queue: &mut VecDeque<QueuedEvent>,
    abs_tick: u64,
) -> Vec<QueuedEvent> {
    let mut due = Vec::new();
    while queue
        .front()
        .is_some_and(|event| event.absolute_tick <= abs_tick)
    {
        if let Some(event) = queue.pop_front() {
            due.push(event);
        }
    }
    due
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn record_midi_debug_event_inner(
    shared: &Arc<Mutex<TransportShared>>,
    absolute_tick: u64,
    ticks_per_cycle: u64,
    channel: Option<u8>,
    message_type: &'static str,
    data1: Option<u8>,
    data2: Option<u8>,
    bytes: &[u8],
    debug_source: Option<&str>,
    monitor_event: Option<&SynthMonitorEvent>,
    parallel_track_id: Option<&str>,
    parallel_track_name: Option<&str>,
    parallel_conflict: Option<&ParallelConflictMetadata>,
) {
    let (cycle, tick_in_cycle) = match ticks_per_cycle {
        0 => (0, absolute_tick),
        ticks => (absolute_tick / ticks, absolute_tick % ticks),
    };

    let mut state = shared.lock();
    let event = MidiDebugEvent {
        sequence: state.layers.midi_debug.take_sequence(),
        absolute_tick,
        cycle,
        tick_in_cycle,
        channel,
        message_type: message_type.to_string(),
        data1,
        data2,
        bytes: bytes.to_vec(),
        debug_source: debug_source.map(str::to_string),
        monitor_bus: monitor_event.map(|event| synth_monitor_bus_label(event.bus_channel)),
        monitor_user_channel: monitor_event.map(|event| event.user_channel),
        monitor_mode: monitor_event
            .map(|event| synth_channel_mode_label(event.voice.mode).to_string()),
        monitor_program: monitor_event.map(|event| event.voice.program),
        monitor_drum_note: monitor_event.map(|event| event.voice.drum_note),
        monitor_bytes: monitor_event.map(|event| event.bytes[..event.len].to_vec()),
        parallel_track_id: parallel_track_id.map(str::to_string),
        parallel_track_name: parallel_track_name.map(str::to_string),
        parallel_conflict_policy: parallel_conflict.map(|metadata| metadata.policy.clone()),
        parallel_conflict_action: parallel_conflict.map(|metadata| metadata.action.clone()),
        parallel_conflict_group_id: parallel_conflict.map(|metadata| metadata.group_id.clone()),
    };
    state.layers.midi_debug.push(event);
}

pub(crate) fn send_all_notes_off_logged(
    midi: &mut impl MidiSink,
    shared: &Arc<Mutex<TransportShared>>,
    absolute_tick: u64,
    ticks_per_cycle: u64,
    debug_source: &'static str,
) {
    for ch in 0..16u8 {
        if let Err(e) = midi.send_all_notes_off(ch) {
            warn!(channel = ch, error = %e, "all-notes-off failed");
        } else {
            let bytes = [0xB0 | (ch & 0x0F), 123, 0];
            record_midi_debug_event(
                shared,
                absolute_tick,
                ticks_per_cycle,
                &bytes,
                Some(debug_source),
            );
        }
    }
}

/// Send one explicit note-off for every dispatched note-on represented by the
/// ledger. Some MIDI receivers ignore CC123 and count overlapping note-ons, so
/// one message per key is insufficient when a key's multiplicity is greater
/// than one. This helper intentionally does not mutate the ledger; callers
/// clear it only after the complete explicit-off + CC123 sequence.
pub(crate) fn send_active_note_offs_logged(
    active_notes: &HashMap<(u8, u8), u32>,
    midi: &mut impl MidiSink,
    shared: &Arc<Mutex<TransportShared>>,
    absolute_tick: u64,
    ticks_per_cycle: u64,
    debug_source: &'static str,
) {
    let mut sounding: Vec<((u8, u8), u32)> = active_notes
        .iter()
        .map(|(&key, &count)| (key, count))
        .collect();
    sounding.sort_unstable_by_key(|&((channel, pitch), _)| (channel, pitch));
    for ((channel, pitch), count) in sounding {
        let bytes = note_off_bytes(channel, pitch);
        for _ in 0..count {
            if let Err(e) = midi.send_raw(&bytes) {
                warn!(channel, pitch, error = %e, "explicit note-off failed");
            } else {
                record_midi_debug_event(
                    shared,
                    absolute_tick,
                    ticks_per_cycle,
                    &bytes,
                    Some(debug_source),
                );
            }
        }
    }
}

/// Whether MIDI bytes are a note-off (status 0x80, or 0x90 with velocity 0).
pub(crate) fn is_note_off(bytes: &[u8]) -> bool {
    matches!(bytes.first().map(|b| b & 0xF0), Some(0x80))
        || (bytes.first().map(|b| b & 0xF0) == Some(0x90) && bytes.get(2) == Some(&0))
}

/// Whether MIDI bytes are a note-on (status 0x90 with velocity > 0).
pub(crate) fn is_note_on(bytes: &[u8]) -> bool {
    bytes.first().map(|b| b & 0xF0) == Some(0x90) && bytes.get(2).is_some_and(|&v| v != 0)
}

/// Update the active-note ledger for a dispatched event: a note-on increments the
/// `(wire channel, pitch)` count, a note-off decrements it (removing at zero).
/// The ledger is the record of what is *currently sounding*, so a config swap can
/// release only the notes the new stream will not close (S3) instead of chopping
/// all audio.
pub(crate) fn ledger_record_dispatch(active_notes: &mut HashMap<(u8, u8), u32>, bytes: &[u8]) {
    let (Some(&status), Some(&pitch)) = (bytes.first(), bytes.get(1)) else {
        return;
    };
    let key = (status & 0x0F, pitch);
    if is_note_on(bytes) {
        *active_notes.entry(key).or_insert(0) += 1;
    } else if is_note_off(bytes) {
        if let Some(count) = active_notes.get_mut(&key) {
            *count = count.saturating_sub(1);
            if *count == 0 {
                active_notes.remove(&key);
            }
        }
    }
}

pub(crate) fn sounding_notes_snapshot(active_notes: &HashMap<(u8, u8), u32>) -> Vec<SoundingNote> {
    let mut sounding_notes: Vec<SoundingNote> = active_notes
        .iter()
        .map(|(&(channel, note), &count)| SoundingNote {
            channel,
            note,
            count,
        })
        .collect();
    sounding_notes.sort_unstable_by_key(|note| (note.channel, note.note));
    sounding_notes
}

/// Given the notes currently sounding and the freshly re-realized queue, return
/// the `(wire channel, pitch)` pairs that must be released now because the new
/// stream will not close them: the first matching event at/after `swap_tick` is a
/// note-on (a new note that would collide with the sounding one) or there is
/// none. Notes the new queue *will* close (their note-off is the next matching
/// event) keep ringing across the swap.
///
/// Bound: only the realized lookahead (~2 cycles) is visible, so a note whose
/// note-off lies further out is treated as an orphan and released — safe (never a
/// stuck note), and typical rhythmic notes are sub-cycle so this is rare.
pub(crate) fn orphaned_active_notes(
    active_notes: &HashMap<(u8, u8), u32>,
    queue: &VecDeque<QueuedEvent>,
    swap_tick: u64,
) -> Vec<(u8, u8)> {
    let mut orphans: Vec<(u8, u8)> = active_notes
        .keys()
        .copied()
        .filter(|&(channel, pitch)| {
            let closed_by_new_stream = queue
                .iter()
                .filter(|event| event.absolute_tick >= swap_tick)
                .find(|event| {
                    let bytes = event.as_bytes();
                    (bytes[0] & 0x0F) == channel
                        && bytes.get(1) == Some(&pitch)
                        && (is_note_on(bytes) || is_note_off(bytes))
                })
                .is_some_and(|event| is_note_off(event.as_bytes()));
            !closed_by_new_stream
        })
        .collect();
    orphans.sort_unstable();
    orphans
}

/// Defense in depth for the hung-note class: a sounding note is PROVABLY
/// stuck when the dispatch ledger plus the undispatched queue can never
/// balance for its `(wire channel, pitch)`. Note-offs enter the queue in the
/// same realize batch as their note-ons and afterwards only move forward
/// (`defer_premature_same_pitch_note_offs`) or leave group-atomically with
/// their on (conflict suppression), so a positive residue cannot be closed by
/// any later window. Long ties are never flagged — their offs are already
/// queued. Since the 2026-07-07 stranded-off fix this should never fire; a
/// hit is a new engine bug being contained, not a tolerable steady state.
pub(crate) fn stuck_note_residue(
    active_notes: &HashMap<(u8, u8), u32>,
    queue: &VecDeque<QueuedEvent>,
) -> Vec<(u8, u8)> {
    if active_notes.is_empty() {
        return Vec::new();
    }
    let mut residue: HashMap<(u8, u8), i64> = active_notes
        .iter()
        .map(|(&key, &count)| (key, i64::from(count)))
        .collect();
    for event in queue {
        let bytes = event.as_bytes();
        let Some(pitch) = note_pitch(event) else {
            continue;
        };
        let key = (bytes[0] & 0x0F, pitch);
        if !residue.contains_key(&key) {
            continue;
        }
        if is_note_off(bytes) {
            *residue.entry(key).or_default() -= 1;
        } else if is_note_on(bytes) {
            *residue.entry(key).or_default() += 1;
        }
    }
    let mut stuck: Vec<(u8, u8)> = residue
        .into_iter()
        .filter(|&(_, count)| count > 0)
        .map(|(key, _)| key)
        .collect();
    stuck.sort_unstable();
    stuck
}

/// Send an immediate note-off to the MIDI output and the built-in synth monitor
/// for each orphaned note, drop them from the ledger, and log them under
/// `reason` (MIDI debug label). This is the targeted replacement for a blanket
/// all-notes-off on a config swap: everything not listed keeps ringing.
#[allow(clippy::too_many_arguments)]
pub(crate) fn release_orphan_notes(
    orphans: &[(u8, u8)],
    reason: &'static str,
    midi: &mut impl MidiSink,
    synth: Option<&BuiltinSynthMonitor>,
    synth_programs: &[SynthChannelVoice; 16],
    shared: &Arc<Mutex<TransportShared>>,
    absolute_tick: u64,
    ticks_per_cycle: u64,
    active_notes: &mut HashMap<(u8, u8), u32>,
) {
    for &(channel, pitch) in orphans {
        let bytes = [0x80 | (channel & 0x0F), pitch, 0];
        if let Err(e) = midi.send_raw(&bytes) {
            warn!(channel, pitch, error = %e, "orphan note-off failed");
            continue;
        }
        record_midi_debug_event(shared, absolute_tick, ticks_per_cycle, &bytes, Some(reason));
        if let Some(synth) = synth {
            let user_channel = wire_channel_to_user_channel(channel);
            if let Some(event) = synth_monitor_event(&bytes, Some(user_channel), synth_programs) {
                synth.send_monitor_event(&event);
            }
        }
        active_notes.remove(&(channel, pitch));
    }
}

pub(crate) fn default_synth_voices() -> [SynthChannelVoice; 16] {
    std::array::from_fn(|index| SynthChannelVoice {
        mode: SynthChannelMode::Melodic,
        program: DEFAULT_SYNTH_PROGRAMS[index],
        drum_note: DEFAULT_SYNTH_DRUM_NOTES[index],
    })
}

pub(crate) fn normalized_synth_programs(
    programs: &[SynthChannelProgram],
) -> [SynthChannelVoice; 16] {
    let mut normalized = default_synth_voices();
    for assignment in programs {
        let channel_index = assignment.channel.clamp(1, 16) - 1;
        normalized[channel_index as usize] = SynthChannelVoice {
            mode: assignment.mode,
            program: assignment.program.min(127),
            drum_note: assignment.drum_note.min(127),
        };
    }
    normalized
}

impl BuiltinSynthMonitor {
    fn new(voices: &[SynthChannelVoice; 16]) -> Result<Self, String> {
        let mut buses = Vec::with_capacity(16);
        for _ in 0..16 {
            buses.push(BuiltinSynth::new()?);
        }
        let monitor = Self { buses };
        monitor.apply_programs(voices);
        Ok(monitor)
    }

    fn apply_programs(&self, voices: &[SynthChannelVoice; 16]) {
        for (index, synth) in self.buses.iter().enumerate() {
            send_synth_all_notes_off(synth);
            let voice = voices[index];
            match voice.mode {
                SynthChannelMode::Melodic => {
                    synth.send_program_change(0, voice.program);
                }
                SynthChannelMode::Percussion => {
                    synth.send_program_change(GM_PERCUSSION_CHANNEL_INDEX, 0);
                }
            }
        }
    }

    fn send_monitor_event(&self, event: &SynthMonitorEvent) {
        if let Some(synth) = self
            .buses
            .get((event.bus_channel.saturating_sub(1)) as usize)
        {
            synth.send_midi(&event.bytes[..event.len]);
        }
    }

    fn all_notes_off(&self) {
        for synth in &self.buses {
            send_synth_all_notes_off(synth);
        }
    }
}

pub(crate) fn send_synth_all_notes_off(synth: &BuiltinSynth) {
    for channel in 0..16u8 {
        synth.send_all_notes_off(channel);
    }
}

pub(crate) fn synth_monitor_event_for_queued_event(
    event: &QueuedEvent,
    voices: &[SynthChannelVoice; 16],
) -> Option<SynthMonitorEvent> {
    synth_monitor_event(event.as_bytes(), event.user_channel, voices)
}

pub(crate) fn synth_monitor_event(
    bytes: &[u8],
    user_channel: Option<u8>,
    voices: &[SynthChannelVoice; 16],
) -> Option<SynthMonitorEvent> {
    if bytes.is_empty() {
        return None;
    }

    let len = bytes.len().min(3);
    let mut mapped = [0u8; 3];
    mapped[..len].copy_from_slice(&bytes[..len]);

    let status = mapped[0];
    let message = status & 0xF0;
    let user_channel = user_channel
        .or_else(|| (status < 0xF0).then_some(wire_channel_to_user_channel(status)))?
        .clamp(1, 16);
    let channel_index = (user_channel - 1) as usize;
    let voice = voices[channel_index];
    if status < 0xF0 {
        match voice.mode {
            SynthChannelMode::Melodic => {
                mapped[0] = message;
            }
            SynthChannelMode::Percussion => {
                if (message == 0x80 || message == 0x90) && len >= 2 {
                    mapped[0] = message | GM_PERCUSSION_CHANNEL_INDEX;
                    mapped[1] = voice.drum_note.min(127);
                } else {
                    mapped[0] = message | GM_PERCUSSION_CHANNEL_INDEX;
                }
            }
        }
    }

    Some(SynthMonitorEvent {
        bus_channel: user_channel,
        user_channel,
        voice,
        bytes: mapped,
        len,
    })
}

// ---------------------------------------------------------------------------
// Transport handle
// ---------------------------------------------------------------------------

pub struct Transport {
    pub(crate) shared: Arc<Mutex<TransportShared>>,
    pub(crate) cmd_tx: Sender<TransportCommand>,
    pub(crate) thread: Mutex<Option<thread::JoinHandle<()>>>,
    /// `OnceLock::get_or_init` is both the shutdown state and the waiter: one
    /// caller performs the acknowledged command + join while concurrent Arc
    /// holders block until that same result is published.
    pub(crate) shutdown_result: OnceLock<Result<(), ()>>,
}

impl Transport {
    /// Start the transport with a virtual MIDI port.
    pub fn start(midi_port_name: &str) -> Result<Self, TransportError> {
        let midi = MidiOutput::new_virtual(midi_port_name)?;

        let shared = Arc::new(Mutex::new(TransportShared {
            tempo_bpm: 80.0,
            is_playing: false,
            current_tick: 0,
            current_cycle: 0,
            ticks_per_cycle: 0,
            current_score_id: None,
            parallel_track_positions: Vec::new(),
            layers: PlaybackLayers::default(),
        }));

        let (cmd_tx, cmd_rx) = bounded::<TransportCommand>(64);
        let shared_clone = shared.clone();

        let thread = thread::Builder::new()
            .name("cseq-scheduler".to_string())
            .spawn(move || {
                scheduler_loop(midi, shared_clone, cmd_rx);
            })
            .expect("failed to spawn scheduler thread");

        info!("transport started");

        Ok(Self {
            shared,
            cmd_tx,
            thread: Mutex::new(Some(thread)),
            shutdown_result: OnceLock::new(),
        })
    }

    fn send_acknowledged(
        &self,
        command: impl FnOnce(Sender<()>) -> TransportCommand,
    ) -> Result<(), TransportError> {
        let (ack_tx, ack_rx) = bounded(1);
        self.cmd_tx
            .send(command(ack_tx))
            .map_err(|_| TransportError::NotRunning)?;
        ack_rx.recv().map_err(|_| TransportError::NotRunning)
    }

    pub fn play(&self) -> Result<(), TransportError> {
        self.send_acknowledged(TransportCommand::Play)
    }

    pub fn stop(&self) -> Result<(), TransportError> {
        self.send_acknowledged(TransportCommand::Stop)
    }

    pub fn resync(&self) -> Result<(), TransportError> {
        self.send_acknowledged(TransportCommand::Resync)
    }

    /// Silence all sounding notes (explicit offs + CC123 sweep + synth)
    /// without stopping playback.
    pub fn panic(&self) -> Result<(), TransportError> {
        self.send_acknowledged(TransportCommand::Panic)
    }

    /// Route a copy of the MIDI stream to a real CoreMIDI destination, or
    /// back to virtual-only with `None`. The virtual source stays alive
    /// either way.
    pub fn connect_midi_destination(
        &self,
        dest: Option<MidiDestination>,
    ) -> Result<(), TransportError> {
        self.request_midi_destination(dest, false)
    }

    /// Rebuild the physical route even when its stable destination id is
    /// unchanged. The hot-plug watcher uses this after a topology notification
    /// because an unplug/replug may be fully coalesced before reconciliation.
    /// Ordinary picker/status refreshes should use `connect_midi_destination`
    /// so they do not interrupt healthy sustained notes.
    pub fn reconnect_midi_destination(
        &self,
        dest: Option<MidiDestination>,
    ) -> Result<(), TransportError> {
        self.request_midi_destination(dest, true)
    }

    fn request_midi_destination(
        &self,
        dest: Option<MidiDestination>,
        force_reconnect: bool,
    ) -> Result<(), TransportError> {
        let (ack_tx, ack_rx) = bounded(1);
        self.cmd_tx
            .send(TransportCommand::ConnectMidiDestination {
                dest,
                force_reconnect,
                ack: ack_tx,
            })
            .map_err(|_| TransportError::NotRunning)?;
        ack_rx
            .recv()
            .map_err(|_| TransportError::NotRunning)?
            .map_err(TransportError::MidiRoute)
    }

    pub fn set_tempo(&self, bpm: f32) -> Result<(), TransportError> {
        if !(20.0..=400.0).contains(&bpm) {
            return Err(TransportError::InvalidTempo(bpm));
        }
        self.send_acknowledged(|ack| TransportCommand::SetTempo(bpm, ack))
    }

    /// Set the Score to play. Takes effect at the next cycle boundary.
    pub fn set_score(&self, score: Score, apply: ApplyQuantize) -> Result<(), TransportError> {
        validate_score_for_transport(&score).map_err(TransportError::InvalidScore)?;
        self.cmd_tx
            .send(TransportCommand::SetScore(Box::new(score), apply))
            .map_err(|_| TransportError::NotRunning)
    }

    /// Enable or disable rhythm playback. This is intentionally separate from
    /// the Rhythm Engine editor UI; the editor can be closed while playback
    /// continues to use the last configured chains.
    pub fn set_rhythm_playback(
        &self,
        config: Option<RhythmPlaybackConfig>,
        apply: ApplyQuantize,
    ) -> Result<(), TransportError> {
        if let Some(config) = config.as_ref() {
            validate_rhythm_playback_config(config)
                .map_err(TransportError::InvalidPlaybackConfig)?;
        }
        self.cmd_tx
            .send(TransportCommand::SetRhythmPlayback(
                config.map(Box::new),
                apply,
            ))
            .map_err(|_| TransportError::NotRunning)
    }

    pub fn set_parallel_playback(
        &self,
        config: Option<ParallelPlaybackConfig>,
        apply: ApplyQuantize,
    ) -> Result<(), TransportError> {
        if let Some(config) = config.as_ref() {
            validate_parallel_playback_config(config)
                .map_err(TransportError::InvalidPlaybackConfig)?;
        }
        self.cmd_tx
            .send(TransportCommand::SetParallelPlayback(
                config.map(Box::new),
                apply,
            ))
            .map_err(|_| TransportError::NotRunning)
    }

    /// Set the built-in synth's per-channel General MIDI programs. This only
    /// affects the local monitor synth, not the virtual MIDI output port.
    pub fn set_synth_programs(
        &self,
        programs: Vec<SynthChannelProgram>,
    ) -> Result<(), TransportError> {
        self.cmd_tx
            .send(TransportCommand::SetSynthPrograms(programs))
            .map_err(|_| TransportError::NotRunning)
    }

    /// Enable the built-in DLS synth for audio monitoring.
    pub fn enable_synth(&self) -> Result<(), TransportError> {
        self.cmd_tx
            .send(TransportCommand::EnableSynth)
            .map_err(|_| TransportError::NotRunning)
    }

    /// Disable the built-in synth.
    pub fn disable_synth(&self) -> Result<(), TransportError> {
        self.cmd_tx
            .send(TransportCommand::DisableSynth)
            .map_err(|_| TransportError::NotRunning)
    }

    pub fn snapshot(&self) -> TransportSnapshot {
        let s = self.shared.lock();
        TransportSnapshot {
            tempo_bpm: s.tempo_bpm,
            is_playing: s.is_playing,
            current_tick: s.current_tick,
            current_cycle: s.current_cycle,
            ticks_per_cycle: s.ticks_per_cycle,
            current_score_id: s.current_score_id.clone(),
            parallel_track_positions: s.parallel_track_positions.clone(),
            midi_debug_events: s.layers.midi_debug.to_vec(),
            automation_events: s.layers.automation.to_vec(),
            channel_hocket_events: s.layers.channel_hocket.to_vec(),
            seed_trace_events: s.layers.seed_trace.to_vec(),
            parallel_conflict_events: s.layers.parallel_conflict.to_vec(),
            trigger_decision_events: s.layers.trigger_decision.to_vec(),
            realized_rhythm_events: s.layers.realized_rhythm.to_vec(),
            track_flow_events: s.layers.track_flow.to_vec(),
        }
    }

    /// Take one atomic telemetry read under a single lock. Always returns the
    /// current position; clones the timeline layers only when their digest
    /// differs from `previous_timeline` (or `force`), and the log layers only
    /// when the selected log subset differs from `previous_log` (or `force`).
    /// This is the sole 60Hz read path — it never clones a layer it does not
    /// need to send.
    pub fn sample_telemetry(
        &self,
        previous_timeline: Option<&TimelineDigest>,
        previous_log: Option<&LogDigest>,
        log_interest: TelemetryLogInterest,
        force: bool,
    ) -> TelemetrySample {
        let s = self.shared.lock();

        let position = TransportPositionSample {
            tempo_bpm: s.tempo_bpm,
            is_playing: s.is_playing,
            current_tick: s.current_tick,
            current_cycle: s.current_cycle,
            ticks_per_cycle: s.ticks_per_cycle,
            current_score_id: s.current_score_id.clone(),
            parallel_track_positions: s.parallel_track_positions.clone(),
        };

        let layer_digest = s.layers.digest();
        let timeline_digest = TimelineDigest {
            is_playing: s.is_playing,
            current_cycle: s.current_cycle,
            ticks_per_cycle: s.ticks_per_cycle,
            tempo_bits: s.tempo_bpm.to_bits(),
            current_score_id: s.current_score_id.clone(),
            parallel_coarse: s
                .parallel_track_positions
                .iter()
                .map(|p| ParallelTrackCoarse {
                    track_id: p.track_id.clone(),
                    cycle: p.cycle,
                    ticks_per_cycle: p.ticks_per_cycle,
                    reference_start_tick: p.reference_start_tick,
                    reference_end_tick: p.reference_end_tick,
                })
                .collect(),
            overlay_versions: layer_digest.overlay_versions,
        };
        let log_digest = LogDigest {
            log_versions: match log_interest {
                TelemetryLogInterest::None => LogVersions {
                    midi_debug: 0,
                    automation: 0,
                    seed_trace: 0,
                    parallel_conflict: 0,
                    trigger_decision: 0,
                },
                TelemetryLogInterest::SeedTrace => LogVersions {
                    midi_debug: 0,
                    automation: 0,
                    seed_trace: layer_digest.log_versions.seed_trace,
                    parallel_conflict: 0,
                    trigger_decision: 0,
                },
                TelemetryLogInterest::Trigger => LogVersions {
                    midi_debug: 0,
                    automation: 0,
                    seed_trace: 0,
                    parallel_conflict: 0,
                    trigger_decision: layer_digest.log_versions.trigger_decision,
                },
                TelemetryLogInterest::SeedTraceAndTrigger => LogVersions {
                    midi_debug: 0,
                    automation: 0,
                    seed_trace: layer_digest.log_versions.seed_trace,
                    parallel_conflict: 0,
                    trigger_decision: layer_digest.log_versions.trigger_decision,
                },
                TelemetryLogInterest::Full => layer_digest.log_versions,
            },
        };

        let timeline_changed = force || previous_timeline != Some(&timeline_digest);
        let timeline_layers = timeline_changed.then(|| TimelineLayers {
            channel_hocket_events: s.layers.channel_hocket.to_vec(),
            realized_rhythm_events: s.layers.realized_rhythm.to_vec(),
            track_flow_events: s.layers.track_flow.to_vec(),
        });

        let log_changed = force || previous_log != Some(&log_digest);
        let log_layers = (log_interest != TelemetryLogInterest::None && log_changed).then(|| {
            let full = log_interest == TelemetryLogInterest::Full;
            let seed_trace = matches!(
                log_interest,
                TelemetryLogInterest::SeedTrace
                    | TelemetryLogInterest::SeedTraceAndTrigger
                    | TelemetryLogInterest::Full
            );
            let trigger = matches!(
                log_interest,
                TelemetryLogInterest::Trigger
                    | TelemetryLogInterest::SeedTraceAndTrigger
                    | TelemetryLogInterest::Full
            );
            LogLayers {
                midi_debug_events: if full {
                    s.layers.midi_debug.to_vec()
                } else {
                    Vec::new()
                },
                automation_events: if full {
                    s.layers.automation.to_vec()
                } else {
                    Vec::new()
                },
                seed_trace_events: if seed_trace {
                    s.layers.seed_trace.to_vec()
                } else {
                    Vec::new()
                },
                parallel_conflict_events: if full {
                    s.layers.parallel_conflict.to_vec()
                } else {
                    Vec::new()
                },
                trigger_decision_events: if trigger {
                    s.layers.trigger_decision.to_vec()
                } else {
                    Vec::new()
                },
            }
        });

        TelemetrySample {
            position,
            timeline_digest,
            log_digest,
            timeline_layers,
            log_layers,
        }
    }

    /// Silence and stop the scheduler, waiting until the MIDI sink has been
    /// dropped and the scheduler thread has exited. This works through
    /// `&Transport`, so an `Arc<Transport>` owner can guarantee shutdown even
    /// while other Arc clones still exist. Concurrent and repeated calls wait
    /// for, then reuse, the same completion result.
    pub fn shutdown_now(&self) -> Result<(), TransportError> {
        let result = self.shutdown_result.get_or_init(|| {
            let (ack_tx, ack_rx) = bounded(1);
            let command_completed = self
                .cmd_tx
                .send(TransportCommand::Shutdown(ack_tx))
                .map_err(|_| ())
                .and_then(|()| ack_rx.recv().map_err(|_| ()))
                .is_ok();
            let thread_completed = self
                .thread
                .lock()
                .take()
                .map_or(true, |handle| handle.join().is_ok());
            if command_completed && thread_completed {
                Ok(())
            } else {
                Err(())
            }
        });
        if result.is_ok() {
            Ok(())
        } else {
            Err(TransportError::NotRunning)
        }
    }

    /// Consuming compatibility wrapper. Prefer [`Self::shutdown_now`] when
    /// the transport is held in an `Arc`.
    pub fn shutdown(self) {
        let _ = self.shutdown_now();
    }
}

impl Drop for Transport {
    fn drop(&mut self) {
        let _ = self.shutdown_now();
    }
}

// ---------------------------------------------------------------------------
// Scheduler loop
// ---------------------------------------------------------------------------

pub(crate) fn scheduler_loop(
    mut midi: impl MidiSink,
    shared: Arc<Mutex<TransportShared>>,
    cmd_rx: Receiver<TransportCommand>,
) {
    let mut is_playing = false;
    let mut base_tempo_bpm: f32 = 80.0;
    let mut effective_tempo_bpm: f32 = 80.0;
    let mut score: Option<Score> = None;
    let mut rhythm_request_config: Option<RhythmPlaybackConfig> = None;
    let mut rhythm_config: Option<RhythmPlaybackConfig> = None;
    let mut parallel_config: Option<ParallelRuntimeConfig> = None;
    let mut tpc: u64 = 0; // ticks per cycle
    let mut synth: Option<BuiltinSynthMonitor> = None;
    let mut synth_programs = default_synth_voices();

    // Playback state — valid only while playing.
    let mut fractional_ticks: f64 = 0.0;
    let mut last_instant: Instant = Instant::now();
    let mut cycle: u64 = 0;
    let mut tick_in_cycle: u64 = 0;
    let mut event_queue: VecDeque<QueuedEvent> = VecDeque::new();
    let mut realized_up_to_cycle: u64 = 0; // exclusive: cycles [0, realized_up_to_cycle) are in the queue
    let mut parallel_realized_until_tick: u64 = 0;
    let mut discard_queued_before_tick: Option<u64> = None;
    // Active-note ledger (S3/P2): what is currently sounding, so a config swap
    // releases only orphaned notes instead of chopping all audio. `(wire channel,
    // pitch) -> count`, maintained at dispatch. `pending_note_sweep` carries the
    // swap tick from a reapply command to the sweep that runs after the new queue
    // is re-realized (same loop iteration, after discard, before dispatch).
    let mut active_notes: HashMap<(u8, u8), u32> = HashMap::new();
    let mut pending_note_sweep: Option<u64> = None;
    let mut last_automation_log_key: Option<(u64, u32)> = None;

    loop {
        // UI-facing command completion is published after the shared snapshot
        // update below, never merely after receipt from the channel.
        let mut command_acks = Vec::new();
        // Drain commands (non-blocking).
        while let Ok(cmd) = cmd_rx.try_recv() {
            match cmd {
                TransportCommand::Play(ack) => {
                    if !is_playing {
                        is_playing = true;
                        cycle = 0;
                        tick_in_cycle = 0;
                        fractional_ticks = 0.0;
                        let now = Instant::now();
                        last_instant = now;
                        event_queue.clear();
                        active_notes.clear();
                        pending_note_sweep = None;
                        last_automation_log_key = None;
                        clear_realized_playback_layers(&shared);
                        realized_up_to_cycle = 0;
                        parallel_realized_until_tick = 0;

                        if let Some(project) = parallel_config.as_mut() {
                            project.reset_realization();
                            tpc = project.reference_ticks_per_cycle();
                            effective_tempo_bpm = project.reference_tempo_bpm;
                            // First window realizes from tick 0 — nothing dispatched
                            // yet, so the R9 guard is inert here.
                            project.dispatch_horizon_tick = 0;
                            match realize_parallel_until(project, tpc, &mut event_queue) {
                                Ok(playback_events) => {
                                    record_cycle_playback_events(&shared, playback_events, tpc);
                                    parallel_realized_until_tick = tpc;
                                    debug!(
                                        tpc,
                                        tracks = project.tracks.len(),
                                        queued_events = event_queue.len(),
                                        "pre-realized parallel playback window"
                                    );
                                }
                                Err(e) => {
                                    error!(error = %e, "failed to realize parallel playback");
                                }
                            }
                        // Pre-realize the first cycle if we have a score.
                        } else if let Some(s) = &mut score {
                            tpc = ticks_per_cycle(s);
                            effective_tempo_bpm = transport_tempo_bpm_for_cycle_start(
                                s,
                                rhythm_config.as_ref(),
                                0,
                                base_tempo_bpm,
                            );
                            match realize_and_enqueue_with_time(
                                s,
                                0,
                                0,
                                &mut event_queue,
                                rhythm_config.as_mut(),
                                None,
                            ) {
                                Ok(playback_events) => {
                                    record_cycle_playback_events(&shared, playback_events, tpc);
                                    realized_up_to_cycle = 1;
                                    debug!(
                                        tpc,
                                        queued_events = event_queue.len(),
                                        "pre-realized cycle 0"
                                    );
                                }
                                Err(e) => {
                                    error!(error = %e, "failed to realize cycle 0");
                                }
                            }
                        } else {
                            effective_tempo_bpm = base_tempo_bpm;
                            debug!("play with no score loaded");
                        }

                        debug!("play");
                    }
                    command_acks.push(ack);
                }
                TransportCommand::Stop(ack) => {
                    if is_playing {
                        is_playing = false;
                        event_queue.clear();
                        last_automation_log_key = None;
                        clear_realized_playback_layers(&shared);
                        let current_abs_tick =
                            cycle.saturating_mul(tpc).saturating_add(tick_in_cycle);
                        send_all_notes_off_logged(
                            &mut midi,
                            &shared,
                            current_abs_tick,
                            tpc,
                            "transport stop",
                        );
                        if let Some(s) = &synth {
                            s.all_notes_off();
                        }
                        // Stop silences everything, so the ledger is empty and any
                        // deferred sweep is moot.
                        active_notes.clear();
                        pending_note_sweep = None;
                        effective_tempo_bpm = parallel_config
                            .as_ref()
                            .map_or(base_tempo_bpm, |project| project.reference_tempo_bpm);
                        debug!("stop");
                    }
                    command_acks.push(ack);
                }
                TransportCommand::Panic(ack) => {
                    let current_abs_tick = cycle.saturating_mul(tpc).saturating_add(tick_in_cycle);
                    // Explicit per-note offs first — they cover receivers that
                    // ignore CC123. Queued note-offs for these notes dispatch
                    // later as harmless duplicates (a note-off on a silent
                    // note is a no-op, and the ledger tolerates decrements of
                    // absent keys), so the queue and watermarks stay untouched
                    // and playback continues.
                    send_active_note_offs_logged(
                        &active_notes,
                        &mut midi,
                        &shared,
                        current_abs_tick,
                        tpc,
                        "midi panic",
                    );
                    send_all_notes_off_logged(
                        &mut midi,
                        &shared,
                        current_abs_tick,
                        tpc,
                        "midi panic",
                    );
                    if let Some(s) = &synth {
                        s.all_notes_off();
                    }
                    active_notes.clear();
                    debug!("midi panic");
                    command_acks.push(ack);
                }
                TransportCommand::ConnectMidiDestination {
                    dest,
                    force_reconnect,
                    ack,
                } => {
                    let sounding_notes = sounding_notes_snapshot(&active_notes);
                    let result = if force_reconnect {
                        midi.reconnect_destination(dest.as_ref(), &sounding_notes)
                    } else {
                        midi.connect_destination(dest.as_ref(), &sounding_notes)
                    }
                    .map_err(|e| e.to_string());
                    if let Err(error) = &result {
                        warn!(error = %error, "MIDI destination connect failed");
                    }
                    let _ = ack.send(result);
                }
                TransportCommand::Resync(ack) => {
                    if is_playing {
                        event_queue.clear();
                        last_automation_log_key = None;
                        clear_realized_playback_layers(&shared);
                        realized_up_to_cycle = cycle;
                        if let Some(project) = parallel_config.as_mut() {
                            project.reset_realization();
                        }
                        parallel_realized_until_tick = 0;
                        let current_abs_tick =
                            cycle.saturating_mul(tpc).saturating_add(tick_in_cycle);
                        discard_queued_before_tick = Some(current_abs_tick);
                        // Release only orphaned notes after re-realize (S3).
                        pending_note_sweep = Some(current_abs_tick);
                        debug!(tick = current_abs_tick, "transport resync");
                    } else {
                        event_queue.clear();
                        last_automation_log_key = None;
                        clear_realized_playback_layers(&shared);
                        realized_up_to_cycle = cycle;
                        if let Some(project) = parallel_config.as_mut() {
                            project.reset_realization();
                        }
                        parallel_realized_until_tick = 0;
                        debug!("transport resync while stopped");
                    }
                    command_acks.push(ack);
                }
                TransportCommand::SetTempo(bpm, ack) => {
                    // Establish a new reference point so tick computation
                    // is continuous across the tempo change.
                    let mut playback_abs_tick = None;
                    if is_playing {
                        let now = Instant::now();
                        let elapsed = now.duration_since(last_instant);
                        let tps = (effective_tempo_bpm as f64 / 60.0) * PPQN as f64;
                        fractional_ticks += elapsed.as_secs_f64() * tps;
                        let new_ticks = fractional_ticks as u64;
                        fractional_ticks -= new_ticks as f64;
                        let abs_tick =
                            absolute_tick(cycle, tpc, tick_in_cycle).saturating_add(new_ticks);

                        last_instant = now;
                        playback_abs_tick = Some(abs_tick);

                        // Recompute cycle/tick position.
                        if tpc > 0 {
                            cycle = abs_tick / tpc;
                            tick_in_cycle = abs_tick % tpc;
                        }
                    }
                    base_tempo_bpm = bpm;
                    if let Some(project) = parallel_config.as_mut() {
                        let tpc_before = tpc;
                        tpc = project.reference_ticks_per_cycle();
                        // Parallel tempo is continuous (P0.1): drive the reference
                        // clock to the new BPM so the dispatch rate actually changes,
                        // but do NOT requeue. The reference grid
                        // (`reference_cycle_beats * PPQN`) is BPM-independent, so the
                        // command cannot change what realization produces; requeueing
                        // would strand sounding notes' offs and re-dispatch the current
                        // cycle. The requeue happens only if the grid genuinely changed.
                        apply_parallel_tempo_change(
                            project,
                            &mut event_queue,
                            &mut parallel_realized_until_tick,
                            bpm,
                            tpc_before,
                            tpc,
                        );
                        // Read AFTER the update so the effective clock and the
                        // snapshot (`s.tempo_bpm`, also `reference_tempo_bpm`) reflect
                        // the new tempo immediately.
                        effective_tempo_bpm = project.reference_tempo_bpm;
                        if is_playing && tpc > 0 {
                            if let Some(abs_tick) = playback_abs_tick {
                                cycle = abs_tick / tpc;
                                tick_in_cycle = abs_tick % tpc;
                            }
                        }
                    } else {
                        effective_tempo_bpm = score.as_ref().map_or(base_tempo_bpm, |s| {
                            transport_tempo_bpm_for_tick(
                                s,
                                rhythm_config.as_ref(),
                                cycle,
                                tick_in_cycle,
                                tpc,
                                base_tempo_bpm,
                            )
                        });
                    }
                    last_automation_log_key = None;
                    debug!(bpm, "tempo changed");
                    command_acks.push(ack);
                }
                // Single-track `NextCycle` (seamless, no all-notes-off) is P2; P1
                // keeps the immediate reapply for the single-track path.
                TransportCommand::SetScore(new_score, _apply) => {
                    let old_tpc = tpc;
                    let new_tpc = ticks_per_cycle(&new_score);
                    let score_id = new_score.id.clone();
                    tpc = new_tpc;
                    score = Some(*new_score);
                    parallel_config = None;
                    parallel_realized_until_tick = 0;

                    // If playing, apply the new score from the current playback
                    // position. Already-sent MIDI cannot be recalled, but
                    // clearing the queued future keeps audio and timeline
                    // aligned from the next scheduler tick.
                    if is_playing {
                        if old_tpc > 0 && old_tpc != new_tpc {
                            let phase = tick_in_cycle as f64 / old_tpc as f64;
                            tick_in_cycle = (phase * new_tpc as f64).round() as u64;
                            if tick_in_cycle >= new_tpc {
                                tick_in_cycle = new_tpc.saturating_sub(1);
                            }
                        }

                        event_queue.clear();
                        last_automation_log_key = None;
                        clear_realized_playback_layers(&shared);
                        realized_up_to_cycle = cycle;
                        let current_abs_tick =
                            cycle.saturating_mul(tpc).saturating_add(tick_in_cycle);
                        discard_queued_before_tick = Some(current_abs_tick);
                        // Release only orphaned notes after re-realize (S3).
                        pending_note_sweep = Some(current_abs_tick);
                    }

                    {
                        let mut s = shared.lock();
                        s.current_score_id = Some(score_id.clone());
                        s.ticks_per_cycle = tpc;
                    }
                    debug!(score = score_id, "score set");
                }
                TransportCommand::SetRhythmPlayback(config, _apply) => {
                    let next_config = config.map(|boxed| *boxed);
                    if rhythm_request_config == next_config {
                        debug!(
                            enabled = rhythm_config.is_some(),
                            "rhythm playback command ignored because config is unchanged"
                        );
                        continue;
                    }

                    rhythm_request_config = next_config.clone();
                    rhythm_config = next_config;
                    parallel_config = None;
                    parallel_realized_until_tick = 0;

                    if is_playing {
                        event_queue.clear();
                        last_automation_log_key = None;
                        clear_realized_playback_layers(&shared);
                        realized_up_to_cycle = cycle;
                        let current_abs_tick =
                            cycle.saturating_mul(tpc).saturating_add(tick_in_cycle);
                        discard_queued_before_tick = Some(current_abs_tick);
                        // Release only orphaned notes after re-realize (S3).
                        pending_note_sweep = Some(current_abs_tick);
                    }

                    debug!(enabled = rhythm_config.is_some(), "rhythm playback changed");
                }
                TransportCommand::SetParallelPlayback(config, apply) => {
                    let incoming = config.map(|boxed| *boxed);

                    // P1: while a parallel runtime is playing, a `NextCycle` apply
                    // mutates it in place (forward-from-position, no replay) — the
                    // edit lands at the next un-realized cycle with no queue clear
                    // and no stuck notes. It falls back to rebuild only for a
                    // stopped transport or an `Immediate` apply. A mid-play config
                    // that cannot be applied forward (topology or reference-grid
                    // change — the FE never sends one, see runtime-mode pinning and
                    // Tier D locks) is rejected: the running runtime keeps playing.
                    let mut applied_in_place = false;
                    if apply == ApplyQuantize::NextCycle && is_playing {
                        // A running parallel runtime + a non-null config: apply the
                        // parameter edit forward in place. (No running parallel
                        // runtime, or disengaging, falls through to rebuild below.)
                        if let (Some(project), Some(new_config)) =
                            (parallel_config.as_mut(), incoming.as_ref())
                        {
                            if project.apply_in_place(new_config) {
                                effective_tempo_bpm = project.reference_tempo_bpm;
                                applied_in_place = true;
                            } else {
                                warn!(
                                    "rejected mid-play parallel apply: topology or \
                                     reference-grid change cannot be applied forward"
                                );
                                // Keep the running runtime; ignore the command.
                                continue;
                            }
                        }
                    }

                    if applied_in_place {
                        let mut s = shared.lock();
                        s.current_score_id = parallel_config
                            .as_ref()
                            .map(|project| format!("parallel:{}", project.tracks.len()));
                        s.ticks_per_cycle = tpc;
                        debug!("parallel playback applied in place (P1 NextCycle)");
                        continue;
                    }

                    let old_tpc = tpc;
                    parallel_config = incoming.map(ParallelRuntimeConfig::from_config);
                    if let Some(project) = parallel_config.as_mut() {
                        project.reset_realization();
                        tpc = project.reference_ticks_per_cycle();
                        effective_tempo_bpm = project.reference_tempo_bpm;
                    } else {
                        tpc = score.as_ref().map_or(0, ticks_per_cycle);
                        effective_tempo_bpm = score.as_ref().map_or(base_tempo_bpm, |s| {
                            transport_tempo_bpm_for_tick(
                                s,
                                rhythm_config.as_ref(),
                                cycle,
                                tick_in_cycle,
                                tpc,
                                base_tempo_bpm,
                            )
                        });
                    }
                    parallel_realized_until_tick = 0;

                    if is_playing {
                        if old_tpc > 0 && tpc > 0 && old_tpc != tpc {
                            let phase = tick_in_cycle as f64 / old_tpc as f64;
                            tick_in_cycle = (phase * tpc as f64).round() as u64;
                            if tick_in_cycle >= tpc {
                                tick_in_cycle = tpc.saturating_sub(1);
                            }
                        }
                        event_queue.clear();
                        last_automation_log_key = None;
                        clear_realized_playback_layers(&shared);
                        realized_up_to_cycle = cycle;
                        let current_abs_tick =
                            cycle.saturating_mul(tpc).saturating_add(tick_in_cycle);
                        discard_queued_before_tick = Some(current_abs_tick);
                        // Release only orphaned notes after re-realize (S3).
                        pending_note_sweep = Some(current_abs_tick);
                    }

                    {
                        let mut s = shared.lock();
                        s.current_score_id = parallel_config
                            .as_ref()
                            .map(|project| format!("parallel:{}", project.tracks.len()))
                            .or_else(|| score.as_ref().map(|score| score.id.clone()));
                        s.ticks_per_cycle = tpc;
                    }
                    debug!(
                        enabled = parallel_config.is_some(),
                        tracks = parallel_config
                            .as_ref()
                            .map_or(0, |project| project.tracks.len()),
                        "parallel playback changed"
                    );
                }
                TransportCommand::SetSynthPrograms(programs) => {
                    let next_programs = normalized_synth_programs(&programs);
                    if next_programs == synth_programs {
                        debug!("built-in synth programs unchanged");
                        continue;
                    }

                    synth_programs = next_programs;
                    if is_playing {
                        event_queue.clear();
                        clear_realized_playback_layers(&shared);
                        realized_up_to_cycle = cycle;
                        parallel_realized_until_tick = 0;
                        if let Some(project) = parallel_config.as_mut() {
                            project.reset_realization();
                        }
                        let current_abs_tick =
                            cycle.saturating_mul(tpc).saturating_add(tick_in_cycle);
                        discard_queued_before_tick = Some(current_abs_tick);
                        // A monitor-only change re-realizes the identical musical
                        // config, so the sweep finds no orphans — fully seamless (S3).
                        pending_note_sweep = Some(current_abs_tick);
                    }
                    if let Some(s) = &synth {
                        s.apply_programs(&synth_programs);
                    }
                    debug!("built-in synth programs changed");
                }
                TransportCommand::EnableSynth => {
                    if synth.is_none() {
                        match BuiltinSynthMonitor::new(&synth_programs) {
                            Ok(s) => {
                                synth = Some(s);
                                info!("built-in synth enabled");
                            }
                            Err(e) => {
                                error!(error = %e, "failed to start built-in synth");
                            }
                        }
                    }
                }
                TransportCommand::DisableSynth => {
                    if let Some(s) = synth.take() {
                        s.all_notes_off();
                        info!("built-in synth disabled");
                    }
                }
                TransportCommand::Shutdown(ack) => {
                    let current_abs_tick = cycle.saturating_mul(tpc).saturating_add(tick_in_cycle);
                    send_active_note_offs_logged(
                        &active_notes,
                        &mut midi,
                        &shared,
                        current_abs_tick,
                        tpc,
                        "transport shutdown",
                    );
                    send_all_notes_off_logged(
                        &mut midi,
                        &shared,
                        current_abs_tick,
                        tpc,
                        "transport shutdown",
                    );
                    if let Some(s) = &synth {
                        s.all_notes_off();
                    }
                    info!("scheduler shutting down");
                    // Do not strand an already-processed caller if shutdown was
                    // queued behind it. Normal operation publishes first below;
                    // shutdown is the only early-return path.
                    for ack in command_acks.drain(..) {
                        let _ = ack.send(());
                    }
                    // Drop the MIDI sink before acknowledging shutdown so an
                    // Exit handler waiting through Arc ownership cannot race
                    // the backend's own final all-notes-off/drop work.
                    drop(midi);
                    let _ = ack.send(());
                    return;
                }
            }
        }

        if is_playing && (score.is_some() || parallel_config.is_some()) && tpc > 0 {
            let now = Instant::now();
            let elapsed = now.duration_since(last_instant);
            last_instant = now;

            // Advance tick position.
            let tps = (effective_tempo_bpm as f64 / 60.0) * PPQN as f64;
            fractional_ticks += elapsed.as_secs_f64() * tps;
            let new_ticks = fractional_ticks as u64;
            fractional_ticks -= new_ticks as f64;

            let abs_tick = absolute_tick(cycle, tpc, tick_in_cycle).saturating_add(new_ticks);
            cycle = abs_tick / tpc;
            tick_in_cycle = abs_tick % tpc;

            if let Some(project) = parallel_config.as_ref() {
                effective_tempo_bpm = project.reference_tempo_bpm;
            } else if let Some(s) = score.as_ref() {
                effective_tempo_bpm = transport_tempo_bpm_for_tick(
                    s,
                    rhythm_config.as_ref(),
                    cycle,
                    tick_in_cycle,
                    tpc,
                    base_tempo_bpm,
                );
                if let Some(key) =
                    current_automation_log_key(s, rhythm_config.as_ref(), cycle, tick_in_cycle, tpc)
                {
                    if last_automation_log_key != Some(key) {
                        record_current_automation_state(
                            &shared,
                            s,
                            rhythm_config.as_ref(),
                            cycle,
                            key.1,
                            tick_in_cycle,
                        );
                        last_automation_log_key = Some(key);
                    }
                }
            }

            let realize_watermark_before = (parallel_realized_until_tick, realized_up_to_cycle);
            if let Some(project) = parallel_config.as_mut() {
                let target_tick = cycle.saturating_add(2).saturating_mul(tpc);
                // Tell the conflict pass how far playback has advanced so it never
                // re-resolves an already-dispatched component (R9 guard).
                project.dispatch_horizon_tick = abs_tick;
                if parallel_realized_until_tick < target_tick {
                    match realize_parallel_until(project, target_tick, &mut event_queue) {
                        Ok(playback_events) => {
                            record_cycle_playback_events(&shared, playback_events, tpc);
                            parallel_realized_until_tick = target_tick;
                        }
                        Err(e) => {
                            error!(
                                target_tick,
                                error = %e,
                                "failed to realize parallel playback window"
                            );
                        }
                    }
                }
            // Ensure we've realized enough cycles ahead.
            } else {
                let target_cycle = cycle.saturating_add(2); // always stay 2 cycles ahead
                while realized_up_to_cycle < target_cycle {
                    if let Some(s) = &mut score {
                        let cycle_base = realized_up_to_cycle.saturating_mul(tpc);
                        match realize_and_enqueue_with_time(
                            s,
                            realized_up_to_cycle,
                            cycle_base,
                            &mut event_queue,
                            rhythm_config.as_mut(),
                            None,
                        ) {
                            Ok(playback_events) => {
                                record_cycle_playback_events(&shared, playback_events, tpc);
                            }
                            Err(e) => {
                                error!(
                                    cycle = realized_up_to_cycle,
                                    error = %e,
                                    "failed to realize cycle"
                                );
                                break;
                            }
                        }
                    }
                    realized_up_to_cycle += 1;
                }
            }
            if let Some(cutoff_tick) = discard_queued_before_tick.take() {
                let discarded = discard_stale_events_before_tick(&mut event_queue, cutoff_tick);
                debug!(
                    cutoff_tick,
                    discarded, "discarded stale queued events after transport reapply"
                );
            }
            // Seamless swap (S3): now that the new config is re-realized into the
            // queue, release only the sounding notes it will not close, leaving
            // everything else ringing across the edit (vs. a blanket all-notes-off).
            if let Some(swap_tick) = pending_note_sweep.take() {
                let orphans = orphaned_active_notes(&active_notes, &event_queue, swap_tick);
                release_orphan_notes(
                    &orphans,
                    "swap orphan note-off",
                    &mut midi,
                    synth.as_ref(),
                    &synth_programs,
                    &shared,
                    swap_tick,
                    tpc,
                    &mut active_notes,
                );
            }
            // Defense in depth against the hung-note class: any sounding note
            // the ledger + queue can never balance is provably stuck (see
            // stuck_note_residue) — release it now instead of letting it ring
            // until stop. Runs only when a new window entered the queue (the
            // only time the balance can change outside dispatch). Silent in a
            // healthy engine; a hit is a regression being contained and is
            // logged loudly for exactly that reason.
            let stuck = if (parallel_realized_until_tick, realized_up_to_cycle)
                != realize_watermark_before
            {
                stuck_note_residue(&active_notes, &event_queue)
            } else {
                Vec::new()
            };
            if !stuck.is_empty() {
                warn!(
                    ?stuck,
                    "releasing provably-stuck notes (queue/ledger imbalance — engine bug)"
                );
                release_orphan_notes(
                    &stuck,
                    "stuck-note sweep note-off",
                    &mut midi,
                    synth.as_ref(),
                    &synth_programs,
                    &shared,
                    abs_tick,
                    tpc,
                    &mut active_notes,
                );
            }
            // Dispatch due events only. Future MIDI is not sent early because
            // the current output APIs play immediately rather than honoring
            // deferred timestamps. Late events are still dispatched instead of
            // being dropped, which protects dense and fast passages
            // from silently losing notes.
            let dispatch_horizon = abs_tick;
            let npt = nanos_per_tick(effective_tempo_bpm);

            while let Some(event) = pop_due_event(&mut event_queue, dispatch_horizon) {
                let ticks_late = abs_tick.saturating_sub(event.absolute_tick);
                let lateness_ms = (ticks_late as f64 * npt) / 1_000_000.0;

                // M2: send immediately via midir's connection (the port the
                // user has routed). The scheduler loop's tight timing (~2ms)
                // keeps jitter low. True timestamped sends through the same
                // port require bypassing midir - deferred to a future milestone.
                debug!(
                    tick = event.absolute_tick,
                    lateness_ms,
                    msg = ?event.as_bytes(),
                    "dispatching MIDI event"
                );
                debug_assert!(event.user_channel_matches_wire());
                let bytes = event.as_bytes();
                let monitor_event = synth_monitor_event_for_queued_event(&event, &synth_programs);
                if let Err(e) = midi.send_raw(bytes) {
                    warn!(error = %e, "send failed");
                } else {
                    record_queued_midi_debug_event(&shared, &event, tpc, monitor_event.as_ref());
                }
                // Track what is sounding so a later config swap can release only
                // orphaned notes (S3), not all audio.
                ledger_record_dispatch(&mut active_notes, bytes);
                if let (Some(s), Some(monitor_event)) = (&synth, monitor_event.as_ref()) {
                    s.send_monitor_event(monitor_event);
                }
            }

            // Update shared state.
            {
                let mut s = shared.lock();
                s.is_playing = true;
                s.tempo_bpm = parallel_config
                    .as_ref()
                    .map_or(base_tempo_bpm, |project| project.reference_tempo_bpm);
                s.current_tick = tick_in_cycle;
                s.current_cycle = cycle;
                s.parallel_track_positions = parallel_config
                    .as_ref()
                    .map_or_else(Vec::new, |project| project.track_positions(abs_tick));
                if parallel_config.is_none() {
                    // Policy-driven prune for every CycleWindow layer.
                    s.layers.retain_window(cycle);
                }
            }
        } else if is_playing {
            // Playing but no score — just track time for the UI.
            effective_tempo_bpm = base_tempo_bpm;
            let mut s = shared.lock();
            s.is_playing = true;
            s.tempo_bpm = effective_tempo_bpm;
            s.parallel_track_positions.clear();
        } else {
            effective_tempo_bpm = parallel_config
                .as_ref()
                .map_or(base_tempo_bpm, |project| project.reference_tempo_bpm);
            let mut s = shared.lock();
            s.is_playing = false;
            s.tempo_bpm = effective_tempo_bpm;
            s.parallel_track_positions.clear();
        }

        for ack in command_acks.drain(..) {
            let _ = ack.send(());
        }

        thread::sleep(Duration::from_millis(2));
    }
}

#[cfg(test)]
mod tests;
