import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import {
  DUMKA_BARLOW_TEMPERATURE_AUTOMATION_TARGET,
  DUMKA_DENSITY_CEILING_AUTOMATION_TARGET,
  DUMKA_DENSITY_FLOOR_AUTOMATION_TARGET,
  DUMKA_DRIFT_LEASH_AUTOMATION_TARGET,
  DUMKA_EVOLUTION_RATE_AUTOMATION_TARGET,
  DUMKA_FILL_COMPLEXITY_AUTOMATION_TARGET,
} from "../automationTargets";
import {
  barlowPoolSize,
  figureCandidateCounts,
  gridInsight,
  leashBudget,
  type DumkaGridInsight,
} from "../dumkaMetrics";
import { compileDumkaPattern, type DumkaOpWeights } from "../dumkaPattern";
import { NumericField } from "../NumericField";
import { clamp } from "../patchIo";
import { SliderField } from "../SliderField";

/** Grids finer than this render a notice instead of per-pulse lanes. */
const MAX_LANE_SLOTS = 256;

/** One algorithm card: title, always-visible live line, ⓘ-disclosed depth. */
function InsightCard({
  title,
  helpLabel,
  help,
  children,
}: {
  title: string;
  helpLabel: string;
  help: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <section className="evo-card" aria-label={title}>
      <header>
        <b>{title}</b>
        <button
          className="help-icon-button"
          type="button"
          aria-label={`${open ? "Hide" : "Show"} ${helpLabel}`}
          aria-expanded={open}
          title={`Show ${helpLabel}`}
          onClick={() => setOpen((current) => !current)}
        >
          i
        </button>
      </header>
      {children}
      {open ? (
        <div className="evo-help" role="region" aria-label={helpLabel}>
          {help}
        </div>
      ) : null}
    </section>
  );
}

function WeightField({
  label,
  ariaLabel,
  value,
  odds,
  disabled,
  onCommit,
}: {
  label: string;
  ariaLabel: string;
  value: number;
  odds: string;
  disabled: boolean;
  onCommit: (value: number) => void;
}) {
  return (
    <label className="evo-weight">
      <span>{label}</span>
      <NumericField
        aria-label={ariaLabel}
        min={0}
        max={100}
        value={value}
        disabled={disabled}
        onValueCommit={onCommit}
      />
      <em>{odds}</em>
    </label>
  );
}

/** Barlow rank bars with the live Remove/Add candidate pools outlined. */
function RankLane({
  insight,
  temperature,
}: {
  insight: DumkaGridInsight;
  temperature: number;
}) {
  const removePool = new Set(
    insight.removeOrder.slice(
      0,
      barlowPoolSize(temperature, insight.removeOrder.length)
    )
  );
  const addPool = new Set(
    insight.addOrder.slice(0, barlowPoolSize(temperature, insight.addOrder.length))
  );
  const top = insight.slots - 1;
  return (
    <div
      className="evo-lane"
      role="img"
      aria-label={`Indispensability ranks for ${insight.slots} pulses; Remove pool ${removePool.size}, Add pool ${addPool.size}`}
    >
      {insight.ranks.map((rank, slot) => {
        const sounding = insight.onsetSlots.includes(slot);
        const status = sounding
          ? "sounding"
          : insight.occupied[slot]
            ? "sustained"
            : "silent";
        const pool = removePool.has(slot)
          ? " is-remove-pool"
          : addPool.has(slot)
            ? " is-add-pool"
            : "";
        return (
          <span
            key={slot}
            className={`evo-lane-slot is-${status}${pool}`}
            title={`pulse ${slot}: rank ${rank}, ${status}${
              removePool.has(slot)
                ? " — in the Remove pool"
                : addPool.has(slot)
                  ? " — in the Add pool"
                  : ""
            }`}
          >
            <i style={{ height: `${top === 0 ? 100 : 8 + (92 * rank) / top}%` }} />
          </span>
        );
      })}
    </div>
  );
}

function DensityCorridorMeter({
  floor,
  ceiling,
  density,
}: {
  floor: number;
  ceiling: number;
  density: number | null;
}) {
  return (
    <div
      className="evo-density-corridor"
      role="img"
      aria-label={`Density corridor ${floor}% through ${ceiling}%${density === null ? "" : `; seed density ${density}%`}`}
      style={
        {
          "--corridor-floor": `${floor}%`,
          "--corridor-width": `${Math.max(0, ceiling - floor)}%`,
          "--seed-density": `${density ?? 0}%`,
        } as CSSProperties
      }
    >
      <span aria-hidden="true" />
      {density === null ? null : <i aria-hidden="true" />}
    </div>
  );
}

