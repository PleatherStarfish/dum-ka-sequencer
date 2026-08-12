/**
 * The Setup dialog: audio/MIDI output info, autosave + session restore preferences, and patch management.
 * Extracted from App.tsx (carve-up round 19) along the panel seam — all
 * state stays in App and arrives via props with their original names (types
 * compiler-generated via scripts/carve/typegen.cjs); the JSX body is
 * unchanged.
 */
import {
  NumericField,
} from "../NumericField";
import {
  patchClearAutosave,
  type MidiDestination,
  type MidiRouteStatus,
} from "../bridge";
import {
  fileNameFromPath,
} from "../filenames";
import {
  VIRTUAL_ONLY_VALUE,
  buildDestinationOptions,
  routeStatusLine,
} from "../midiRouting";
import {
  SetupTab,
  clamp,
  normalizeAutosaveIntervalMs,
} from "../patchIo";
import {
  MainEditorId,
} from "./MainEditorChrome";
import {
  ModalFrame,
  ModalHeader,
} from "./ModalChrome";
import {
  PatchPersistenceState,
} from "./PitchNotation";

import { Switch } from "../Switch";
export interface SetupDialogProps {
  autoloadRecentSession: boolean;
  autosaveEnabled: boolean;
  autosaveIntervalMs: number;
  channelHocketEnabled: boolean;
  channelHocketMatrixChannels: number[];
  currentPatchFingerprintRef: React.MutableRefObject<string>;
  currentPatchPath: string | null;
  handleExportScore: () => Promise<void>;
  handleMidiDestinationPick: (value: string) => Promise<void>;
  handleMidiRescan: () => Promise<void>;
  handlePanic: () => Promise<void>;
  handleSavePatchAs: () => Promise<void>;
  handleSynthToggle: () => Promise<void>;
  lastAutosaveAt: string | null;
  lastAutosavedFingerprintRef: React.MutableRefObject<string>;
  markPersistenceForFingerprint: (fingerprint: string) => void;
  midiDebugOpen: boolean;
  midiDestinations: MidiDestination[];
  midiOutputChannel: number;
  midiRouteStatus: MidiRouteStatus;
  patchPersistenceState: PatchPersistenceState;
  setAutoloadRecentSession: (next: boolean) => void;
  setAutosaveIntervalMs: (next: number) => void;
  setError: React.Dispatch<React.SetStateAction<string | null>>;
  setLastAutosaveAt: React.Dispatch<React.SetStateAction<string | null>>;
  setMainEditorOpen: (id: MainEditorId | null) => void;
  setMidiDebugOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setMidiOutputChannel: React.Dispatch<React.SetStateAction<number>>;
  setSetupOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setSetupTab: React.Dispatch<React.SetStateAction<SetupTab>>;
  setSynthPropertiesOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setupOpen: boolean;
  setupTab: SetupTab;
  synthEnabled: boolean;
  synthMelodicCount: number;
  synthPending: boolean;
  synthPercussionCount: number;
  updateAutosaveEnabled: (next: boolean) => void;
}

