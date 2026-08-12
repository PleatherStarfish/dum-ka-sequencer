//! CoreMIDI output wrapper.
//!
//! Provides a virtual MIDI output port visible in macOS Audio MIDI Setup —
//! the app's always-alive identity — plus an optional routed copy of the
//! stream to a real CoreMIDI destination the user picks (a hardware
//! interface, an IAC bus, a DAW's virtual input). The `timestamped` feature
//! (default) keeps the mach host-time conversion utilities compiling for the
//! future timestamped-dispatch milestone; it adds no runtime behavior today.

use midir::os::unix::VirtualOutput;
use midir::{MidiOutput as MidirOutput, MidiOutputConnection};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tracing::{debug, warn};

#[cfg(feature = "timestamped")]
mod host_time;
mod synth;

#[cfg(feature = "timestamped")]
pub use host_time::{host_time_now, host_time_to_nanos, nanos_to_host_time};
pub use synth::BuiltinSynth;

#[derive(Debug, Error)]
pub enum MidiError {
    #[error("failed to initialize MIDI output: {0}")]
    Init(String),
    #[error("failed to send MIDI message: {0}")]
    Send(String),
    #[error("failed to connect MIDI destination: {0}")]
    Connect(String),
}

/// A real CoreMIDI destination the routed leg can send to. `id` is midir's
/// port id — on macOS the CoreMIDI `kMIDIPropertyUniqueID`, which is stable
/// across unplug/replug on the same machine — and is the ONLY key used for
/// matching; `name` is display-only (IAC buses can share names).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MidiDestination {
    pub id: String,
    pub name: String,
}

/// One currently-sounding wire note. The transport supplies this snapshot
/// when changing the routed destination so the old routed leg can be silenced
/// before its CoreMIDI connection is closed. `count` preserves overlapping
/// note-on multiplicity for receivers that do not implement CC123.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SoundingNote {
    pub channel: u8,
    pub note: u8,
    pub count: u32,
}

/// Enumerate the CoreMIDI destinations currently present. Uses a throwaway
/// client, so it is callable from any thread; returns an empty list when
/// MIDI is unavailable (bare CI runners) rather than erroring.
pub fn list_destinations() -> Vec<MidiDestination> {
    let Ok(client) = MidirOutput::new("cseq-enum") else {
        return Vec::new();
    };
    client
        .ports()
        .iter()
        .map(|port| MidiDestination {
            id: port.id(),
            name: client
                .port_name(port)
                .unwrap_or_else(|_| "Unknown MIDI destination".to_string()),
        })
        .collect()
}

/// Pure MIDI byte builders. The send methods below (and the transport's
/// dispatch path) use these, so the wire encoding is table-testable without a
/// port (docs/TEST_COVERAGE_PLAN_2026-07.md Phase 3.3).
pub fn note_on_bytes(channel: u8, note: u8, velocity: u8) -> [u8; 3] {
    [0x90 | (channel & 0x0F), note & 0x7F, velocity & 0x7F]
}

pub fn note_off_bytes(channel: u8, note: u8) -> [u8; 3] {
    [0x80 | (channel & 0x0F), note & 0x7F, 0]
}

/// CC 123 = All Notes Off.
pub fn all_notes_off_bytes(channel: u8) -> [u8; 3] {
    [0xB0 | (channel & 0x0F), 123, 0]
}

/// The byte sink the transport's dispatch thread writes to. [`MidiOutput`]
/// (real CoreMIDI) implements it; tests substitute a recording fake so the
/// scheduler's send-side helpers run off-hardware
/// (docs/TEST_COVERAGE_PLAN_2026-07.md Phase 3.2).
pub trait MidiSink {
    fn send_raw(&mut self, bytes: &[u8]) -> Result<(), MidiError>;

    /// Timestamped delivery (mach host time; 0 = now). Sinks without a
    /// scheduled path deliver immediately.
    fn send_at(&mut self, host_time: u64, bytes: &[u8]) -> Result<(), MidiError> {
        let _ = host_time;
        self.send_raw(bytes)
    }

