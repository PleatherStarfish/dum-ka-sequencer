import { useMemo, useState } from "react";
import type { MetricVelocity } from "../bridge";
import type { EvolutionDirective, GeneratorConfig } from "../bridge";
import {
  DUMKA_COMPLEXITY_CEILING_AUTOMATION_TARGET,
  DUMKA_COMPLEXITY_FLOOR_AUTOMATION_TARGET,
  DUMKA_PLACEMENT_BIAS_AUTOMATION_TARGET,
  GENERATOR_DENSITY_AUTOMATION_TARGET,
} from "../automationTargets";
import {
  analyzeDumkaPattern,
  compileDumkaPattern,
  deriveDumkaBeatSlotCounts,
  DUMKA_MAX_SUBDIVISION,
  DUMKA_SUBDIVISION_LEVELS,
  normalizeDumkaSubdivisionPalette,
  workingDumkaSubdivision,
  type DumkaOpEnabled,
  type DumkaOpWeights,
  type DumkaRequiredStructure,
} from "../dumkaPattern";
import { geometricPlacementProfile } from "../dumkaMetrics";
import { EvolutionPanels } from "./EvolutionPanels";
import { useEditorDraftLifecycle } from "../editorDraftFlush";
import { NumericField } from "../NumericField";
import { clamp, normalizeSeedValue } from "../patchIo";
import { SliderField } from "../SliderField";
import { PanelHeader } from "./MainEditorChrome";
import { RhythmBuilder } from "./RhythmBuilder";
import type { BuilderProjectionSpan } from "../dumkaRhythmBuilder";
import {
  rollEuclideanSeed,
  type SeedRollDensity,
  type SeedRollStyle,
} from "../dumkaSeedRoll";

export type GeneratorKind = GeneratorConfig["kind"];

/**
 * Inline syntax reference for the Dum-Ka pattern notation. The copy mirrors
 * docs/DUMKA_DSL.md (the grammar's single documented source); update both
 * together.
 */
const DUMKA_SYNTAX_ROWS: ReadonlyArray<readonly [string, string]> = [
  ["x", "a note — any name is accepted, but names carry no meaning (rhythm only); x is the convention"],
  [".", "a rest"],
  ["_", "a hold: extends the previous note or rest"],
  ["[ … ]", "a group: splits its span among its children by weight"],
  ["@n", "weight (default 1); a top-level node's weight is its beats"],
  ["E(k,n,r)", "k onsets spread over n slots, rotated left r — E(3,8) is the tresillo"],
  ["*n", "repeat the node as n siblings"],
  ["| and #", "bar line (ignored) and comment to end of line"],
];