/** Sioros metrical template: taller mark = stronger (slower) pulse. */
function LevelLane({ insight }: { insight: DumkaGridInsight }) {
  const maxLevel = insight.strata.length;
  return (
    <div
      className="evo-lane"
      role="img"
      aria-label={`Metrical template for ${insight.slots} pulses across ${maxLevel + 1} levels; beat level ${insight.beatLevel}`}
    >
      {insight.levels.map((level, slot) => {
        const sounding = insight.onsetSlots.includes(slot);
        const strength = maxLevel - level + 1;
        return (
          <span
            key={slot}
            className={`evo-lane-slot is-${sounding ? "sounding" : "silent"}${
              level <= insight.beatLevel ? " is-beat-pulse" : ""
            }`}
            title={`pulse ${slot}: level ${level}${
              level <= insight.beatLevel ? " (at or above the beat)" : ""
            }${sounding ? ", sounding" : ""}`}
          >
            <i style={{ height: `${(100 * strength) / (maxLevel + 1)}%` }} />
          </span>
        );
      })}
    </div>
  );
}

export interface EvolutionPanelsProps {
  pattern: string;
  structureLocked: boolean;
  enabled: boolean;
  evolutionRate: number;
  setEvolutionRate: React.Dispatch<React.SetStateAction<number>>;
  driftLeash: number;
  setDriftLeash: React.Dispatch<React.SetStateAction<number>>;
  densityFloor: number;
  setDensityFloor: React.Dispatch<React.SetStateAction<number>>;
  densityCeiling: number;
  setDensityCeiling: React.Dispatch<React.SetStateAction<number>>;
  barlowTemperature: number;
  setBarlowTemperature: React.Dispatch<React.SetStateAction<number>>;
  fillComplexity: number;
  setFillComplexity: React.Dispatch<React.SetStateAction<number>>;
  euclidMaxRun: number;
  setEuclidMaxRun: React.Dispatch<React.SetStateAction<number>>;
  euclidInvert: number;
  setEuclidInvert: React.Dispatch<React.SetStateAction<number>>;
  euclidRestPolicy: "silent" | "tied";
  setEuclidRestPolicy: React.Dispatch<React.SetStateAction<"silent" | "tied">>;
  opWeights: DumkaOpWeights;
  setOpWeights: React.Dispatch<React.SetStateAction<DumkaOpWeights>>;
}

/**
 * The granular per-algorithm control surface for Dum-Ka evolution: each
 * family gets its controls, its live numbers (computed with the exact
 * engine formulas mirrored in dumkaMetrics.ts), an engine-pinned
 * visualization on the pattern's own grid, and a disclosed explanation of
 * how it composes with the rest of the pipeline.
 */