    /// Route a copy of the stream to a real CoreMIDI destination (`None`
    /// disconnects). Sinks without a routing leg accept silently; only the
    /// real [`MidiOutput`] connects.
    fn connect_destination(
        &mut self,
        dest: Option<&MidiDestination>,
        sounding_notes: &[SoundingNote],
    ) -> Result<(), MidiError> {
        let _ = (dest, sounding_notes);
        Ok(())
    }

    /// Rebuild the routed connection even when the destination's stable id is
    /// unchanged. CoreMIDI can recreate an endpoint with the same unique id
    /// after a fast unplug/replug; sinks without a distinct connection object
    /// may use the ordinary connect behavior.
    fn reconnect_destination(
        &mut self,
        dest: Option<&MidiDestination>,
        sounding_notes: &[SoundingNote],
    ) -> Result<(), MidiError> {
        self.connect_destination(dest, sounding_notes)
    }

    fn send_note_on(&mut self, channel: u8, note: u8, velocity: u8) -> Result<(), MidiError> {
        self.send_raw(&note_on_bytes(channel, note, velocity))
    }

    fn send_note_off(&mut self, channel: u8, note: u8) -> Result<(), MidiError> {
        self.send_raw(&note_off_bytes(channel, note))
    }

    fn send_all_notes_off(&mut self, channel: u8) -> Result<(), MidiError> {
        self.send_raw(&all_notes_off_bytes(channel))
    }
}

impl MidiSink for MidiOutput {
    fn send_raw(&mut self, bytes: &[u8]) -> Result<(), MidiError> {
        MidiOutput::send_raw(self, bytes)
    }

    fn connect_destination(
        &mut self,
        dest: Option<&MidiDestination>,
        sounding_notes: &[SoundingNote],
    ) -> Result<(), MidiError> {
        match dest {
            Some(dest) => MidiOutput::connect_destination(self, dest, sounding_notes),
            None => {
                MidiOutput::disconnect_destination(self, sounding_notes);
                Ok(())
            }
        }
    }

    fn reconnect_destination(
        &mut self,
        dest: Option<&MidiDestination>,
        sounding_notes: &[SoundingNote],
    ) -> Result<(), MidiError> {
        match dest {
            Some(dest) => MidiOutput::reconnect_destination(self, dest, sounding_notes),
            None => {
                MidiOutput::disconnect_destination(self, sounding_notes);
                Ok(())
            }
        }
    }
}

pub struct MidiOutput {
    /// The always-alive virtual source — the app's identity in Audio MIDI
    /// Setup. Its send Result is the authoritative one.
    conn: MidiOutputConnection,
    port_name: String,
    /// Parked client for the routed leg. midir's `connect` consumes its
    /// client, so the destination connection needs its own instance; `close`
    /// hands it back for the next connect.
    route_client: Option<MidirOutput>,
    route_conn: Option<MidiOutputConnection>,
    route_dest: Option<MidiDestination>,
    /// Log-throttle latch: warn once when the routed leg starts failing,
    /// debug thereafter, reset on recovery. Route failures never affect the
    /// virtual leg or the returned Result.
    route_failing: bool,
}

impl MidiOutput {
    /// Create a virtual CoreMIDI output port with the given name.
    pub fn new_virtual(port_name: &str) -> Result<Self, MidiError> {
        let midi_out = MidirOutput::new("cseq").map_err(|e| MidiError::Init(e.to_string()))?;
        let conn = midi_out
            .create_virtual(port_name)
            .map_err(|e| MidiError::Init(e.to_string()))?;

        debug!(port = port_name, "virtual MIDI port created");
        Ok(Self {
            conn,
            port_name: port_name.to_string(),
            route_client: None,
            route_conn: None,
            route_dest: None,
            route_failing: false,
        })
    }

    pub fn port_name(&self) -> &str {
        &self.port_name
    }