export interface GeneratorEditorProps {
  open: boolean;
  enabled: boolean;
  kind: GeneratorKind;
  densityPercent: number;
  dumkaPattern: string;
  dumkaEvolutionRate: number;
  dumkaDriftLeash: number;
  dumkaDensityFloor: number;
  dumkaDensityCeiling: number;
  dumkaSubdivisionPalette?: readonly number[];
  dumkaComplexityFloor?: number;
  dumkaComplexityCeiling?: number;
  dumkaPlacementBias?: number;
  /** Insight-only denominator diversity from the currently displayed preview. */
  dumkaStateDepthDiversityMilli?: number | null;
  /** Rust-side preview error for the committed pattern, when any. */
  dumkaPreviewError: string | null;
  dumkaRequired: DumkaRequiredStructure | null;
  dumkaStructureReady: boolean;
  /** The single authored per-beat Subdivision when the score has the plain
   * one-section shape, else null; lets the row explain compatible multiples. */
  dumkaAuthoredSubdivision: number | null;
  /** Exact current generator spans; shared with preview/playback so optional
   * Articulate styling can honor Grouping as well as beat cuts. */
  dumkaProjectionSpans: readonly BuilderProjectionSpan[];
  /** Authored score summary; edited in the dedicated Evolve surface. */
  dumkaPlan?: readonly EvolutionDirective[];
  onOpenEvolve?: () => void;
  seedMode: GeneratorConfig["seedMode"]["type"];
  seed: number;
  playbackStructureLocked: boolean;
  setOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setEnabled: React.Dispatch<React.SetStateAction<boolean>>;
  setKind: React.Dispatch<React.SetStateAction<GeneratorKind>>;
  setDensityPercent: React.Dispatch<React.SetStateAction<number>>;
  onDumkaPatternCommit: (pattern: string) => void;
  onApplyDumkaStructure: () => void;
  setDumkaEvolutionRate: React.Dispatch<React.SetStateAction<number>>;
  setDumkaDriftLeash: React.Dispatch<React.SetStateAction<number>>;
  setDumkaDensityFloor: React.Dispatch<React.SetStateAction<number>>;
  setDumkaDensityCeiling: React.Dispatch<React.SetStateAction<number>>;
  setDumkaSubdivisionPalette?: React.Dispatch<React.SetStateAction<number[]>>;
  setDumkaComplexityFloor?: React.Dispatch<React.SetStateAction<number>>;
  setDumkaComplexityCeiling?: React.Dispatch<React.SetStateAction<number>>;
  setDumkaPlacementBias?: React.Dispatch<React.SetStateAction<number>>;
  dumkaBarlowTemperature: number;
  setDumkaBarlowTemperature: React.Dispatch<React.SetStateAction<number>>;
  dumkaFillComplexity: number;
  setDumkaFillComplexity: React.Dispatch<React.SetStateAction<number>>;
  dumkaEuclidMaxRun: number;
  setDumkaEuclidMaxRun: React.Dispatch<React.SetStateAction<number>>;
  dumkaEuclidInvert: number;
  setDumkaEuclidInvert: React.Dispatch<React.SetStateAction<number>>;
  dumkaEuclidRestPolicy: "silent" | "tied";
  setDumkaEuclidRestPolicy: React.Dispatch<
    React.SetStateAction<"silent" | "tied">
  >;
  dumkaOpWeights: DumkaOpWeights;
  setDumkaOpWeights: React.Dispatch<React.SetStateAction<DumkaOpWeights>>;
  dumkaOpEnabled: DumkaOpEnabled;
  setDumkaOpEnabled: React.Dispatch<React.SetStateAction<DumkaOpEnabled>>;
  dumkaMetricVelocity: MetricVelocity;
  setDumkaMetricVelocity: React.Dispatch<React.SetStateAction<MetricVelocity>>;
  setSeedMode: React.Dispatch<
    React.SetStateAction<GeneratorConfig["seedMode"]["type"]>
  >;
  setSeed: React.Dispatch<React.SetStateAction<number>>;
}

/**
 * Committed-on-blur pattern field following the repo's draft conventions:
 * typing stays local, blur or Cmd/Ctrl+Enter commits, manual Save flushes
 * through the shared draft lifecycle, and a document swap discards.
 */
function DumkaPatternField({
  value,
  disabled,
  onCommit,
}: {
  value: string;
  disabled: boolean;
  onCommit: (pattern: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const commitDraft = () => {
    if (draft !== null && draft !== value) {
      onCommit(draft);
    }
    setDraft(null);
  };
  useEditorDraftLifecycle({
    flush: commitDraft,
    discard: () => setDraft(null),
  });
  const shown = draft ?? value;
  const analysis = useMemo(() => analyzeDumkaPattern(shown), [shown]);
  return (
    <div className="dumka-pattern-field">
      <textarea
        aria-label="Dum-Ka pattern"
        spellCheck={false}
        rows={3}
        value={shown}
        disabled={disabled}
        onChange={(event) => setDraft(event.currentTarget.value)}
        onBlur={commitDraft}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
            event.preventDefault();
            commitDraft();
          }
        }}
      />
      {analysis.ok ? null : (
        <p className="dumka-pattern-issue" role="alert">
          {`line ${analysis.issue.line}, column ${analysis.issue.col}: ${analysis.issue.message}`}
        </p>
      )}
    </div>
  );
}

