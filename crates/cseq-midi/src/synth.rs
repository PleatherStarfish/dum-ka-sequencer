//! Built-in General MIDI synth using macOS's DLS Synthesizer AudioUnit.
//!
//! This creates an AUGraph: DLS Synth → Default Output, and exposes a
//! `send_midi` method to feed it MIDI events. Used for monitoring/testing
//! without external software.

use std::ptr;

use tracing::{debug, warn};

// ---------------------------------------------------------------------------
// CoreAudio / AudioToolbox FFI
// ---------------------------------------------------------------------------

#[allow(non_upper_case_globals)]
const kAudioUnitType_MusicDevice: u32 = u32::from_be_bytes(*b"aumu");
#[allow(non_upper_case_globals)]
const kAudioUnitSubType_DLSSynth: u32 = u32::from_be_bytes(*b"dls ");
#[allow(non_upper_case_globals)]
const kAudioUnitType_Output: u32 = u32::from_be_bytes(*b"auou");
#[allow(non_upper_case_globals)]
const kAudioUnitSubType_DefaultOutput: u32 = u32::from_be_bytes(*b"def ");
#[allow(non_upper_case_globals)]
const kAudioUnitManufacturer_Apple: u32 = u32::from_be_bytes(*b"appl");

type AUGraph = *mut std::ffi::c_void;
type AUNode = i32;
type AudioUnit = *mut std::ffi::c_void;
type OSStatus = i32;

#[repr(C)]
#[derive(Debug, Clone, Copy)]
struct AudioComponentDescription {
    component_type: u32,
    component_sub_type: u32,
    component_manufacturer: u32,
    component_flags: u32,
    component_flags_mask: u32,
}

#[link(name = "AudioToolbox", kind = "framework")]
extern "C" {
    fn NewAUGraph(graph: *mut AUGraph) -> OSStatus;
    fn AUGraphAddNode(
        graph: AUGraph,
        desc: *const AudioComponentDescription,
        node: *mut AUNode,
    ) -> OSStatus;
    fn AUGraphOpen(graph: AUGraph) -> OSStatus;
    fn AUGraphConnectNodeInput(
        graph: AUGraph,
        src_node: AUNode,
        src_output: u32,
        dst_node: AUNode,
        dst_input: u32,
    ) -> OSStatus;
    fn AUGraphNodeInfo(
        graph: AUGraph,
        node: AUNode,
        desc: *mut AudioComponentDescription,
        unit: *mut AudioUnit,
    ) -> OSStatus;
    fn AUGraphInitialize(graph: AUGraph) -> OSStatus;
    fn AUGraphStart(graph: AUGraph) -> OSStatus;
    fn AUGraphStop(graph: AUGraph) -> OSStatus;
    fn DisposeAUGraph(graph: AUGraph) -> OSStatus;
    fn MusicDeviceMIDIEvent(
        unit: AudioUnit,
        status: u32,
        data1: u32,
        data2: u32,
        offset: u32,
    ) -> OSStatus;
}

// ---------------------------------------------------------------------------
// BuiltinSynth
// ---------------------------------------------------------------------------

/// A built-in General MIDI synthesizer using macOS's DLS AudioUnit.
/// Plays through the default audio output. No external software needed.
pub struct BuiltinSynth {
    graph: AUGraph,
    synth_unit: AudioUnit,
}

// AudioUnit pointers are thread-safe for MusicDeviceMIDIEvent calls.
unsafe impl Send for BuiltinSynth {}

impl BuiltinSynth {
    /// Create and start the built-in synth.
    pub fn new() -> Result<Self, String> {
        unsafe {
            let mut graph: AUGraph = ptr::null_mut();
            check("NewAUGraph", NewAUGraph(&mut graph))?;

            // Add DLS synth node.
            let synth_desc = AudioComponentDescription {
                component_type: kAudioUnitType_MusicDevice,
                component_sub_type: kAudioUnitSubType_DLSSynth,
                component_manufacturer: kAudioUnitManufacturer_Apple,
                component_flags: 0,
                component_flags_mask: 0,
            };
            let mut synth_node: AUNode = 0;
            check(
                "AUGraphAddNode(synth)",
                AUGraphAddNode(graph, &synth_desc, &mut synth_node),
            )?;

            // Add default output node.
            let output_desc = AudioComponentDescription {
                component_type: kAudioUnitType_Output,
                component_sub_type: kAudioUnitSubType_DefaultOutput,
                component_manufacturer: kAudioUnitManufacturer_Apple,
                component_flags: 0,
                component_flags_mask: 0,
            };
            let mut output_node: AUNode = 0;
            check(
                "AUGraphAddNode(output)",
                AUGraphAddNode(graph, &output_desc, &mut output_node),
            )?;

            // Open the graph (instantiates units).
            check("AUGraphOpen", AUGraphOpen(graph))?;

            // Connect synth output 0 → output input 0.
            check(
                "AUGraphConnectNodeInput",
                AUGraphConnectNodeInput(graph, synth_node, 0, output_node, 0),
            )?;

            // Get the synth AudioUnit handle.
            let mut synth_unit: AudioUnit = ptr::null_mut();
            check(
                "AUGraphNodeInfo",
                AUGraphNodeInfo(graph, synth_node, ptr::null_mut(), &mut synth_unit),
            )?;

            // Initialize and start.
            check("AUGraphInitialize", AUGraphInitialize(graph))?;
            check("AUGraphStart", AUGraphStart(graph))?;

            debug!("built-in DLS synth started");
            Ok(Self { graph, synth_unit })
        }
    }

    /// Send a raw MIDI message (1-3 bytes) to the synth.
    pub fn send_midi(&self, bytes: &[u8]) {
        if bytes.is_empty() {
            return;
        }
        let status = bytes[0] as u32;
        let data1 = bytes.get(1).copied().unwrap_or(0) as u32;
        let data2 = bytes.get(2).copied().unwrap_or(0) as u32;

        // Safety: synth_unit is valid while the graph is alive,
        // and MusicDeviceMIDIEvent is documented as thread-safe.
        let result = unsafe { MusicDeviceMIDIEvent(self.synth_unit, status, data1, data2, 0) };
        if result != 0 {
            warn!(status = result, "MusicDeviceMIDIEvent failed");
        }
    }

    /// Select a General MIDI program for a zero-based MIDI channel.
    pub fn send_program_change(&self, channel: u8, program: u8) {
        self.send_midi(&[0xC0 | (channel & 0x0F), program & 0x7F]);
    }

    /// Silence a zero-based MIDI channel on the built-in synth.
    pub fn send_all_notes_off(&self, channel: u8) {
        self.send_midi(&[0xB0 | (channel & 0x0F), 123, 0]);
    }
}

impl Drop for BuiltinSynth {
    fn drop(&mut self) {
        unsafe {
            let _ = AUGraphStop(self.graph);
            let _ = DisposeAUGraph(self.graph);
        }
        debug!("built-in synth stopped");
    }
}

fn check(name: &str, status: OSStatus) -> Result<(), String> {
    if status != 0 {
        Err(format!("{name} failed with OSStatus {status}"))
    } else {
        Ok(())
    }
}