    /// Connect the routed leg to `dest`, replacing any current destination.
    /// The destination is matched by id only; a missing id is an error and
    /// leaves the output virtual-only.
    pub fn connect_destination(
        &mut self,
        dest: &MidiDestination,
        sounding_notes: &[SoundingNote],
    ) -> Result<(), MidiError> {
        self.connect_destination_inner(dest, sounding_notes, false)
    }

    /// Rebuild the routed connection even when `dest` has the same stable id.
    /// This is reserved for CoreMIDI topology notifications: an endpoint can
    /// disappear and be recreated inside the watcher's debounce window, while
    /// the old connection still looks healthy because no send was attempted.
    pub fn reconnect_destination(
        &mut self,
        dest: &MidiDestination,
        sounding_notes: &[SoundingNote],
    ) -> Result<(), MidiError> {
        self.connect_destination_inner(dest, sounding_notes, true)
    }

    fn connect_destination_inner(
        &mut self,
        dest: &MidiDestination,
        sounding_notes: &[SoundingNote],
        force_reconnect: bool,
    ) -> Result<(), MidiError> {
        let same_destination = self
            .route_dest
            .as_ref()
            .is_some_and(|current| current.id == dest.id);
        // Picker/status reconciliation is frequent. A healthy connection to
        // the requested stable id is already the desired state; only an
        // explicit topology reconciliation may bypass this no-op path.
        if same_destination && !force_reconnect && !self.route_failing {
            self.route_dest = Some(dest.clone());
            return Ok(());
        }

        // Replacing a connection to the SAME stable destination is different
        // from routing A -> B. Do not release its live notes: if the old
        // endpoint is still valid, their eventual queued offs sent through
        // the replacement connection reach the same receiver; if it was
        // unplugged, those notes are already gone. Build the replacement
        // first so a transient connect failure also leaves a healthy old leg
        // usable. A true destination change still takes the release path
        // below, because future offs sent to B cannot silence notes on A.
        if same_destination && self.route_conn.is_some() {
            return self.replace_same_destination_connection(dest);
        }

        self.disconnect_destination(sounding_notes);
        let client = match self.route_client.take() {
            Some(client) => client,
            None => MidirOutput::new("cseq-route").map_err(|e| MidiError::Init(e.to_string()))?,
        };
        let Some(port) = client.find_port_by_id(dest.id.clone()) else {
            self.route_client = Some(client);
            return Err(MidiError::Connect(format!(
                "destination not found: {} (id {})",
                dest.name, dest.id
            )));
        };
        match client.connect(&port, "cseq-route") {
            Ok(conn) => {
                self.route_conn = Some(conn);
                self.route_dest = Some(dest.clone());
                self.route_failing = false;
                debug!(
                    destination = dest.name.as_str(),
                    "MIDI destination connected"
                );
                Ok(())
            }
            Err(err) => {
                // ConnectError consumes the client; recover it so the next
                // attempt does not have to rebuild one.
                let message = err.to_string();
                self.route_client = Some(err.into_inner());
                Err(MidiError::Connect(message))
            }
        }
    }

    fn replace_same_destination_connection(
        &mut self,
        dest: &MidiDestination,
    ) -> Result<(), MidiError> {
        let client = match self.route_client.take() {
            Some(client) => client,
            None => match MidirOutput::new("cseq-route") {
                Ok(client) => client,
                Err(error) => {
                    self.route_failing = true;
                    return Err(MidiError::Init(error.to_string()));
                }
            },
        };
        let Some(port) = client.find_port_by_id(dest.id.clone()) else {
            self.route_client = Some(client);
            self.route_failing = true;
            return Err(MidiError::Connect(format!(
                "destination not found: {} (id {})",
                dest.name, dest.id
            )));
        };
        match client.connect(&port, "cseq-route") {
            Ok(conn) => {
                let old_conn = self.route_conn.replace(conn);
                // The new connection owns its own client. Close the old
                // connection only after the replacement exists, then discard
                // that retired client; the active route remains the sole
                // long-lived routed client.
                if let Some(old_conn) = old_conn {
                    let _old_client = old_conn.close();
                }
                self.route_dest = Some(dest.clone());
                self.route_failing = false;
                debug!(
                    destination = dest.name.as_str(),
                    "MIDI destination reconnected"
                );
                Ok(())
            }
            Err(error) => {
                let message = error.to_string();
                // Preserve the consumed replacement client for the next
                // attempt while leaving the old connection installed.
                self.route_client = Some(error.into_inner());
                self.route_failing = true;
                Err(MidiError::Connect(message))
            }
        }
    }

