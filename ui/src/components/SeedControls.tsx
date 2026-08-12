/**
 * Seed strategy display helpers and controls: seed parsing/labels/tones,
 * seed-path construction and playback config, the history summary + loop
 * monitor, mode tiles, and child seed source select. Extracted verbatim
 * from App.tsx (carve-up round 8).
 */
import {
  newStableId,
} from "../boundaryPlanning";
import {
  PlaybackSeedTraceEvent,
  SeedPathPlaybackConfig,
  U64SeedDecimal,
} from "../bridge";
import {
  formatShortNumber,
} from "../formatters";
import {
  RhythmSeedBehaviorName,
  SeedModeName,
  SeedPath,
  normalizeU64SeedDecimal,
} from "../patchIo";
import {
  SeedRecurrenceRow,
  filterSeedPathItemsForTrack,
  seedTraceDedupeKey,
} from "../timelineModel";
import {
  CSSProperties,
  useEffect,
  useRef,
  useState,
} from "react";
export function parseSeeds(input: string): U64SeedDecimal[] {
  return input.split(",").flatMap((part) => {
    const seed = normalizeU64SeedDecimal(part);
    return seed === null ? [] : [seed];
  });
}

export function seedListLabel(seeds: readonly (number | U64SeedDecimal)[]): string {
  return seeds.length ? seeds.join(", ") : "empty";
}

export function seedModeShortLabel(mode: SeedModeName): string {
  if (mode === "locked") return "locked";
  if (mode === "history") return "history/new";
  if (mode === "drift") return "drift";
  if (mode === "morph") return "morph";
  return "per-cycle";
}

/** Concise seed-strategy label for panel header annotations (no resolved seed
 *  number). "inherits" when following the global seed, else the short mode. */
export function seedBehaviorShortLabel(behavior: RhythmSeedBehaviorName): string {
  return behavior === "followGlobal" ? "inherits" : seedModeShortLabel(behavior);
}

export function seedToneForMode(mode: SeedModeName): SeedTone {
  if (mode === "locked") return "locked";
  if (mode === "history") return "history";
  if (mode === "drift") return "drift";
  if (mode === "morph") return "morph";
  return "cycle";
}

export function seedToneForBehavior(behavior: RhythmSeedBehaviorName): SeedTone {
  if (behavior === "followGlobal") return "inherit";
  return seedToneForMode(behavior);
}

export function seedToneCode(tone: SeedTone): string {
  if (tone === "locked") return "L";
  if (tone === "history") return "H";
  if (tone === "inherit") return "IN";
  if (tone === "ratchet") return "R";
  if (tone === "drift") return "D";
  if (tone === "morph") return "M";
  return "C";
}

export function seedToneName(tone: SeedTone): string {
  if (tone === "locked") return "Locked";
  if (tone === "history") return "History";
  if (tone === "inherit") return "Inherits";
  if (tone === "ratchet") return "Ratchet";
  if (tone === "drift") return "Drift";
  if (tone === "morph") return "Morph";
  return "Cycle";
}

export function seedStrategySummary(
  mode: SeedModeName,
  seed: number,
  historySeeds: U64SeedDecimal[],
  historyWeight: number,
  newSeedWeight: number,
  maxHistory: number,
  newSeedChance: number,
  holdChance: number,
  blendCycles: number
): string {
  if (mode === "history") {
    return `${historySeeds.length} remembered · history ${formatShortNumber(
      historyWeight
    )} / new ${formatShortNumber(newSeedWeight)} · max ${maxHistory}`;
  }
  if (mode === "drift") {
    return `drift seed ${seed} · ${newSeedChance}% new`;
  }
  if (mode === "morph") {
    return `morph seed ${seed} · ${newSeedChance}% new · hold ${holdChance}% · blend ${blendCycles}`;
  }
  return `${seedModeShortLabel(mode)} seed ${seed}`;
}

export function seedStrategyDetail(mode: SeedModeName): string {
  if (mode === "locked") {
    return "The same variation is reused until the seed or probabilities change.";
  }
  if (mode === "history") {
    return "Each cycle chooses either a remembered seed or a newly generated seed according to the weights.";
  }
  if (mode === "drift") {
    return "Each cycle keeps the previous cycle's seed or rolls a new one at the set chance, so material repeats and occasionally moves on.";
  }
  if (mode === "morph") {
    return "Seeds crossfade: new layers fade in over several cycles while old ones retire for good, so material interleaves before moving on.";
  }
  return "The base seed is mixed with the cycle number, so every cycle can change while staying reproducible.";
}

