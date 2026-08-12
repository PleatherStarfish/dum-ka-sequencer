//! Transport and scheduler for MIDI playback.
//!
//! M2: Score-driven playback with immediate MIDI sends.
//! The scheduler realizes upcoming cycles ahead of time, but dispatches each
//! event only once its musical tick is due. Timestamped CoreMIDI delivery is
//! deferred until the MIDI backend exposes it.

use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet, VecDeque};
use std::sync::{Arc, OnceLock};
use std::thread;
use std::time::{Duration, Instant};

use crossbeam_channel::{bounded, Receiver, Sender};
use parking_lot::Mutex;
use rayon::prelude::*;

mod layers;
pub mod trackflow;
use layers::{LogVersions, OverlayVersions, PlaybackLayers};
use thiserror::Error;
use tracing::{debug, error, info, warn};

pub use cseq_midi::{list_destinations as list_midi_destinations, MidiDestination};
use cseq_midi::{note_off_bytes, BuiltinSynth, MidiError, MidiOutput, MidiSink, SoundingNote};
use cseq_model::{
    automation_target_boundary_gati_weight, automation_target_boundary_jathi_weight,
    automation_target_boundary_probability, automation_target_initial_gati_weight,
    automation_target_initial_jathi_weight, automation_target_section_count_weight,
    automation_time_for_cycle_tick, pulse_span_section_index, rhythm_accent_spans, AutomationSet,
    AutomationTime, AutomationValueKind, DurationKind, DurationTree, PulseEvent, PulseSpan,
    PulseSpanKind, Rational, Score, SubdivisionInflection, SubdivisionPolicy, TransformKind,
    ValueSpec, AUTOMATION_TARGET_BEAT_ACCENT_MAX, AUTOMATION_TARGET_BEAT_ACCENT_MIN,
    AUTOMATION_TARGET_JATHI_ACCENT_MAX, AUTOMATION_TARGET_JATHI_ACCENT_MIN,
    AUTOMATION_TARGET_PITCH, AUTOMATION_TARGET_SECTION_ACCENT_MAX,
    AUTOMATION_TARGET_SECTION_ACCENT_MIN, AUTOMATION_TARGET_TEMPO_BPM, AUTOMATION_TARGET_VELOCITY,
};
use cseq_realize::{self, EventKind};
use cseq_rhythm::{
    ChannelHocketSpec, MarkovOrder, RhythmChoiceSource, RhythmSeedMode, RhythmSeedSource,
};
use cseq_transforms::{SwitchSeedReplay, SwitchSeedTrace, SwitchSeedTraceSource};

mod clock;
mod engine;
mod generator;
mod overlay;
mod parallel;
mod rewrite;
mod sections;
mod snapshot;
mod timeline;

pub use clock::*;
pub use engine::*;
pub use generator::*;
pub(crate) use overlay::*;
pub use overlay::{rhythm_span_matra_velocities, RhythmSpanMatraVelocities};
pub use parallel::*;
pub(crate) use rewrite::*;
pub(crate) use sections::*;
pub use snapshot::*;
pub use timeline::*;