    /// Drop the routed leg (back to virtual-only), parking the client for
    /// reuse.
    pub fn disconnect_destination(&mut self, sounding_notes: &[SoundingNote]) {
        self.release_routed_notes(sounding_notes);
        if let Some(conn) = self.route_conn.take() {
            self.route_client = Some(conn.close());
        }
        if self.route_dest.take().is_some() {
            debug!("MIDI destination disconnected");
        }
        self.route_failing = false;
    }

    pub fn connected_destination(&self) -> Option<&MidiDestination> {
        self.route_dest.as_ref()
    }

    /// Release only the routed leg. The virtual source must keep sounding:
    /// its already-queued note-offs remain authoritative after a route change.
    fn release_routed_notes(&mut self, sounding_notes: &[SoundingNote]) {
        if self.route_conn.is_none() {
            return;
        }
        for_each_route_release_message(sounding_notes, |bytes| {
            self.send_routed(&bytes);
        });
    }

    fn send_routed(&mut self, bytes: &[u8]) {
        let Some(route) = self.route_conn.as_mut() else {
            return;
        };
        match route.send(bytes) {
            Err(e) if !self.route_failing => {
                self.route_failing = true;
                let name = self
                    .route_dest
                    .as_ref()
                    .map(|d| d.name.as_str())
                    .unwrap_or("");
                warn!(destination = name, error = %e, "routed MIDI send failed; virtual port unaffected");
            }
            Err(e) => debug!(error = %e, "routed MIDI send failed"),
            Ok(()) => {
                if self.route_failing {
                    self.route_failing = false;
                    debug!("routed MIDI send recovered");
                }
            }
        }
    }

    /// Send raw MIDI bytes immediately. The virtual leg's Result is
    /// authoritative; the routed copy logs failures (throttled) and never
    /// breaks playback.
    pub fn send_raw(&mut self, bytes: &[u8]) -> Result<(), MidiError> {
        let result = self
            .conn
            .send(bytes)
            .map_err(|e| MidiError::Send(e.to_string()));
        self.send_routed(bytes);
        result
    }

    pub fn send_note_on(&mut self, channel: u8, note: u8, velocity: u8) -> Result<(), MidiError> {
        self.send_raw(&note_on_bytes(channel, note, velocity))
    }

    pub fn send_note_off(&mut self, channel: u8, note: u8) -> Result<(), MidiError> {
        self.send_raw(&note_off_bytes(channel, note))
    }

    pub fn send_all_notes_off(&mut self, channel: u8) -> Result<(), MidiError> {
        self.send_raw(&all_notes_off_bytes(channel))
    }
}

/// Emit the complete route-local release sequence: explicit counted note-offs
/// first, followed by CC123 on every channel. Keeping this iterator-like seam
/// pure makes multiplicity and ordering testable without CoreMIDI hardware.
fn for_each_route_release_message(sounding_notes: &[SoundingNote], mut send: impl FnMut([u8; 3])) {
    for note in sounding_notes {
        for _ in 0..note.count {
            send(note_off_bytes(note.channel, note.note));
        }
    }
    for channel in 0..16u8 {
        send(all_notes_off_bytes(channel));
    }
}

impl Drop for MidiOutput {
    fn drop(&mut self) {
        // send_raw fans out, so the sweep reaches the routed leg too.
        for ch in 0..16u8 {
            if let Err(e) = self.send_all_notes_off(ch) {
                warn!(channel = ch, error = %e, "failed to send all-notes-off on drop");
            }
        }
    }
}