export function GeneratorEditor({
  open,
  enabled,
  kind,
  densityPercent,
  dumkaPattern,
  dumkaEvolutionRate,
  dumkaDriftLeash,
  dumkaDensityFloor,
  dumkaDensityCeiling,
  dumkaSubdivisionPalette = [],
  dumkaComplexityFloor = 0,
  dumkaComplexityCeiling = 100_000,
  dumkaPlacementBias = 0,
  dumkaStateDepthDiversityMilli = null,
  dumkaPreviewError,
  dumkaRequired,
  dumkaStructureReady,
  dumkaAuthoredSubdivision,
  dumkaProjectionSpans,
  dumkaPlan = [],
  onOpenEvolve,
  seedMode,
  seed,
  playbackStructureLocked,
  setOpen,
  setEnabled,
  setKind,
  setDensityPercent,
  onDumkaPatternCommit,
  onApplyDumkaStructure,
  setDumkaEvolutionRate,
  setDumkaDriftLeash,
  setDumkaDensityFloor,
  setDumkaDensityCeiling,
  setDumkaSubdivisionPalette,
  setDumkaComplexityFloor,
  setDumkaComplexityCeiling,
  setDumkaPlacementBias,
  dumkaBarlowTemperature,
  setDumkaBarlowTemperature,
  dumkaFillComplexity,
  setDumkaFillComplexity,
  dumkaEuclidMaxRun,
  setDumkaEuclidMaxRun,
  dumkaEuclidInvert,
  setDumkaEuclidInvert,
  dumkaEuclidRestPolicy,
  setDumkaEuclidRestPolicy,
  dumkaOpWeights,
  setDumkaOpWeights,
  dumkaOpEnabled,
  setDumkaOpEnabled,
  dumkaMetricVelocity,
  setDumkaMetricVelocity,
  setSeedMode,
  setSeed,
}: GeneratorEditorProps) {
  const [syntaxHelpOpen, setSyntaxHelpOpen] = useState(false);
  const [rollSeedValue, setRollSeedValue] = useState(1);
  const [rollDensity, setRollDensity] = useState<SeedRollDensity>("medium");
  const [rollStyle, setRollStyle] = useState<SeedRollStyle>("plain");
  const dumkaBeatSlotAnalysis = useMemo(
    () => deriveDumkaBeatSlotCounts(dumkaPattern),
    [dumkaPattern]
  );
  const dumkaRollSlotsPerBeat = dumkaBeatSlotAnalysis.ok
    ? dumkaBeatSlotAnalysis.slotsPerBeat
    : null;
  const normalizedPalette = useMemo(
    () => normalizeDumkaSubdivisionPalette(dumkaSubdivisionPalette),
    [dumkaSubdivisionPalette]
  );
  const dumkaWorkingSubdivision = dumkaRequired
    ? workingDumkaSubdivision(
        dumkaRequired.subdivision,
        normalizedPalette
      )
    : null;
  const geometricProfile = useMemo(() => {
    if (dumkaWorkingSubdivision === null) return [];
    const compiled = compileDumkaPattern(dumkaPattern);
    return compiled.ok
      ? geometricPlacementProfile(
          compiled.compiled,
          dumkaWorkingSubdivision
        )
      : [];
  }, [dumkaPattern, dumkaWorkingSubdivision]);
  const paletteFactor = normalizedPalette.reduce(
    (product, level) => product * level,
    1
  );
  const paletteOverCap =
    dumkaWorkingSubdivision !== null &&
    dumkaWorkingSubdivision > DUMKA_MAX_SUBDIVISION;
  // A compatible-but-larger authored Subdivision (e.g. 35 over a pattern
  // needing 5) plays correctly but scales every generator cell's matra
  // count and densifies the timeline; surface the factor and offer the
  // one-click rewrite to the minimal recipe.
  const dumkaOversizedMultiple =
    dumkaStructureReady &&
    dumkaRequired !== null &&
    dumkaAuthoredSubdivision !== null &&
    dumkaWorkingSubdivision !== null &&
    dumkaAuthoredSubdivision !== dumkaWorkingSubdivision &&
    dumkaAuthoredSubdivision % dumkaWorkingSubdivision === 0
      ? dumkaAuthoredSubdivision / dumkaWorkingSubdivision
      : null;
  const subtitle =
    kind === "dumka"
      ? dumkaRequired
        ? `Dum-Ka · ${dumkaRequired.cycleBeats} beats · ${dumkaWorkingSubdivision ?? dumkaRequired.subdivision}/beat working grid`
        : "Dum-Ka · pattern error"
      : `Example · ${Math.round(densityPercent)}% density`;
  const planWindow = dumkaPlan.length
    ? {
        from: Math.min(...dumkaPlan.map((directive) => directive.fromCycle)),
        to: Math.max(...dumkaPlan.map((directive) => directive.toCycle)),
      }
    : null;
  return (
    <details
      id="generator-editor"
      className="modal-surface modal-surface--full main-editor-surface editor-panel panel-state panel-state-generator"
      role="dialog"
      aria-label="Generator editor"
      aria-modal={open}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="editor-panel-summary">
        <PanelHeader
          icon="generator"
          title="Generator"
          subtitle={subtitle}
          strip={[
            { label: "output", value: enabled ? "on" : "off" },
            { label: "seed", value: seedMode },
          ]}
        />
      </summary>
      {open ? (
        <div className="editor-panel-body generator-editor-body">
          <label className="generator-kind-control">
            <span>Algorithm</span>
            <select
              aria-label="Generator kind"
              value={kind}
              disabled={playbackStructureLocked}
              onChange={(event) =>
                setKind(event.currentTarget.value as GeneratorKind)
              }
            >
              <option value="example">Example</option>
              <option value="dumka">Dum-Ka</option>
            </select>
          </label>

          <label className={`generator-switch${enabled ? " is-on" : ""}`}>
            <input
              type="checkbox"
              checked={enabled}
              disabled={playbackStructureLocked}
              onChange={(event) => setEnabled(event.currentTarget.checked)}
            />
            <span aria-hidden="true" />
            <b>{kind === "dumka" ? "Dum-Ka generator" : "Example generator"}</b>
            <em>{enabled ? "Rendering onsets" : "Output muted"}</em>
          </label>

          {kind === "example" ? (
            <label className="generator-density-control">
              <span>
                <b>Density</b>
                <output>{Math.round(densityPercent)}%</output>
              </span>
              <SliderField
                aria-label="Generator density"
                min={0}
                max={100}
                step={1}
                railSize="full"
                value={densityPercent}
                disabled={playbackStructureLocked || !enabled}
                data-automation-target={GENERATOR_DENSITY_AUTOMATION_TARGET}
                onChange={(event) =>
                  setDensityPercent(
                    clamp(event.currentTarget.valueAsNumber, 0, 100)
                  )
                }
              />
            </label>
          ) : (
            <div className="dumka-pattern-control">
              <div className="dumka-pattern-card">
                <span>
                  <b>Pattern</b>
                  <button
                    className="help-icon-button"
                    type="button"
                    aria-label={
                      syntaxHelpOpen
                        ? "Hide pattern syntax reference"
                        : "Show pattern syntax reference"
                    }
                    aria-expanded={syntaxHelpOpen}
                    aria-controls="dumka-syntax-help"
                    title="Show pattern syntax reference"
                    onClick={() => setSyntaxHelpOpen((open) => !open)}
                  >
                    i
                  </button>
                </span>
                <RhythmBuilder
                  pattern={dumkaPattern}
                  disabled={playbackStructureLocked}
                  projectionSpans={dumkaProjectionSpans}
                  onCommit={onDumkaPatternCommit}
                />
                <DumkaPatternField
                  value={dumkaPattern}
                  disabled={playbackStructureLocked}
                  onCommit={onDumkaPatternCommit}
                />
                {dumkaPreviewError ? (
                  <p className="dumka-preview-error" role="alert">
                    {dumkaPreviewError}
                  </p>
                ) : null}
                <div className="dumka-structure-row">
                  <span aria-label="Required structure">
                    {dumkaRequired
                      ? `needs ${dumkaRequired.cycleBeats} beats · Subdivision ${dumkaRequired.subdivision}${
                          paletteFactor > 1
                            ? ` · working ${dumkaWorkingSubdivision} (palette ×${paletteFactor})`
                            : ""
                        }${
                          dumkaOversizedMultiple !== null
                            ? ` · authored ${dumkaAuthoredSubdivision} = ${dumkaOversizedMultiple} × ${dumkaWorkingSubdivision} (compatible; cells show ${dumkaOversizedMultiple}× matra counts)`
                            : ""
                        }`
                      : "fix the pattern to compute its structure"}
                  </span>
                  <button
                    type="button"
                    disabled={
                      playbackStructureLocked ||
                      dumkaRequired === null ||
                      paletteOverCap ||
                      (dumkaStructureReady && dumkaOversizedMultiple === null)
                    }
                    onClick={onApplyDumkaStructure}
                  >
                    {dumkaStructureReady
                      ? dumkaOversizedMultiple !== null
                        ? `Simplify to ${dumkaWorkingSubdivision}`
                        : "Structure ready"
                      : "Apply structure"}
                  </button>
                </div>
                <div
                  className="dumka-depth-palette"
                  role="group"
                  aria-label="Subdivision palette"
                >
                  <span>
                    <b>Depth palette</b>
                    <em>prime refinements</em>
                  </span>
                  <div>
                    {DUMKA_SUBDIVISION_LEVELS.map((level) => {
                      const selected = normalizedPalette.includes(level);
                      return (
                        <button
                          type="button"
                          key={level}
                          className={selected ? "is-active" : undefined}
                          aria-label={`Subdivision level ${level}`}
                          aria-pressed={selected}
                          disabled={
                            playbackStructureLocked ||
                            !setDumkaSubdivisionPalette ||
                            (!selected && normalizedPalette.length >= 2)
                          }
                          onClick={() =>
                            setDumkaSubdivisionPalette?.(
                              selected
                                ? normalizedPalette.filter(
                                    (candidate) => candidate !== level
                                  )
                                : normalizeDumkaSubdivisionPalette([
                                    ...normalizedPalette,
                                    level,
                                  ])
                            )
                          }
                        >
                          ×{level}
                        </button>
                      );
                    })}
                  </div>
                  <output>
                    {dumkaWorkingSubdivision === null
                      ? "Working grid unavailable"
                      : `Working Subdivision ${dumkaWorkingSubdivision}`}
                  </output>
                  {paletteOverCap ? (
                    <p role="alert">
                      Working Subdivision {dumkaWorkingSubdivision} exceeds the
                      platform maximum {DUMKA_MAX_SUBDIVISION}. Remove a level
                      or simplify the pattern.
                    </p>
                  ) : null}
                </div>
                <div
                  className="dumka-roll-row"
                  role="group"
                  aria-label="Euclidean seed roll"
                >
                  <span>
                    <b>Roll a Euclidean seed</b>
                  </span>
                  <NumericField
                    aria-label="Seed roll number"
                    min={0}
                    value={rollSeedValue}
                    disabled={playbackStructureLocked}
                    onValueCommit={(value) =>
                      setRollSeedValue(Math.max(0, Math.round(value)))
                    }
                  />
                  <select
                    aria-label="Seed roll density"
                    value={rollDensity}
                    disabled={playbackStructureLocked}
                    onChange={(event) =>
                      setRollDensity(event.currentTarget.value as SeedRollDensity)
                    }
                  >
                    <option value="sparse">Sparse</option>
                    <option value="medium">Medium</option>
                    <option value="dense">Dense</option>
                  </select>
                  <select
                    aria-label="Seed roll style"
                    value={rollStyle}
                    disabled={playbackStructureLocked}
                    onChange={(event) =>
                      setRollStyle(event.currentTarget.value as SeedRollStyle)
                    }
                  >
                    <option value="plain">Plain E(k,n)</option>
                    <option value="bursts">Bursts</option>
                    <option value="inverted">Inverted</option>
                  </select>
                  <button
                    type="button"
                    disabled={
                      playbackStructureLocked || dumkaRollSlotsPerBeat === null
                    }
                    aria-label="Roll Euclidean seed"
                    title="Writes a rolled Euclidean pattern into the notation (reuses the reshape card's rest policy for expanded styles); bump the number to re-roll"
                    onClick={() => {
                      if (dumkaRollSlotsPerBeat === null) return;
                      onDumkaPatternCommit(
                        rollEuclideanSeed(rollSeedValue, {
                          slotsPerBeat: dumkaRollSlotsPerBeat,
                          density: rollDensity,
                          style: rollStyle,
                          restPolicy: dumkaEuclidRestPolicy,
                        })
                      );
                    }}
                  >
                    Roll
                  </button>
                </div>
                {syntaxHelpOpen ? (
                  <div
                    id="dumka-syntax-help"
                    className="dumka-syntax-help"
                    role="region"
                    aria-label="Pattern syntax reference"
                  >
                    <p>
                      A pattern is one cycle written as a tree. Elements divide
                      time evenly; group weights make tuplets anywhere:{" "}
                      <code>[x x x x x]@2</code> is five in the time of two
                      beats.
                    </p>
                    <dl>
                      {DUMKA_SYNTAX_ROWS.map(([token, meaning]) => (
                        <div key={token}>
                          <dt>
                            <code>{token}</code>
                          </dt>
                          <dd>{meaning}</dd>
                        </div>
                      ))}
                    </dl>
                    <p>
                      Cycle beats are the top-level weight sum; the readout
                      above shows the Subdivision the pattern needs and Apply
                      structure authors both. Notes and holds may sustain
                      across beat and Grouping boundaries; the generator emits
                      paired tie cells and the timeline joins them into one
                      audible note. Articulate remains an optional detached
                      style, not a structural requirement.
                    </p>
                  </div>
                ) : null}
              </div>
              <button
                className="generator-plan-link"
                type="button"
                disabled={onOpenEvolve === undefined}
                onClick={onOpenEvolve}
              >
                <span>
                  <b>Evolution score</b>
                  <em>
                    {planWindow
                      ? `${dumkaPlan.length} directive${dumkaPlan.length === 1 ? "" : "s"} · cycles ${planWindow.from}–${planWindow.to}`
                      : "No directives · stochastic layer only"}
                  </em>
                </span>
                <strong>Open Evolve</strong>
              </button>
              <fieldset className="dumka-depth-controls">
                <legend>Depth</legend>
                {dumkaStateDepthDiversityMilli !== null ? (
                  <div
                    className="dumka-depth-insight"
                    role="status"
                    aria-label={`Depth diversity ${(dumkaStateDepthDiversityMilli / 1_000).toFixed(1)}`}
                  >
                    <span>Depth diversity</span>
                    <output>
                      {(dumkaStateDepthDiversityMilli / 1_000).toFixed(1)}
                    </output>
                    <em>current preview</em>
                  </div>
                ) : null}
                <div className="dumka-depth-control-head">
                  <span>
                    <b>Complexity corridor</b>
                    <em>attack-point depth, 0.0–100.0</em>
                  </span>
                  <output>
                    {(dumkaComplexityFloor / 1_000).toFixed(1)}–
                    {(dumkaComplexityCeiling / 1_000).toFixed(1)}
                  </output>
                </div>
                <div className="dumka-depth-field-grid">
                  <label>
                    <span>Floor</span>
                    <NumericField
                      aria-label="Complexity floor"
                      min={0}
                      max={dumkaComplexityCeiling / 1_000}
                      step={0.1}
                      numericMode="decimal"
                      size="compact"
                      data-automation-target={DUMKA_COMPLEXITY_FLOOR_AUTOMATION_TARGET}
                      value={dumkaComplexityFloor / 1_000}
                      disabled={
                        playbackStructureLocked || !setDumkaComplexityFloor
                      }
                      onValueCommit={(value) =>
                        setDumkaComplexityFloor?.(
                          Math.min(
                            dumkaComplexityCeiling,
                            Math.max(0, Math.round(value * 1_000))
                          )
                        )
                      }
                    />
                  </label>
                  <label>
                    <span>Ceiling</span>
                    <NumericField
                      aria-label="Complexity ceiling"
                      min={dumkaComplexityFloor / 1_000}
                      max={100}
                      step={0.1}
                      numericMode="decimal"
                      size="compact"
                      data-automation-target={DUMKA_COMPLEXITY_CEILING_AUTOMATION_TARGET}
                      value={dumkaComplexityCeiling / 1_000}
                      disabled={
                        playbackStructureLocked || !setDumkaComplexityCeiling
                      }
                      onValueCommit={(value) =>
                        setDumkaComplexityCeiling?.(
                          Math.max(
                            dumkaComplexityFloor,
                            Math.min(100_000, Math.round(value * 1_000))
                          )
                        )
                      }
                    />
                  </label>
                </div>
                <label className="dumka-placement-bias">
                  <span>
                    <b>Placement</b>
                    <em>metric</em>
                    <output>{Math.round(dumkaPlacementBias)}%</output>
                    <em>void</em>
                  </span>
                  <SliderField
                    aria-label="Geometric placement bias"
                    min={0}
                    max={100}
                    step={1}
                    railSize="full"
                    value={dumkaPlacementBias}
                    data-automation-target={DUMKA_PLACEMENT_BIAS_AUTOMATION_TARGET}
                    disabled={
                      playbackStructureLocked || !setDumkaPlacementBias
                    }
                    onChange={(event) =>
                      setDumkaPlacementBias?.(
                        clamp(event.currentTarget.valueAsNumber, 0, 100)
                      )
                    }
                  />
                </label>
                <div
                  className="dumka-geometric-field"
                  role="img"
                  aria-label={`Placement blend: ${Math.round(
                    100 - dumkaPlacementBias
                  )}% metric, ${Math.round(dumkaPlacementBias)}% geometric void seeking`}
                  style={
                    {
                      "--dumka-placement-bias": `${clamp(
                        dumkaPlacementBias,
                        0,
                        100
                      )}%`,
                      "--dumka-field-slots": Math.max(
                        1,
                        geometricProfile.length
                      ),
                    } as React.CSSProperties
                  }
                >
                  {geometricProfile.map((preference, slot) => (
                    <i
                      key={slot}
                      aria-hidden="true"
                      style={
                        {
                          "--dumka-field-height": `${Math.max(
                            8,
                            Math.round(preference / 10)
                          )}%`,
                        } as React.CSSProperties
                      }
                    />
                  ))}
                  <b aria-hidden="true" />
                </div>
                <p>
                  The corridor limits refined attacks. Placement blends metric
                  strength with gap seeking; the evolution curve still controls
                  how quickly legal changes arrive.
                </p>
              </fieldset>
              <EvolutionPanels
                pattern={dumkaPattern}
                structureLocked={playbackStructureLocked}
                enabled={enabled}
                evolutionRate={dumkaEvolutionRate}
                setEvolutionRate={setDumkaEvolutionRate}
                driftLeash={dumkaDriftLeash}
                setDriftLeash={setDumkaDriftLeash}
                densityFloor={dumkaDensityFloor}
                setDensityFloor={setDumkaDensityFloor}
                densityCeiling={dumkaDensityCeiling}
                setDensityCeiling={setDumkaDensityCeiling}
                barlowTemperature={dumkaBarlowTemperature}
                setBarlowTemperature={setDumkaBarlowTemperature}
                fillComplexity={dumkaFillComplexity}
                setFillComplexity={setDumkaFillComplexity}
                euclidMaxRun={dumkaEuclidMaxRun}
                setEuclidMaxRun={setDumkaEuclidMaxRun}
                euclidInvert={dumkaEuclidInvert}
                setEuclidInvert={setDumkaEuclidInvert}
                euclidRestPolicy={dumkaEuclidRestPolicy}
                setEuclidRestPolicy={setDumkaEuclidRestPolicy}
                opWeights={dumkaOpWeights}
                setOpWeights={setDumkaOpWeights}
                opEnabled={dumkaOpEnabled}
                setOpEnabled={setDumkaOpEnabled}
                metricVelocity={dumkaMetricVelocity}
                setMetricVelocity={setDumkaMetricVelocity}
              />
            </div>
          )}

          <div className="generator-seed-controls" aria-label="Generator seed controls">
            <label>
              <span>Seed mode</span>
              <select
                aria-label="Generator seed mode"
                value={seedMode}
                disabled={playbackStructureLocked}
                onChange={(event) =>
                  setSeedMode(
                    event.currentTarget.value as GeneratorConfig["seedMode"]["type"]
                  )
                }
              >
                <option value="locked">Locked</option>
                <option value="perCycle">PerCycle</option>
                <option value="history">History</option>
              </select>
            </label>
            <label>
              <span>Seed</span>
              <NumericField
                aria-label="Generator seed"
                min={0}
                value={seed}
                disabled={playbackStructureLocked}
                onValueCommit={(value) => setSeed(normalizeSeedValue(value))}
              />
            </label>
          </div>
        </div>
      ) : null}
    </details>
  );
}
