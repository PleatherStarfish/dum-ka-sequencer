/**
 * The built-in synth properties modal: per-channel voice mode/program/drum-note table with presets.
 * Extracted from App.tsx (carve-up round 20) along the panel seam — all
 * state stays in App and arrives via props with their original names (types
 * compiler-generated via scripts/carve/typegen.cjs); the JSX body is
 * unchanged.
 */
import {
  SynthChannelMode,
  SynthChannelProgram,
} from "../bridge";
import {
  DEFAULT_SYNTH_VOICES,
  cloneSynthVoices,
  normalizeSynthMode,
} from "../patchIo";
import {
  GM_PERCUSSION_NOTES,
  GM_PROGRAM_NAMES,
  SYNTH_VOICE_PRESETS,
  synthDrumLabel,
  synthProgramLabel,
} from "../synthVoices";
import {
  timelineChannelColor,
} from "../timelineModel";
import {
  ModalFrame,
  ModalHeader,
} from "./ModalChrome";

export interface SynthPropertiesModalProps {
  applySynthPreset: (voices: SynthChannelProgram[]) => void;
  channelHocketEnabled: boolean;
  channelHocketMatrixChannels: number[];
  midiOutputChannel: number;
  setSynthPrograms: React.Dispatch<React.SetStateAction<SynthChannelProgram[]>>;
  setSynthPropertiesOpen: React.Dispatch<React.SetStateAction<boolean>>;
  synthEnabled: boolean;
  synthMelodicCount: number;
  synthPercussionCount: number;
  synthProgramRequest: SynthChannelProgram[];
  synthPropertiesOpen: boolean;
  updateSynthDrumNote: (channel: number, drumNote: number) => void;
  updateSynthMode: (channel: number, mode: SynthChannelMode) => void;
  updateSynthProgram: (channel: number, program: number) => void;
}

export function SynthPropertiesModal({
  applySynthPreset,
  channelHocketEnabled,
  channelHocketMatrixChannels,
  midiOutputChannel,
  setSynthPrograms,
  setSynthPropertiesOpen,
  synthEnabled,
  synthMelodicCount,
  synthPercussionCount,
  synthProgramRequest,
  synthPropertiesOpen,
  updateSynthDrumNote,
  updateSynthMode,
  updateSynthProgram,
}: SynthPropertiesModalProps) {
  return (
      <ModalFrame
        open={synthPropertiesOpen}
        onClose={() => setSynthPropertiesOpen(false)}
        ariaLabelledby="synth-properties-title"
        className="synth-properties-backdrop"
        layer="utility"
        size="wide"
        surfaceClassName="synth-properties-dialog"
      >
        {({ close }) => (
          <>
            <ModalHeader
              className="synth-properties-head"
              title="Built-in Synth Properties"
              titleId="synth-properties-title"
              eyebrow={
                <>
                  {synthEnabled ? "monitor on" : "monitor off"} ·{" "}
                  {channelHocketEnabled
                    ? `${channelHocketMatrixChannels.length} hocket channels`
                    : `output ch ${midiOutputChannel}`}{" "}
                  · {synthMelodicCount} melodic / {synthPercussionCount} percussion
                </>
              }
              closeLabel="Close Built-in Synth Properties"
              onClose={close}
            />

            <div className="synth-preset-strip" aria-label="Built-in synth presets">
              {SYNTH_VOICE_PRESETS.map((preset) => (
                <button
                  className="tiny-button"
                  key={preset.id}
                  type="button"
                  title={preset.description}
                  onClick={() => applySynthPreset(preset.voices)}
                >
                  {preset.label}
                </button>
              ))}
            </div>

            <div className="synth-program-grid">
              {synthProgramRequest.map((voice) => (
                <div className={`synth-program-row is-${voice.mode}`} key={voice.channel}>
                  <span
                    className="channel-chip"
                    style={{ backgroundColor: timelineChannelColor(voice.channel) }}
                  >
                    Ch {voice.channel}
                  </span>
                  <div className="synth-voice-controls">
                    <select
                      aria-label={`Channel ${voice.channel} synth type`}
                      className="synth-mode-select"
                      value={voice.mode}
                      onChange={(e) =>
                        updateSynthMode(voice.channel, normalizeSynthMode(e.target.value))
                      }
                    >
                      <option value="melodic">Melodic</option>
                      <option value="percussion">Percussion</option>
                    </select>
                    <select
                      aria-label={`Channel ${voice.channel} synth sound`}
                      className="synth-voice-select"
                      value={voice.mode === "percussion" ? voice.drumNote : voice.program}
                      onChange={(e) => {
                        const value = parseInt(e.target.value, 10) || 0;
                        if (voice.mode === "percussion") {
                          updateSynthDrumNote(voice.channel, value);
                        } else {
                          updateSynthProgram(voice.channel, value);
                        }
                      }}
                    >
                      {voice.mode === "percussion"
                        ? GM_PERCUSSION_NOTES.map(({ note, name }) => (
                            <option key={`${note}-${name}`} value={note}>
                              {synthDrumLabel(note)}
                            </option>
                          ))
                        : GM_PROGRAM_NAMES.map((program, index) => (
                            <option key={program} value={index}>
                              {synthProgramLabel(index)}
                            </option>
                          ))}
                    </select>
                  </div>
                </div>
              ))}
            </div>

            <div className="synth-properties-actions">
              <button
                className="tiny-button"
                type="button"
                onClick={() => setSynthPrograms(cloneSynthVoices(DEFAULT_SYNTH_VOICES))}
              >
                reset palette
              </button>
              <button
                className="primary compact-button"
                type="button"
                onClick={close}
              >
                done
              </button>
            </div>
          </>
        )}
      </ModalFrame>
  );
}
