import type { Dispatch, SetStateAction } from "react";

import { NumericField } from "../NumericField";
import type { U64SeedDecimal } from "../bridge";
import {
  type RhythmSeedBehaviorName,
  type SeedDialogTab,
  type SeedLogScope,
  type SeedModeName,
  type SeedPath,
  clamp,
  normalizeSeedValue,
} from "../patchIo";
import { datetimeSeed } from "../sessionPrefs";
import { Switch } from "../Switch";
import { ModalFrame, ModalHeader } from "./ModalChrome";
import type { SeedPoolLogEntry } from "./SeedControls";

type Setter<T> = Dispatch<SetStateAction<T>>;

export interface SeedSetupDialogProps {
  channelHocketHistorySeedsInput: string;
  channelHocketMaxHistory: number;
  channelHocketSeed: number;
  channelHocketSeedBehavior: RhythmSeedBehaviorName;
  globalHistorySeeds: U64SeedDecimal[];
  globalSeedMode: SeedModeName;
  globalSeedStartupLocked: boolean;
  historySeedsInput: string;
  maxHistory: number;
  seed: number;
  seedLogScope: SeedLogScope;
  seedPaths: SeedPath[];
  seedSetupOpen: boolean;
  seedSetupTab: SeedDialogTab;
  setChannelHocketHistorySeedsInput: Setter<string>;
  setChannelHocketMaxHistory: Setter<number>;
  setChannelHocketSeed: Setter<number>;
  setChannelHocketSeedBehavior: Setter<RhythmSeedBehaviorName>;
  setGlobalSeedStartupLocked: Setter<boolean>;
  setHistorySeedsInput: Setter<string>;
  setMaxHistory: Setter<number>;
  setSeed: Setter<number>;
  setSeedLogScope: Setter<SeedLogScope>;
  setSeedMode: Setter<SeedModeName>;
  setSeedSetupOpen: Setter<boolean>;
  setSeedSetupTab: Setter<SeedDialogTab>;
  visibleSeedPaths: SeedPath[];
  visibleSeedPoolLogEntries: SeedPoolLogEntry[];
  [key: string]: unknown;
}

const GLOBAL_MODES: readonly { value: SeedModeName; label: string }[] = [
  { value: "locked", label: "Locked" },
  { value: "perCycle", label: "Per cycle" },
  { value: "history", label: "History" },
];

const STREAM_MODES: readonly {
  value: RhythmSeedBehaviorName;
  label: string;
}[] = [
  { value: "locked", label: "Locked" },
  { value: "perCycle", label: "Per cycle" },
  { value: "history", label: "History" },
];

function ModeButtons<T extends string>({
  label,
  modes,
  value,
  onChange,
}: {
  label: string;
  modes: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="seed-strategy-bar" role="group" aria-label={label}>
      {modes.map((mode) => (
        <button
          className={`seed-strategy-btn${value === mode.value ? " is-active" : ""}`}
          key={mode.value}
          type="button"
          aria-pressed={value === mode.value}
          onClick={() => onChange(mode.value)}
        >
          {mode.label}
        </button>
      ))}
    </div>
  );
}

function SeedEditor({
  label,
  seed,
  setSeed,
}: {
  label: string;
  seed: number;
  setSeed: Setter<number>;
}) {
  return (
    <label className="seed-history-length">
      <span>{label}</span>
      <NumericField
        min={0}
        value={seed}
        onValueCommit={(value) => setSeed(normalizeSeedValue(value))}
      />
      <button type="button" onClick={() => setSeed(datetimeSeed())}>
        Roll
      </button>
    </label>
  );
}

function HistoryEditor({
  input,
  maxHistory,
  setInput,
  setMaxHistory,
}: {
  input: string;
  maxHistory: number;
  setInput: Setter<string>;
  setMaxHistory: Setter<number>;
}) {
  return (
    <div className="seed-balance">
      <label>
        <span>Remembered seeds</span>
        <input
          value={input}
          inputMode="numeric"
          onChange={(event) => setInput(event.target.value)}
        />
      </label>
      <label className="seed-history-length">
        <span>History length</span>
        <NumericField
          min={1}
          max={64}
          value={maxHistory}
          onValueCommit={(value) => setMaxHistory(clamp(value, 1, 64))}
        />
      </label>
    </div>
  );
}