export function EvolutionPanels({
  pattern,
  structureLocked,
  enabled,
  evolutionRate,
  setEvolutionRate,
  driftLeash,
  setDriftLeash,
  densityFloor,
  setDensityFloor,
  densityCeiling,
  setDensityCeiling,
  barlowTemperature,
  setBarlowTemperature,
  fillComplexity,
  setFillComplexity,
  euclidMaxRun,
  setEuclidMaxRun,
  euclidInvert,
  setEuclidInvert,
  euclidRestPolicy,
  setEuclidRestPolicy,
  opWeights,
  setOpWeights,
}: EvolutionPanelsProps) {
  const sliderDisabled = structureLocked || !enabled;
  const compiled = useMemo(() => compileDumkaPattern(pattern), [pattern]);
  const insight = useMemo(
    () => (compiled.ok ? gridInsight(compiled.compiled) : null),
    [compiled]
  );
  const onsets = compiled.ok ? compiled.compiled.events.length : 0;
  const seedDensity =
    insight && insight.slots > 0
      ? Math.round((100 * insight.onsetSlots.length) / insight.slots)
      : null;

  const total =
    opWeights.barlowRemove +
    opWeights.barlowAdd +
    opWeights.rotate +
    opWeights.syncopate +
    opWeights.desyncopate +
    opWeights.fragment +
    opWeights.consolidate +
    opWeights.euclid;
  const figureCounts = compiled.ok
    ? figureCandidateCounts(compiled.compiled)
    : null;
  const odds = (weight: number): string =>
    total === 0 ? "—" : `${weight}/${total} ≈ ${Math.round((100 * weight) / total)}%`;
  const setWeight =
    (key: keyof DumkaOpWeights) =>
    (value: number): void =>
      setOpWeights((weights) => ({
        ...weights,
        [key]: clamp(Math.round(value), 0, 100),
      }));

  const budget = leashBudget(driftLeash, onsets);
  const removePool = insight
    ? barlowPoolSize(barlowTemperature, insight.removeOrder.length)
    : 0;
  const addPool = insight
    ? barlowPoolSize(barlowTemperature, insight.addOrder.length)
    : 0;
  const lanesTooFine = insight !== null && insight.slots > MAX_LANE_SLOTS;
  const verbatimGrid = compiled.ok && insight === null;

  return (
    <div className="evolution-panels">
      <InsightCard
        title="Evolution pipeline"
        helpLabel="evolution pipeline reference"
        help={
          <>
            <p>
              Cycle N is a pure fold of cycles 1..N from the seed: the same
              seed, pattern, and knobs always replay byte-identically, in
              preview and playback alike. Each cycle start re-samples any
              automated knob (rate, leash, temperature), so an automation
              ramp changes the trajectory deterministically.
            </p>
            <p>
              Seed modes: <b>Locked</b> is one trajectory per seed — re-roll
              for a different piece. <b>PerCycle</b> re-bases the fold on a
              per-cycle seed ("parallel universe at cycle N");{" "}
              <b>History</b> re-bases on the weighted seed pool.
            </p>
          </>
        }
      >
        <ol className="evo-pipeline" aria-label="Evolution pipeline stages">
          <li>
            <b>fire?</b> rate {Math.round(evolutionRate)}%
          </li>
          <li>
            <b>draw operator</b> weights below
          </li>
          <li>
            <b>choose target</b> ranks · template · temperature
          </li>
          <li>
            <b>guards</b> corridor {Math.round(densityFloor)}–{Math.round(densityCeiling)}% · leash {budget} · trial projection
          </li>
        </ol>
        <label className="evo-slider">
          <span>
            <b>Evolution rate</b>
            <output>{Math.round(evolutionRate)}%</output>
          </span>
          <SliderField
            aria-label="Dum-Ka evolution rate"
            min={0}
            max={100}
            step={1}
            railSize="full"
            value={evolutionRate}
            disabled={sliderDisabled}
            data-automation-target={DUMKA_EVOLUTION_RATE_AUTOMATION_TARGET}
            onChange={(event) =>
              setEvolutionRate(clamp(event.currentTarget.valueAsNumber, 0, 100))
            }
          />
        </label>
        <p className="evo-live">
          {evolutionRate <= 0
            ? "At 0% the seed repeats verbatim, forever."
            : `Each cycle has a ${Math.round(evolutionRate)}% chance to change — about 1 cycle in ${Math.max(1, Math.round(100 / evolutionRate))}.`}
          {total === 0
            ? " All operator weights are zero, so even a fired cycle keeps the pattern frozen."
            : ""}
          {" The stochastic layer applies only where no authored directive is active; a Stochastic directive explicitly re-enters it."}
        </p>
      </InsightCard>

      <InsightCard
        title="Density — Barlow indispensability"
        helpLabel="Barlow density reference"
        help={
          <>
            <p>
              Every pulse of the stratified meter gets a unique
              indispensability rank (Barlow 1987; the module is pinned
              against the published tables). <b>Remove</b> silences the
              least indispensable sounding onset — density falls, metric
              feel survives. <b>Add</b> sounds the most indispensable free
              pulse (sustains block it) as a one-slot hit that inherits the
              preceding stroke class.
            </p>
            <p>
              <b>Temperature</b> widens the candidate pool over the rank
              order instead of always taking the strictest choice — an
              integer approximation of Barlow's field-strength formula, kept
              exact so replay never depends on platform float math. The
              outlined bars below are the actual pools at the current
              temperature.
            </p>
            <p>
              The <b>density corridor</b> is the authored onset-density rail.
              Every evolution layer must remain between its floor and ceiling;
              0–100% preserves the historical trajectory exactly.
            </p>
          </>
        }
      >
        <div className="evo-weight-row">
          <WeightField
            label="Remove"
            ariaLabel="Dum-Ka remove weight"
            value={opWeights.barlowRemove}
            odds={odds(opWeights.barlowRemove)}
            disabled={structureLocked}
            onCommit={setWeight("barlowRemove")}
          />
          <WeightField
            label="Add"
            ariaLabel="Dum-Ka add weight"
            value={opWeights.barlowAdd}
            odds={odds(opWeights.barlowAdd)}
            disabled={structureLocked}
            onCommit={setWeight("barlowAdd")}
          />
        </div>
        <label className="evo-slider">
          <span>
            <b>Barlow temperature</b>
            <output>{Math.round(barlowTemperature)}%</output>
          </span>
          <SliderField
            aria-label="Dum-Ka Barlow temperature"
            min={0}
            max={100}
            step={1}
            railSize="full"
            value={barlowTemperature}
            disabled={sliderDisabled}
            data-automation-target={DUMKA_BARLOW_TEMPERATURE_AUTOMATION_TARGET}
            onChange={(event) =>
              setBarlowTemperature(
                clamp(event.currentTarget.valueAsNumber, 0, 100)
              )
            }
          />
        </label>
        <div className="evo-corridor-controls" role="group" aria-label="Dum-Ka density corridor">
          <label className="evo-slider">
            <span>
              <b>Density floor</b>
              <output>{Math.round(densityFloor)}%</output>
            </span>
            <SliderField
              aria-label="Dum-Ka density floor"
              min={0}
              max={densityCeiling}
              step={1}
              railSize="full"
              value={densityFloor}
              disabled={sliderDisabled}
              data-automation-target={DUMKA_DENSITY_FLOOR_AUTOMATION_TARGET}
              onChange={(event) =>
                setDensityFloor(
                  clamp(event.currentTarget.valueAsNumber, 0, densityCeiling)
                )
              }
            />
          </label>
          <label className="evo-slider">
            <span>
              <b>Density ceiling</b>
              <output>{Math.round(densityCeiling)}%</output>
            </span>
            <SliderField
              aria-label="Dum-Ka density ceiling"
              min={densityFloor}
              max={100}
              step={1}
              railSize="full"
              value={densityCeiling}
              disabled={sliderDisabled}
              data-automation-target={DUMKA_DENSITY_CEILING_AUTOMATION_TARGET}
              onChange={(event) =>
                setDensityCeiling(
                  clamp(event.currentTarget.valueAsNumber, densityFloor, 100)
                )
              }
            />
          </label>
        </div>
        <DensityCorridorMeter
          floor={Math.round(densityFloor)}
          ceiling={Math.round(densityCeiling)}
          density={seedDensity}
        />
        {insight && !lanesTooFine ? (
          <>
            <RankLane insight={insight} temperature={barlowTemperature} />
            <p className="evo-live">
              {`Remove draws from the ${removePool} weakest of ${insight.removeOrder.length} sounding pulses; Add from the ${addPool} strongest of ${insight.addOrder.length} free pulses.`}
            </p>
          </>
        ) : null}
        {lanesTooFine && insight ? (
          <p className="evo-live">
            Grid too fine to draw ({insight.slots} pulses); the ranks still
            govern Remove/Add exactly as described.
          </p>
        ) : null}
        {verbatimGrid ? (
          <p className="evo-live evo-verbatim" role="note">
            This grid has a prime factor beyond 7 — no published Ψ table —
            so evolution deterministically plays the seed verbatim.
          </p>
        ) : null}
      </InsightCard>

      <InsightCard
        title="Displacement — Sioros–Guedes"
        helpLabel="Sioros displacement reference"
        help={
          <>
            <p>
              From the same strata, every pulse gets a metrical level (0 =
              cycle start; taller marks below are stronger pulses).{" "}
              <b>Syncopate</b> anticipates an onset backward off a strong
              pulse onto a silent faster pulse; <b>Desyncopate</b> resolves
              a felt syncopation forward onto its silent strong pulse. Each
              move is a {"{pulse, type}"} vector, so the pair is exactly
              reversible (Sioros, <i>Syncopation as Transformation</i>, U.
              Porto 2015, ch. 4).
            </p>
            <p>
              Onsets never hop over other onsets or land on occupied pulses;
              same-level shifts exist only inside ternary strata, never at
              or above the beat level; both directions are off by default
              (weight 0) and a displacement charges the drift leash like an
              add plus a remove.
            </p>
          </>
        }
      >
        <div className="evo-weight-row">
          <WeightField
            label="Syncopate"
            ariaLabel="Dum-Ka syncopate weight"
            value={opWeights.syncopate}
            odds={odds(opWeights.syncopate)}
            disabled={structureLocked}
            onCommit={setWeight("syncopate")}
          />
          <WeightField
            label="Desyncopate"
            ariaLabel="Dum-Ka desyncopate weight"
            value={opWeights.desyncopate}
            odds={odds(opWeights.desyncopate)}
            disabled={structureLocked}
            onCommit={setWeight("desyncopate")}
          />
        </div>
        {insight && !lanesTooFine ? <LevelLane insight={insight} /> : null}
        {verbatimGrid ? (
          <p className="evo-live evo-verbatim" role="note">
            No template on this grid (prime factor beyond 7): displacement
            never fires.
          </p>
        ) : null}
      </InsightCard>

      <InsightCard
        title="Figures — fragmentation"
        helpLabel="figures reference"
        help={
          <>
            <p>
              <b>Fragment</b> splits one held note (or one silent run) into
              a figure of k onsets at the E(k, n) positions over its own
              slots — a true equal tuplet whenever k divides n, the
              maximally even on-grid figure otherwise (Mongeau &amp;
              Sankoff's fragmentation; Bjorklund placement).{" "}
              <b>Consolidate</b> merges a contiguous run back into one
              note — the exact inverse. Interval choice ranks by the same
              indispensability tables as Add/Remove and widens with the
              temperature pool.
            </p>
            <p>
              <b>Fill complexity</b> biases the figure size: 0 always takes
              the simplest true tuplet, 100 draws over every legal size.
              Figures charge the drift leash like adds and removes, and a
              fragment whose sustain would cross a span boundary is skipped
              for that cycle. Finer-than-grid tuplets stay gated on the
              platform upsample extension (ROADMAP M6+).
            </p>
          </>
        }
      >
        <div className="evo-weight-row">
          <WeightField
            label="Fragment"
            ariaLabel="Dum-Ka fragment weight"
            value={opWeights.fragment}
            odds={odds(opWeights.fragment)}
            disabled={structureLocked}
            onCommit={setWeight("fragment")}
          />
          <WeightField
            label="Consolidate"
            ariaLabel="Dum-Ka consolidate weight"
            value={opWeights.consolidate}
            odds={odds(opWeights.consolidate)}
            disabled={structureLocked}
            onCommit={setWeight("consolidate")}
          />
        </div>
        <label className="evo-slider">
          <span>
            <b>Fill complexity</b>
            <output>{Math.round(fillComplexity)}%</output>
          </span>
          <SliderField
            aria-label="Dum-Ka fill complexity"
            min={0}
            max={100}
            step={1}
            railSize="full"
            value={fillComplexity}
            disabled={sliderDisabled}
            data-automation-target={DUMKA_FILL_COMPLEXITY_AUTOMATION_TARGET}
            onChange={(event) =>
              setFillComplexity(clamp(event.currentTarget.valueAsNumber, 0, 100))
            }
          />
        </label>
        {figureCounts ? (
          <p className="evo-live">
            {`The seed has ${figureCounts.fragmentable} fragmentable ${
              figureCounts.fragmentable === 1 ? "interval" : "intervals"
            } (longest ${figureCounts.longestInterval} slots) and ${
              figureCounts.consolidatable
            } consolidatable ${
              figureCounts.consolidatable === 1 ? "run" : "runs"
            }.`}
          </p>
        ) : null}
      </InsightCard>

      <InsightCard
        title="Euclidean — reshape"
        helpLabel="Euclidean reshape reference"
        help={
          <>
            <p>
              Reshape redistributes one window's onsets onto the maximally
              even necklace over its own slots — Bjorklund's E(k, n) with an
              identity-seeded rotation draw (Toussaint; the same masks the
              notation's E sugar and the channel strategies use). Windows
              are every whole beat plus the whole cycle; candidates rank by
              the same indispensability order as the other families and
              widen with the temperature pool. Onset count and stroke
              classes are preserved unless inversion fires.
            </p>
            <p>
              The Caesura extension set rides along: <b>max run</b> &gt; 1
              clusters onsets into bursts of at most that length;{" "}
              <b>invert</b> complements the mask (k onsets become n−k — the
              complement of a Euclidean rhythm is again Euclidean), charged
              to the leash like any density change; the <b>rest policy</b>{" "}
              plays reshaped onsets tied to the next onset or as one-slot
              hits. Cycle-scope reshapes with tied durations need spans
              that can hold the sustains; per-beat structures resolve them
              with the silent policy.
            </p>
          </>
        }
      >
        <div className="evo-weight-row">
          <WeightField
            label="Reshape"
            ariaLabel="Dum-Ka euclid weight"
            value={opWeights.euclid}
            odds={odds(opWeights.euclid)}
            disabled={structureLocked}
            onCommit={setWeight("euclid")}
          />
          <label className="evo-weight">
            <span>Max run</span>
            <NumericField
              aria-label="Dum-Ka euclid max run"
              min={1}
              max={8}
              value={euclidMaxRun}
              disabled={structureLocked}
              onValueCommit={(value) =>
                setEuclidMaxRun(clamp(Math.round(value), 1, 8))
              }
            />
            <em>{euclidMaxRun === 1 ? "plain" : `bursts ≤ ${euclidMaxRun}`}</em>
          </label>
          <label className="evo-weight">
            <span>Invert</span>
            <NumericField
              aria-label="Dum-Ka euclid invert chance"
              min={0}
              max={100}
              value={euclidInvert}
              disabled={structureLocked}
              onValueCommit={(value) =>
                setEuclidInvert(clamp(Math.round(value), 0, 100))
              }
            />
            <em>{euclidInvert === 0 ? "never" : `${euclidInvert}% of fires`}</em>
          </label>
          <label className="evo-weight">
            <span>Rests</span>
            <select
              aria-label="Dum-Ka euclid rest policy"
              value={euclidRestPolicy}
              disabled={structureLocked}
              onChange={(event) =>
                setEuclidRestPolicy(
                  event.currentTarget.value === "silent" ? "silent" : "tied"
                )
              }
            >
              <option value="tied">Tied</option>
              <option value="silent">Silent</option>
            </select>
            <em>{euclidRestPolicy === "tied" ? "sustain to next" : "one-slot hits"}</em>
          </label>
        </div>
        {compiled.ok ? (
          <p className="evo-live">
            {`Windows: ${compiled.compiled.totalBeats} beats${
              compiled.compiled.totalBeats > 1 ? " plus the whole cycle" : ""
            }, reshaped over ${compiled.compiled.requiredSubdivision} ${
              compiled.compiled.requiredSubdivision === 1 ? "slot" : "slots"
            } per beat.`}
          </p>
        ) : null}
      </InsightCard>

      <InsightCard
        title="Rotation"
        helpLabel="rotation reference"
        help={
          <p>
            Rotation moves the whole pattern one beat earlier or later
            through a rotation register — beat-class transposition T_k. The
            register lives in the unrotated frame, where indispensability
            keeps its meaning, and rotation is always reversible, so it is
            not charged against the leash.
          </p>
        }
      >
        <div className="evo-weight-row">
          <WeightField
            label="Rotate"
            ariaLabel="Dum-Ka rotate weight"
            value={opWeights.rotate}
            odds={odds(opWeights.rotate)}
            disabled={structureLocked}
            onCommit={setWeight("rotate")}
          />
        </div>
      </InsightCard>

      <InsightCard
        title="Guards — corridor, leash, projection"
        helpLabel="guards reference"
        help={
          <>
            <p>
              The density corridor has first priority: it governs how many
              onsets may sound, including authored directives. The leash is
              second and governs only stochastic identity drift. Trial
              projection is the final playability fence.
            </p>
            <p>
              The leash bounds the symmetric difference between the current
              and seed onset sets. If automation tightens it below the
              inherited drift, deterministic removals/restorations contract
              the state before that cycle's operator is even considered.
            </p>
            <p>
              Every candidate result is also trial-projected against the real
              structural spans. Cross-span sustains use paired ties; malformed
              tiling or incompatible structure still fails closed.
            </p>
          </>
        }
      >
        <label className="evo-slider">
          <span>
            <b>Drift leash</b>
            <output>{Math.round(driftLeash)}%</output>
          </span>
          <SliderField
            aria-label="Dum-Ka drift leash"
            min={0}
            max={100}
            step={1}
            railSize="full"
            value={driftLeash}
            disabled={sliderDisabled}
            data-automation-target={DUMKA_DRIFT_LEASH_AUTOMATION_TARGET}
            onChange={(event) =>
              setDriftLeash(clamp(event.currentTarget.valueAsNumber, 0, 100))
            }
          />
        </label>
        <p className="evo-live">
          {compiled.ok
            ? `Budget: ⌈${Math.round(driftLeash)}% × ${onsets} seed onsets⌉ = ${budget} ${budget === 1 ? "slot" : "slots"} of drift from the seed.`
            : "Fix the pattern to compute the leash budget."}
        </p>
      </InsightCard>
    </div>
  );
}