export function SetupDialog({
  autoloadRecentSession,
  autosaveEnabled,
  autosaveIntervalMs,
  channelHocketEnabled,
  channelHocketMatrixChannels,
  currentPatchFingerprintRef,
  currentPatchPath,
  handleExportScore,
  handleMidiDestinationPick,
  handleMidiRescan,
  handlePanic,
  handleSavePatchAs,
  handleSynthToggle,
  lastAutosaveAt,
  lastAutosavedFingerprintRef,
  markPersistenceForFingerprint,
  midiDebugOpen,
  midiDestinations,
  midiOutputChannel,
  midiRouteStatus,
  patchPersistenceState,
  setAutoloadRecentSession,
  setAutosaveIntervalMs,
  setError,
  setLastAutosaveAt,
  setMainEditorOpen,
  setMidiDebugOpen,
  setMidiOutputChannel,
  setSetupOpen,
  setSetupTab,
  setSynthPropertiesOpen,
  setupOpen,
  setupTab,
  synthEnabled,
  synthMelodicCount,
  synthPending,
  synthPercussionCount,
  updateAutosaveEnabled,
}: SetupDialogProps) {
  return (
      <ModalFrame
        open={setupOpen}
        onClose={() => setSetupOpen(false)}
        ariaLabelledby="setup-title"
        className="setup-backdrop"
        layer="utility"
        size="standard"
        surfaceClassName="setup-dialog"
      >
        {({ close }) => (
          <>
            <ModalHeader
              className="setup-head"
              title="Audio & MIDI Setup"
              titleId="setup-title"
              eyebrow="Virtual MIDI source · built-in monitor · project recovery"
              closeLabel="Close Audio & MIDI Setup"
              onClose={close}
            />

            <nav className="ds-tab-bar" aria-label="Setup sections">
              {[
                ["audio", "Audio"],
                ["midi", "MIDI"],
                ["files", "Files"],
              ].map(([id, label]) => (
                <button
                  className={setupTab === id ? "is-active" : ""}
                  key={id}
                  type="button"
                  aria-pressed={setupTab === id}
                  onClick={() => setSetupTab(id as SetupTab)}
                >
                  {label}
                </button>
              ))}
            </nav>

            {setupTab === "audio" && (
              <div className="setup-grid-panel">
                <section className="setup-card">
                  <div>
                    <strong>Built-in synth monitor</strong>
                    <span>macOS DLS Synthesizer · system default audio output</span>
                  </div>
                  <Switch
                    size="sm"
                    isSelected={synthEnabled}
                    isDisabled={synthPending}
                    onChange={() => void handleSynthToggle()}
                  >
                    <span>{synthEnabled ? "monitor on" : "monitor off"}</span>
                  </Switch>
                  <button
                    className="tiny-button"
                    type="button"
                    onClick={() => {
                      setSetupOpen(false);
                      setSynthPropertiesOpen(true);
                    }}
                  >
                    channel voices
                  </button>
                </section>
                <section className="setup-card">
                  <div>
                    <strong>Audio engine</strong>
                    <span>System-managed sample rate, buffer, and output device</span>
                  </div>
                  <dl className="setup-readout-list">
                    <div>
                      <dt>Output</dt>
                      <dd>Default macOS audio device</dd>
                    </div>
                    <div>
                      <dt>Monitor voices</dt>
                      <dd>
                        {synthMelodicCount} melodic / {synthPercussionCount} percussion
                      </dd>
                    </div>
                  </dl>
                </section>
              </div>
            )}

            {setupTab === "midi" && (
              <div className="setup-grid-panel">
                <section className="setup-card">
                  <div>
                    <strong>MIDI output</strong>
                    <span>Virtual CoreMIDI source visible to other apps</span>
                  </div>
                  <label>
                    Destination
                    <select
                      className="setup-destination-select"
                      aria-label="MIDI destination"
                      value={midiRouteStatus.desired?.id ?? VIRTUAL_ONLY_VALUE}
                      onChange={(event) =>
                        void handleMidiDestinationPick(event.target.value)
                      }
                    >
                      {buildDestinationOptions(
                        midiDestinations,
                        midiRouteStatus.desired
                      ).map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <p className="setup-route-status">
                    {routeStatusLine(midiRouteStatus)}
                  </p>
                  <button
                    className="tiny-button"
                    type="button"
                    onClick={() => void handleMidiRescan()}
                  >
                    rescan
                  </button>
                  <label>
                    Default channel
                    <NumericField
                      min={1}
                      max={16}
                      value={midiOutputChannel}
                      onValueCommit={(value) =>
                        setMidiOutputChannel(
                          clamp(value, 1, 16)
                        )
                      }
                    />
                  </label>
                  <dl className="setup-readout-list">
                    <div>
                      <dt>Port</dt>
                      <dd>Dum-Ka MIDI</dd>
                    </div>
                    <div>
                      <dt>Channel mode</dt>
                      <dd>
                        {channelHocketEnabled
                          ? `${channelHocketMatrixChannels.length} hocket channels`
                          : `static channel ${midiOutputChannel}`}
                      </dd>
                    </div>
                  </dl>
                </section>
                <section className="setup-card">
                  <div>
                    <strong>Diagnostics and safety</strong>
                    <span>Useful when routing to a DAW or external instrument</span>
                  </div>
                  <Switch
                    size="sm"
                    isSelected={midiDebugOpen}
                    onChange={(value) => setMidiDebugOpen(value)}
                  >
                    <span>show MIDI dispatch log</span>
                  </Switch>
                  <button
                    className="tiny-button"
                    type="button"
                    onClick={() => {
                      setSetupOpen(false);
                      setMainEditorOpen("channel");
                    }}
                  >
                    channel shaper
                  </button>
                  <button
                    className="tiny-button"
                    type="button"
                    title="Silences stuck notes; playback continues"
                    onClick={() => void handlePanic()}
                  >
                    MIDI panic
                  </button>
                </section>
              </div>
            )}

            {setupTab === "files" && (
              <div className="setup-grid-panel">
                <section className="setup-card">
                  <div>
                    <strong>Autosave and launch</strong>
                    <span>Temporary recovery writes quietly; restore is prompted after crashes</span>
                  </div>
                  <label>
                    Autosave interval
                    <div className="value-with-unit compact-value">
                      <NumericField
                        min={1}
                        max={60}
                        value={Math.round(autosaveIntervalMs / 1000)}
                        onValueCommit={(value) =>
                          setAutosaveIntervalMs(
                            normalizeAutosaveIntervalMs(
                              (value) * 1000
                            )
                          )
                        }
                      />
                      <span className="unit">sec</span>
                    </div>
                  </label>
                  <Switch
                    size="sm"
                    isSelected={autosaveEnabled}
                    onChange={(value) => updateAutosaveEnabled(value)}
                  >
                    <span>autosave temporary recovery</span>
                  </Switch>
                  <Switch
                    size="sm"
                    isSelected={autoloadRecentSession}
                    onChange={(value) => setAutoloadRecentSession(value)}
                  >
                    <span>autoload most recent patch after clean launch</span>
                  </Switch>
                </section>
                <section className="setup-card">
                  <div>
                    <strong>Project files</strong>
                    <span>
                      {currentPatchPath
                        ? fileNameFromPath(currentPatchPath)
                        : "No saved project path yet"}
                    </span>
                  </div>
                  <dl className="setup-readout-list">
                    <div>
                      <dt>State</dt>
                      <dd>{patchPersistenceState}</dd>
                    </div>
                    <div>
                      <dt>Autosave</dt>
                      <dd>
                        {lastAutosaveAt
                          ? new Date(lastAutosaveAt).toLocaleString()
                          : "No recovery file recorded"}
                      </dd>
                    </div>
                  </dl>
                  <button
                    className="tiny-button"
                    type="button"
                    onClick={() => void handleSavePatchAs()}
                  >
                    save as
                  </button>
                  <button
                    className="tiny-button"
                    type="button"
                    onClick={() => void handleExportScore()}
                  >
                    export cycle
                  </button>
                  <button
                    className="tiny-button"
                    type="button"
                    onClick={async () => {
                      try {
                        await patchClearAutosave();
                        lastAutosavedFingerprintRef.current = "";
                        setLastAutosaveAt(null);
                        markPersistenceForFingerprint(currentPatchFingerprintRef.current);
                      } catch (e) {
                        setError(String(e));
                      }
                    }}
                  >
                    clear recovery
                  </button>
                </section>
              </div>
            )}
          </>
        )}
      </ModalFrame>
  );
}