export function seedBehaviorSummary(
  behavior: RhythmSeedBehaviorName,
  localSeed: number,
  historySeeds: U64SeedDecimal[],
  historyWeight: number,
  newSeedWeight: number,
  maxHistory: number,
  newSeedChance: number,
  holdChance: number,
  blendCycles: number,
  inheritedSummary: string
): string {
  if (behavior === "followGlobal") {
    return `inherits global ${inheritedSummary}`;
  }
  return seedStrategySummary(
    behavior,
    localSeed,
    historySeeds,
    historyWeight,
    newSeedWeight,
    maxHistory,
    newSeedChance,
    holdChance,
    blendCycles
  );
}

export interface SeedPoolLogEntry {
  scope: "global" | "rhythm" | "pitch" | "channel";
  title: string;
  mode: string;
  /** Authored seed controls remain bounded JS numbers. */
  baseSeed: number;
  /** Engine-produced history values remain exact u64 decimals. */
  seeds: U64SeedDecimal[];
  historyWeight: number;
  newSeedWeight: number;
  maxHistory: number;
  inheritedFrom: string | null;
}

export function SeedHistorySummary({
  seeds,
  historyWeight,
  newSeedWeight,
  maxHistory,
  enabled,
  onOpenLog,
}: {
  seeds: U64SeedDecimal[];
  historyWeight: number;
  newSeedWeight: number;
  maxHistory: number;
  enabled: boolean;
  onOpenLog: () => void;
}) {
  return (
    <button
      className={`seed-history-summary${enabled ? "" : " is-muted"}`}
      type="button"
      onClick={onOpenLog}
    >
      <div>
        <strong>{seeds.length} remembered</strong>
        <span>
          history {formatShortNumber(historyWeight)} / new{" "}
          {formatShortNumber(newSeedWeight)} · max {maxHistory}
        </span>
      </div>
      <div className="seed-history-chips" aria-label="Remembered seed pool">
        {seeds.length ? (
          seeds.slice(0, 10).map((seed, index) => <b key={`${seed}-${index}`}>{seed}</b>)
        ) : (
          <em>No remembered seeds</em>
        )}
        {seeds.length > 10 && <em>+{seeds.length - 10}</em>}
      </div>
    </button>
  );
}

export const SEED_LOOP_COLORS = [
  "#00a39f",
  "#bb8800",
  "#008cde",
  "#8263d4",
  "#e11984",
  "#ca5021",
  "#56a070",
  "#e12f43",
] as const;

export function seedLoopCellText(cell: SeedRecurrenceRow["cells"][number]): string {
  if (cell.state === "repeat") {
    return cell.historyIndex === null ? "H" : String(cell.historyIndex + 1);
  }
  if (cell.state === "hold") return "=";
  if (cell.state === "new") return "+";
  return "";
}

export function seedLoopCellTitle(
  row: SeedRecurrenceRow,
  cell: SeedRecurrenceRow["cells"][number]
): string {
  if (cell.state === "empty") return `${row.label} cycle ${cell.cycle}: no trace`;
  const seedLabel = cell.seed === null ? "unknown seed" : `seed ${cell.seed}`;
  if (cell.state === "repeat") {
    const historyLabel =
      cell.historyIndex === null ? "history pool" : `history slot ${cell.historyIndex + 1}`;
    return `${row.label} cycle ${cell.cycle}: repeated ${seedLabel} from ${historyLabel}`;
  }
  if (cell.state === "hold") {
    return `${row.label} cycle ${cell.cycle}: held ${seedLabel} from the previous cycle`;
  }
  if (cell.state === "new") {
    return `${row.label} cycle ${cell.cycle}: learned new ${seedLabel}`;
  }
  return `${row.label} cycle ${cell.cycle}: ${seedLabel}`;
}

export function seedLoopCellStyle(
  cell: SeedRecurrenceRow["cells"][number]
): CSSProperties | undefined {
  if (cell.state !== "repeat") return undefined;
  const index = Math.max(0, cell.historyIndex ?? 0) % SEED_LOOP_COLORS.length;
  return { "--seed-loop-color": SEED_LOOP_COLORS[index] } as CSSProperties;
}