#[cfg(test)]
mod byte_tests {
    use super::*;

    #[test]
    fn note_on_masks_channel_note_velocity() {
        assert_eq!(note_on_bytes(0, 60, 100), [0x90, 60, 100]);
        assert_eq!(note_on_bytes(15, 127, 127), [0x9F, 127, 127]);
        // Out-of-range inputs mask instead of corrupting the status byte.
        assert_eq!(note_on_bytes(16, 128, 200), [0x90, 0, 72]);
        assert_eq!(note_on_bytes(0xFF, 0xFF, 0xFF), [0x9F, 0x7F, 0x7F]);
    }

    #[test]
    fn note_off_masks_and_zeroes_velocity() {
        assert_eq!(note_off_bytes(2, 64), [0x82, 64, 0]);
        assert_eq!(note_off_bytes(18, 130), [0x82, 2, 0]);
    }

    #[test]
    fn all_notes_off_is_cc_123() {
        assert_eq!(all_notes_off_bytes(0), [0xB0, 123, 0]);
        assert_eq!(all_notes_off_bytes(15), [0xBF, 123, 0]);
        assert_eq!(all_notes_off_bytes(16), [0xB0, 123, 0]);
    }

    #[test]
    fn sink_default_methods_use_the_builders() {
        struct Rec(Vec<Vec<u8>>);
        impl MidiSink for Rec {
            fn send_raw(&mut self, bytes: &[u8]) -> Result<(), MidiError> {
                self.0.push(bytes.to_vec());
                Ok(())
            }
        }
        let mut rec = Rec(Vec::new());
        rec.send_note_on(1, 60, 90).unwrap();
        rec.send_note_off(1, 60).unwrap();
        rec.send_all_notes_off(1).unwrap();
        assert_eq!(
            rec.0,
            vec![vec![0x91, 60, 90], vec![0x81, 60, 0], vec![0xB1, 123, 0]]
        );
    }

    #[test]
    fn sink_connect_destination_defaults_to_accepting_silently() {
        struct Rec;
        impl MidiSink for Rec {
            fn send_raw(&mut self, _bytes: &[u8]) -> Result<(), MidiError> {
                Ok(())
            }
        }
        let mut rec = Rec;
        let dest = MidiDestination {
            id: "42".to_string(),
            name: "Fake".to_string(),
        };
        assert!(rec.connect_destination(Some(&dest), &[]).is_ok());
        assert!(rec.reconnect_destination(Some(&dest), &[]).is_ok());
        assert!(rec.connect_destination(None, &[]).is_ok());
    }

    #[test]
    fn routed_release_honors_note_multiplicity_before_cc123() {
        let sounding = [
            SoundingNote {
                channel: 0,
                note: 60,
                count: 2,
            },
            SoundingNote {
                channel: 3,
                note: 67,
                count: 1,
            },
        ];
        let mut sent = Vec::new();
        for_each_route_release_message(&sounding, |bytes| sent.push(bytes));

        assert_eq!(
            &sent[..3],
            &[
                note_off_bytes(0, 60),
                note_off_bytes(0, 60),
                note_off_bytes(3, 67),
            ]
        );
        assert_eq!(sent.len(), 3 + 16);
        assert_eq!(sent[3], all_notes_off_bytes(0));
        assert_eq!(sent[18], all_notes_off_bytes(15));
    }

    #[test]
    fn destination_serde_is_camel_case() {
        let dest = MidiDestination {
            id: "-673416519".to_string(),
            name: "IAC Driver Bus 1".to_string(),
        };
        let json = serde_json::to_value(&dest).unwrap();
        assert_eq!(json["id"], "-673416519");
        assert_eq!(json["name"], "IAC Driver Bus 1");
        let back: MidiDestination = serde_json::from_value(json).unwrap();
        assert_eq!(back, dest);
    }

    #[test]
    fn list_destinations_never_panics() {
        // On CI without CoreMIDI destinations this is simply empty.
        let _ = list_destinations();
    }
}