export function SeedSetupDialog({
  channelHocketHistorySeedsInput,
  channelHocketMaxHistory,
  channelHocketSeed,
  channelHocketSeedBehavior,
  globalHistorySeeds,
  globalSeedMode,
  globalSeedStartupLocked,
  historySeedsInput,
  maxHistory,
  seed,
  seedLogScope,
  seedSetupOpen,
  seedSetupTab,
  setChannelHocketHistorySeedsInput,
  setChannelHocketMaxHistory,
  setChannelHocketSeed,
  setChannelHocketSeedBehavior,
  setGlobalSeedStartupLocked,
  setHistorySeedsInput,
  setMaxHistory,
  setSeed,
  setSeedLogScope,
  setSeedMode,
  setSeedSetupOpen,
  setSeedSetupTab,
  visibleSeedPaths,
  visibleSeedPoolLogEntries,
}: SeedSetupDialogProps) {
  const activeTab =
    seedSetupTab === "rhythm" ||
    seedSetupTab === "channel" ||
    seedSetupTab === "log"
      ? seedSetupTab
      : "global";
  const tabs: readonly { id: SeedDialogTab; label: string }[] = [
    { id: "global", label: "Global" },
    { id: "rhythm", label: "Generator" },
    { id: "channel", label: "Channel" },
    { id: "log", label: "Log" },
  ];

  return (
    <ModalFrame
      open={seedSetupOpen}
      onClose={() => setSeedSetupOpen(false)}
      ariaLabelledby="seed-setup-title"
      className="setup-backdrop"
      layer="utility"
      size="wide"
      surfaceClassName="setup-dialog seed-dialog"
    >
      {({ close }) => (
        <>
          <ModalHeader
            className="setup-head"
            title="Seed Strategy"
            titleId="seed-setup-title"
            eyebrow="Choose deterministic seed behavior for the sequencer and its kept streams."
            closeLabel="Close Seed Strategy"
            onClose={close}
          />
          <div className="seed-strategy-bar" role="tablist" aria-label="Seed stream">
            {tabs.map((tab) => (
              <button
                className={`seed-strategy-btn${activeTab === tab.id ? " is-active" : ""}`}
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={activeTab === tab.id}
                onClick={() => setSeedSetupTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {activeTab === "global" && (
            <div className="seed-advanced-panel">
              <ModeButtons
                label="Global seed mode"
                modes={GLOBAL_MODES}
                value={globalSeedMode}
                onChange={setSeedMode}
              />
              <SeedEditor label="Global seed" seed={seed} setSeed={setSeed} />
              <Switch
                size="sm"
                isSelected={globalSeedStartupLocked}
                onChange={setGlobalSeedStartupLocked}
                aria-label="Lock global seed for new sessions"
              >
                Lock for new sessions
              </Switch>
              {globalSeedMode === "history" && (
                <HistoryEditor
                  input={historySeedsInput}
                  maxHistory={maxHistory}
                  setInput={setHistorySeedsInput}
                  setMaxHistory={setMaxHistory}
                />
              )}
              <p className="seed-advanced-hint">
                {globalHistorySeeds.length} seed{globalHistorySeeds.length === 1 ? "" : "s"} remembered.
              </p>
            </div>
          )}

          {activeTab === "rhythm" && (
            <div className="seed-advanced-panel">
              <ModeButtons
                label="Generator seed mode"
                modes={GLOBAL_MODES}
                value={globalSeedMode}
                onChange={setSeedMode}
              />
              <SeedEditor label="Generator seed" seed={seed} setSeed={setSeed} />
              {globalSeedMode === "history" && (
                <HistoryEditor
                  input={historySeedsInput}
                  maxHistory={maxHistory}
                  setInput={setHistorySeedsInput}
                  setMaxHistory={setMaxHistory}
                />
              )}
            </div>
          )}

          {activeTab === "channel" && (
            <div className="seed-advanced-panel">
              <ModeButtons
                label="Channel seed mode"
                modes={STREAM_MODES}
                value={channelHocketSeedBehavior}
                onChange={setChannelHocketSeedBehavior}
              />
              <SeedEditor label="Channel seed" seed={channelHocketSeed} setSeed={setChannelHocketSeed} />
              {channelHocketSeedBehavior === "history" && (
                <HistoryEditor
                  input={channelHocketHistorySeedsInput}
                  maxHistory={channelHocketMaxHistory}
                  setInput={setChannelHocketHistorySeedsInput}
                  setMaxHistory={setChannelHocketMaxHistory}
                />
              )}
            </div>
          )}

          {activeTab === "log" && (
            <div className="seed-advanced-panel">
              <div className="seed-strategy-bar" role="group" aria-label="Seed log filter">
                {(["all", "global", "rhythm", "channel", "paths"] as SeedLogScope[]).map(
                  (scope) => (
                    <button
                      className={`seed-strategy-btn${seedLogScope === scope ? " is-active" : ""}`}
                      key={scope}
                      type="button"
                      aria-pressed={seedLogScope === scope}
                      onClick={() => setSeedLogScope(scope)}
                    >
                      {scope === "rhythm" ? "Generator" : scope}
                    </button>
                  )
                )}
              </div>
              <p>{visibleSeedPoolLogEntries.length} seed events</p>
              <p>{visibleSeedPaths.length} saved takes</p>
            </div>
          )}
        </>
      )}
    </ModalFrame>
  );
}