export function SeedHistoryLoopMonitor({
  rows,
  fallbackLabel,
  onOpenLog,
}: {
  rows: SeedRecurrenceRow[];
  fallbackLabel: string;
  onOpenLog: () => void;
}) {
  const activeRows = rows.filter((row) => row.enabled);
  const displayRows = activeRows.length ? activeRows : rows.slice(0, 1);
  const summary = activeRows.length
    ? activeRows
        .map((row) => {
          return `${row.label} ${row.repeatCount}/${row.cells.length} · ${row.paceLabel}`;
        })
        .join("  ")
    : fallbackLabel;

  return (
    <button
      className={`seed-history-shortcut seed-loop-monitor${
        activeRows.length ? "" : " is-muted"
      }`}
      type="button"
      onClick={onOpenLog}
      title="Open Seed Strategy history log"
    >
      <div className="seed-loop-head">
        <strong>Seed loop</strong>
        <span>{summary}</span>
      </div>
      <div className="seed-loop-rows" aria-label="Recent history seed recurrence">
        {displayRows.map((row) => (
          <div
            className={`seed-loop-row${row.enabled ? "" : " is-muted"}`}
            key={row.domain}
          >
            <b>{row.label}</b>
            <span className="seed-loop-cells">
              {row.cells.map((cell) => (
                <i
                  className={`is-${cell.state}`}
                  key={`${row.domain}-${cell.cycle}`}
                  style={seedLoopCellStyle(cell)}
                  title={seedLoopCellTitle(row, cell)}
                >
                  {seedLoopCellText(cell)}
                </i>
              ))}
            </span>
            <em>{row.paceLabel}</em>
          </div>
        ))}
      </div>
    </button>
  );
}

export function SeedSymbol({ tone }: { tone: SeedTone }) {
  return (
    <span className={`seed-symbol is-${tone}`} aria-label={seedToneName(tone)}>
      <i aria-hidden="true" />
      <b>{seedToneCode(tone)}</b>
    </span>
  );
}

export function SeedCycleGraphic({ tone }: { tone: SeedTone }) {
  return (
    <span className={`seed-cycle-graphic is-${tone}`} aria-hidden="true">
      <i />
      <i />
      <i />
      <i />
    </span>
  );
}

export function newSeedPathId(): string {
  return newStableId("seed-path");
}

export function makeSeedPath(name: string, sourcePathId: string | null = null): SeedPath {
  const createdAt = new Date().toISOString();
  return {
    id: newSeedPathId(),
    name,
    createdAt,
    sourcePathId,
    immutable: true,
    wildcardRules: [],
    trace: [],
  };
}

export function seedTraceKey(point: PlaybackSeedTraceEvent): string {
  // Delegates to the shared, unit-tested helper so the dedupe rule has one
  // implementation (it includes the source track to avoid collapsing
  // multi-track decisions on the same domain/cycle).
  return seedTraceDedupeKey(point);
}

/** Decimal text editor for replay seeds, which may exceed MAX_SAFE_INTEGER. */
export function SeedTraceDecimalField({
  value,
  ariaLabel,
  onValueCommit,
}: {
  value: U64SeedDecimal;
  ariaLabel: string;
  onValueCommit: (value: U64SeedDecimal) => void;
}) {
  const [draft, setDraft] = useState(value);
  const editingRef = useRef(false);
  const revertOnBlurRef = useRef(false);

  useEffect(() => {
    if (!editingRef.current) setDraft(value);
  }, [value]);

  const normalizedDraft = normalizeU64SeedDecimal(draft);
  const commit = () => {
    editingRef.current = false;
    if (revertOnBlurRef.current) {
      revertOnBlurRef.current = false;
      setDraft(value);
      return;
    }
    if (normalizedDraft === null) {
      setDraft(value);
      return;
    }
    setDraft(normalizedDraft);
    if (normalizedDraft !== value) onValueCommit(normalizedDraft);
  };

  return (
    <span className="numeric-field numeric-field--field numeric-field--integer is-solo seed-trace-decimal-field">
      <input
        aria-label={ariaLabel}
        aria-invalid={draft.length > 0 && normalizedDraft === null}
        autoComplete="off"
        className="numeric-field__input"
        inputMode="numeric"
        pattern="[0-9]*"
        spellCheck={false}
        type="text"
        value={draft}
        onBlur={commit}
        onChange={(event) => {
          if (/^\d*$/.test(event.currentTarget.value)) {
            setDraft(event.currentTarget.value);
          }
        }}
        onFocus={(event) => {
          editingRef.current = true;
          event.currentTarget.select();
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            event.currentTarget.blur();
          } else if (event.key === "Escape") {
            event.preventDefault();
            revertOnBlurRef.current = true;
            setDraft(value);
            event.currentTarget.blur();
          }
        }}
      />
    </span>
  );
}

export function seedPathPlaybackConfig(
  path: SeedPath | null,
  restrictToTrackId: string | null = null
): SeedPathPlaybackConfig | null {
  if (!path) return null;
  return {
    entries: filterSeedPathItemsForTrack(path.trace, restrictToTrackId).map((point) => ({
      cycle: point.cycle,
      domain: point.domain,
      label: point.label,
      seed: point.seed,
      baseSeed: point.baseSeed ?? null,
      source: point.source,
      historyBefore: [...point.historyBefore],
      historyAfter: [...point.historyAfter],
      parallelTrackIndex: point.parallelTrackIndex ?? null,
      trackId: point.trackId ?? null,
    })),
    wildcards: filterSeedPathItemsForTrack(path.wildcardRules, restrictToTrackId).map((rule) => ({
      domain: rule.domain,
      cycle: rule.cycle,
      trackId: rule.trackId ?? null,
    })),
  };
}

// Narrow an already-built seed-path config to the entries/wildcards that apply
// to one track (legacy/untagged items apply to all tracks). The backend filters
// too; doing it here keeps each track's wire payload small and self-evident.

export function GlobalSeedModeTiles({
  value,
  onChange,
}: {
  value: SeedModeName;
  onChange: (value: SeedModeName) => void;
}) {
  const tiles: Array<{
    id: SeedModeName;
    label: string;
    caption: string;
    tone: SeedTone;
  }> = [
    { id: "locked", label: "Repeat", caption: "fixed", tone: "locked" },
    { id: "perCycle", label: "Vary by cycle", caption: "sequence", tone: "cycle" },
    { id: "history", label: "Revisit pool", caption: "reuse/new", tone: "history" },
  ];
  return (
    <div className="seed-mode-tiles" role="group" aria-label="Global seed strategy">
      {tiles.map((tile) => (
        <button
          className={`seed-mode-tile is-${tile.tone}${
            value === tile.id ? " is-active" : ""
          }`}
          key={tile.id}
          type="button"
          aria-pressed={value === tile.id}
          onClick={() => onChange(tile.id)}
        >
          <SeedSymbol tone={tile.tone} />
          <span>
            <strong>{tile.label}</strong>
            <em>{tile.caption}</em>
          </span>
        </button>
      ))}
    </div>
  );
}

export function ChildSeedSourceSelect({
  value,
  onChange,
  label,
}: {
  value: RhythmSeedBehaviorName;
  onChange: (value: RhythmSeedBehaviorName) => void;
  label: string;
}) {
  const sourceIsGlobal = value === "followGlobal";
  const localMode = sourceIsGlobal ? "perCycle" : value;
  const localModes: Array<{
    id: SeedModeName;
    label: string;
    caption: string;
    tone: SeedTone;
  }> = [
    { id: "locked", label: "Repeat", caption: "fixed", tone: "locked" },
    { id: "perCycle", label: "Vary by cycle", caption: "sequence", tone: "cycle" },
    { id: "history", label: "Revisit pool", caption: "reuse/new", tone: "history" },
  ];
  const selectedTone = sourceIsGlobal
    ? "inherit"
    : localModes.find((option) => option.id === localMode)?.tone ?? "cycle";
  return (
    <div className={`seed-source-select is-${selectedTone}`}>
      <span className="seed-source-heading">{label}</span>
      <div className="seed-source-switch" role="group" aria-label={`${label} source`}>
        <button
          className={`seed-source-choice is-inherit${sourceIsGlobal ? " is-active" : ""}`}
          type="button"
          aria-pressed={sourceIsGlobal}
          onClick={() => onChange("followGlobal")}
        >
          <SeedSymbol tone="inherit" />
          <span>
            <strong>Use Global</strong>
            <em>shared motion</em>
          </span>
        </button>
        <button
          className={`seed-source-choice is-${selectedTone}${sourceIsGlobal ? "" : " is-active"}`}
          type="button"
          aria-pressed={!sourceIsGlobal}
          onClick={() => onChange(sourceIsGlobal ? "perCycle" : localMode)}
        >
          <SeedSymbol tone={selectedTone} />
          <span>
            <strong>Own Stream</strong>
            <em>separate identity</em>
          </span>
        </button>
      </div>
      {!sourceIsGlobal && (
        <div className="seed-mode-tiles is-child" role="group" aria-label={`${label} local behavior`}>
          {localModes.map((mode) => (
            <button
              className={`seed-mode-tile is-${mode.tone}${
                localMode === mode.id ? " is-active" : ""
              }`}
              key={mode.id}
              type="button"
              aria-pressed={localMode === mode.id}
              onClick={() => onChange(mode.id)}
            >
              <SeedSymbol tone={mode.tone} />
              <span>
                <strong>{mode.label}</strong>
                <em>{mode.caption}</em>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export type SeedTone =
  | "locked"
  | "cycle"
  | "history"
  | "drift"
  | "morph"
  | "inherit"
  | "ratchet";
