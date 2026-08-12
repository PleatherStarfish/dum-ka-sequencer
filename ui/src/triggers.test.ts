/**
 * Tests for Triggered Tracks frontend plumbing: config normalization /
 * resilience, trigger-graph validation (the extracted pure helper), patch
 * round-trip, and dangling-source import handling. These mirror the backend
 * `cseq_trigger` normalization so the UI never ships config the engine would
 * silently reject differently.
 */
import { describe, expect, it } from "vitest";

import type { TriggerConfig } from "./bridge";
import {
  DEFAULT_TRIGGER_MAX_REPEATS,
  GATE_COOLDOWN_CYCLES_CAP,
  GATE_PROBABILITY_MAX,
  MAX_CONDITION_NODES,
  MAX_START_OPTIONS,
  MAX_START_WEIGHT,
  TRIGGER_MAX_REPEATS_CAP,
  buildTrackEnvelope,
  effectiveTriggerWhen,
  enforceTriggerGraph,
  parallelSilentSourceIds,
  normalizeLaunchQuantize,
  normalizeTriggerBeatSelector,
  normalizeTriggerCondition,
  normalizeTriggerConditionNode,
  normalizeTriggerConfig,
  normalizeTriggerCountOp,
  normalizeTriggerLaunchAlignment,
  normalizeTriggerLength,
  normalizeTriggerLifetime,
  normalizeTriggerQuantizeDirection,
  normalizeTriggerQuantizeGrid,
  normalizeGateSpec,
  normalizeStartSelect,
  normalizeTriggerReTrigger,
  normalizeTriggerWhenPredicate,
  normalizeWhenSpec,
  readPatchDocument,
  readTrackEnvelope,
  spliceImportedTrack,
  type ParallelTrackPatch,
} from "./patchIo";
import { makeMinimalProject, makeMinimalTrack } from "./__fixtures__/patch";

function validTrigger(source = "lead"): TriggerConfig {
  return {
    sourceTrackId: source,
    condition: { type: "beatIsRest", beat: 3 },
    launchAlignment: { type: "atEvent" },
    lifetime: { type: "onePass" },
    reTrigger: "restart",
    length: { type: "scoreCycle" },
    maxRepeats: 64,
  };
}

describe("normalizeTriggerConfig", () => {
  it("returns null for non-records and missing source", () => {
    expect(normalizeTriggerConfig(null)).toBeNull();
    expect(normalizeTriggerConfig("triggered")).toBeNull();
    expect(normalizeTriggerConfig(42)).toBeNull();
    expect(normalizeTriggerConfig({})).toBeNull();
    expect(normalizeTriggerConfig({ sourceTrackId: "" })).toBeNull();
  });

  it("coerces a partial config to safe defaults", () => {
    const cfg = normalizeTriggerConfig({ sourceTrackId: "lead" });
    expect(cfg).not.toBeNull();
    // No `when`/`condition` ⇒ the default WHEN spec, and the legacy field is cleared.
    expect(cfg!.when).toEqual({
      beats: { type: "at", beat: 0 },
      tree: { type: "leaf", predicate: { type: "isRest" } },
    });
    expect(cfg!.condition).toBeUndefined();
    expect(cfg!.launchAlignment).toEqual({ type: "atEvent" });
    expect(cfg!.lifetime).toEqual({ type: "onePass" });
    expect(cfg!.reTrigger).toBe("restart");
    expect(cfg!.length).toEqual({ type: "scoreCycle" });
    expect(cfg!.maxRepeats).toBe(DEFAULT_TRIGGER_MAX_REPEATS);
  });

  it("clamps hostile numeric values into bounds", () => {
    const cfg = normalizeTriggerConfig({
      sourceTrackId: "lead",
      condition: { type: "gatiIs", beat: -5, gati: 9999 },
      launchAlignment: { type: "afterEventTicks", ticks: -10 },
      lifetime: { type: "repeats", passes: 0 },
      length: { type: "fixedBeats", beats: 0 },
      maxRepeats: 1_000_000,
    });
    // Legacy `condition` is upcast into `when` (gati clamped 9999→32, beat -5→0).
    expect(cfg!.when).toEqual({
      beats: { type: "at", beat: 0 },
      tree: { type: "leaf", predicate: { type: "gatiIs", gati: 32 } },
    });
    expect(cfg!.condition).toBeUndefined();
    expect(cfg!.launchAlignment).toEqual({ type: "afterEventTicks", ticks: 0 });
    expect(cfg!.lifetime).toEqual({ type: "repeats", passes: 1 });
    expect(cfg!.length).toEqual({ type: "fixedBeats", beats: 1 });
    expect(cfg!.maxRepeats).toBe(TRIGGER_MAX_REPEATS_CAP);
  });

  it("is idempotent", () => {
    const once = normalizeTriggerConfig(validTrigger());
    const twice = normalizeTriggerConfig(once);
    expect(twice).toEqual(once);
  });

  it("zero maxRepeats falls back to the default, not zero", () => {
    const cfg = normalizeTriggerConfig({ sourceTrackId: "lead", maxRepeats: 0 });
    expect(cfg!.maxRepeats).toBe(DEFAULT_TRIGGER_MAX_REPEATS);
  });
});

describe("launch quantize normalization", () => {
  it("returns null for non-records", () => {
    expect(normalizeLaunchQuantize(null)).toBeNull();
    expect(normalizeLaunchQuantize("beat")).toBeNull();
    expect(normalizeLaunchQuantize(undefined)).toBeNull();
  });

  it("coerces a partial quantize to safe defaults", () => {
    const q = normalizeLaunchQuantize({});
    expect(q).not.toBeNull();
    expect(q!.grid).toEqual({ type: "referenceBeatFraction", divisions: 1 });
    expect(q!.direction).toBe("next");
  });

  it("clamps grid divisions/beats and falls back direction", () => {
    expect(
      normalizeTriggerQuantizeGrid({ type: "referenceBeatFraction", divisions: 9999 })
    ).toEqual({ type: "referenceBeatFraction", divisions: 64 });
    expect(normalizeTriggerQuantizeGrid({ type: "referenceBeatMultiple", beats: 0 })).toEqual({
      type: "referenceBeatMultiple",
      beats: 1,
    });
    expect(normalizeTriggerQuantizeGrid({ type: "sourceGatiMatra" })).toEqual({
      type: "sourceGatiMatra",
    });
    expect(normalizeTriggerQuantizeGrid({ type: "bogus" })).toEqual({
      type: "referenceBeatFraction",
      divisions: 1,
    });
    expect(normalizeTriggerQuantizeDirection("explode")).toBe("next");
    expect(normalizeTriggerQuantizeDirection("previous")).toBe("previous");
  });

  it("round-trips through normalizeTriggerConfig and is idempotent", () => {
    const cfg = normalizeTriggerConfig({
      sourceTrackId: "lead",
      launchQuantize: {
        grid: { type: "referenceBeatFraction", divisions: 4 },
        direction: "nearest",
      },
    });
    expect(cfg!.launchQuantize).toEqual({
      grid: { type: "referenceBeatFraction", divisions: 4 },
      direction: "nearest",
    });
    expect(normalizeTriggerConfig(cfg)!.launchQuantize).toEqual(cfg!.launchQuantize);
  });

  it("absent quantize normalizes to null (continuous launch tick)", () => {
    const cfg = normalizeTriggerConfig({ sourceTrackId: "lead" });
    expect(cfg!.launchQuantize).toBeNull();
  });
});

describe("trigger sub-normalizers", () => {
  it("condition falls back to beatIsRest on unknown type", () => {
    expect(normalizeTriggerCondition({ type: "ratchetFiredAtBeat", beat: 2 })).toEqual({
      type: "beatIsRest",
      beat: 2,
    });
    expect(normalizeTriggerCondition(undefined)).toEqual({ type: "beatIsRest", beat: 0 });
  });

  it("launch alignment falls back to atEvent on unknown type", () => {
    expect(normalizeTriggerLaunchAlignment({ type: "bogus" })).toEqual({ type: "atEvent" });
    expect(normalizeTriggerLaunchAlignment({ type: "atSourceCycleStart" })).toEqual({
      type: "atSourceCycleStart",
    });
  });

  it("lifetime/reTrigger/length fall back safely", () => {
    expect(normalizeTriggerLifetime({ type: "untilStopCondition" })).toEqual({ type: "onePass" });
    expect(normalizeTriggerReTrigger("explode")).toBe("restart");
    expect(normalizeTriggerReTrigger("queue")).toBe("queue");
    expect(normalizeTriggerLength({ type: "conditionalLength" })).toEqual({ type: "scoreCycle" });
  });
});

describe("WHEN-tree normalization (Phase B, mirrors cseq_trigger)", () => {
  it("countOp maps known ops and falls back to atLeast", () => {
    expect(normalizeTriggerCountOp("moreThan")).toBe("moreThan");
    expect(normalizeTriggerCountOp("lessThan")).toBe("lessThan");
    expect(normalizeTriggerCountOp("nonsense")).toBe("atLeast");
    expect(normalizeTriggerCountOp(undefined)).toBe("atLeast");
  });

  it("predicate clamps numeric fields and defaults unknowns to isRest", () => {
    expect(normalizeTriggerWhenPredicate({ type: "gatiIs", gati: 9999 })).toEqual({
      type: "gatiIs",
      gati: 32,
    });
    expect(normalizeTriggerWhenPredicate({ type: "matraIsSounding", matra: 500 })).toEqual({
      type: "matraIsSounding",
      matra: 63,
    });
    expect(
      normalizeTriggerWhenPredicate({ type: "restCountInCycle", op: "x", count: 99999 })
    ).toEqual({ type: "restCountInCycle", op: "atLeast", count: 256 });
    expect(normalizeTriggerWhenPredicate({ type: "ratchetFiredAtBeat" })).toEqual({ type: "isRest" });
    expect(normalizeTriggerWhenPredicate(undefined)).toEqual({ type: "isRest" });
  });

  it("beat selector accepts at/anyBeat and clamps the beat", () => {
    expect(normalizeTriggerBeatSelector({ type: "anyBeat" })).toEqual({ type: "anyBeat" });
    expect(normalizeTriggerBeatSelector({ type: "at", beat: 999 })).toEqual({
      type: "at",
      beat: 63,
    });
    expect(normalizeTriggerBeatSelector(undefined)).toEqual({ type: "at", beat: 0 });
  });

  it("condition node coerces all/any/not/leaf and defaults garbage to an isRest leaf", () => {
    expect(
      normalizeTriggerConditionNode({
        type: "not",
        node: { type: "leaf", predicate: { type: "isSounding" } },
      })
    ).toEqual({ type: "not", node: { type: "leaf", predicate: { type: "isSounding" } } });
    expect(normalizeTriggerConditionNode({ type: "bogus" })).toEqual({
      type: "leaf",
      predicate: { type: "isRest" },
    });
    expect(normalizeTriggerConditionNode(42)).toEqual({
      type: "leaf",
      predicate: { type: "isRest" },
    });
    // Non-array / empty children collapse to the safe default leaf rather than
    // becoming hidden always/never folds.
    expect(normalizeTriggerConditionNode({ type: "all", nodes: "nope" })).toEqual({
      type: "leaf",
      predicate: { type: "isRest" },
    });
    expect(normalizeTriggerConditionNode({ type: "any", nodes: [] })).toEqual({
      type: "leaf",
      predicate: { type: "isRest" },
    });
  });

  it("whenSpec collapses an over-large tree to a single isRest leaf (node cap)", () => {
    const huge = {
      beats: { type: "at", beat: 1 },
      tree: {
        type: "any",
        nodes: Array.from({ length: MAX_CONDITION_NODES + 5 }, () => ({
          type: "leaf",
          predicate: { type: "isSounding" },
        })),
      },
    };
    expect(normalizeWhenSpec(huge)).toEqual({
      beats: { type: "at", beat: 1 },
      tree: { type: "leaf", predicate: { type: "isRest" } },
    });
  });

  it("effectiveTriggerWhen prefers when, then upcasts legacy condition, then defaults", () => {
    // `when` wins outright.
    expect(
      effectiveTriggerWhen({
        when: { beats: { type: "anyBeat" }, tree: { type: "leaf", predicate: { type: "isSounding" } } },
        condition: { type: "beatIsRest", beat: 3 },
      })
    ).toEqual({
      beats: { type: "anyBeat" },
      tree: { type: "leaf", predicate: { type: "isSounding" } },
    });
    // No `when` ⇒ upcast the legacy condition (beat carried into the selector).
    expect(effectiveTriggerWhen({ condition: { type: "sectionStartAtBeat", beat: 2 } })).toEqual({
      beats: { type: "at", beat: 2 },
      tree: { type: "leaf", predicate: { type: "isSectionStart" } },
    });
    // Neither ⇒ the default spec.
    expect(effectiveTriggerWhen({})).toEqual({
      beats: { type: "at", beat: 0 },
      tree: { type: "leaf", predicate: { type: "isRest" } },
    });
  });

  it("a multi-condition WHEN survives normalizeTriggerConfig intact", () => {
    const cfg = normalizeTriggerConfig({
      sourceTrackId: "lead",
      when: {
        beats: { type: "anyBeat" },
        tree: {
          type: "all",
          nodes: [
            { type: "leaf", predicate: { type: "isRest" } },
            {
              type: "not",
              node: { type: "leaf", predicate: { type: "gatiIs", gati: 5 } },
            },
            { type: "leaf", predicate: { type: "soundingCountInCycle", op: "atLeast", count: 2 } },
          ],
        },
      },
    });
    expect(cfg!.when).toEqual({
      beats: { type: "anyBeat" },
      tree: {
        type: "all",
        nodes: [
          { type: "leaf", predicate: { type: "isRest" } },
          { type: "not", node: { type: "leaf", predicate: { type: "gatiIs", gati: 5 } } },
          { type: "leaf", predicate: { type: "soundingCountInCycle", op: "atLeast", count: 2 } },
        ],
      },
    });
    expect(cfg!.condition).toBeUndefined();
  });
});

describe("GATE normalization (Phase C, mirrors cseq_trigger::GateSpec)", () => {
  it("returns null for a non-record (no gate ⇒ always accept)", () => {
    expect(normalizeGateSpec(undefined)).toBeNull();
    expect(normalizeGateSpec(null)).toBeNull();
    expect(normalizeGateSpec(42)).toBeNull();
  });

  it("clamps probability, cooldown, and miss-boost into bounds", () => {
    expect(
      normalizeGateSpec({
        probabilityPerMille: 9999,
        cooldownCycles: 10_000_000,
        missBoostPerMille: -5,
        seed: 7,
      })
    ).toEqual({
      probabilityPerMille: GATE_PROBABILITY_MAX,
      cooldownCycles: GATE_COOLDOWN_CYCLES_CAP,
      missBoostPerMille: 0,
      seed: 7,
    });
  });

  it("defaults a partial gate to always-accept", () => {
    expect(normalizeGateSpec({})).toEqual({
      probabilityPerMille: GATE_PROBABILITY_MAX,
      cooldownCycles: 0,
      missBoostPerMille: 0,
      seed: 0,
    });
  });

  it("normalizeTriggerConfig carries a clamped gate, or null when absent", () => {
    const gated = normalizeTriggerConfig({
      sourceTrackId: "lead",
      gate: { probabilityPerMille: 600, cooldownCycles: 2, missBoostPerMille: 5000, seed: 3 },
    });
    expect(gated!.gate).toEqual({
      probabilityPerMille: 600,
      cooldownCycles: 2,
      missBoostPerMille: GATE_PROBABILITY_MAX,
      seed: 3,
    });
    const ungated = normalizeTriggerConfig({ sourceTrackId: "lead" });
    expect(ungated!.gate).toBeNull();
  });
});

describe("weighted START normalization (Phase D, mirrors cseq_trigger::StartSelect)", () => {
  it("launch alignment accepts the Phase-D placements", () => {
    expect(normalizeTriggerLaunchAlignment({ type: "centerInRest" })).toEqual({
      type: "centerInRest",
    });
    expect(normalizeTriggerLaunchAlignment({ type: "atSourceReturn" })).toEqual({
      type: "atSourceReturn",
    });
  });

  it("returns null for a non-record or an empty option list", () => {
    expect(normalizeStartSelect(undefined)).toBeNull();
    expect(normalizeStartSelect(42)).toBeNull();
    expect(normalizeStartSelect({ options: [] })).toBeNull();
    expect(normalizeStartSelect({ options: "nope" })).toBeNull();
  });

  it("coerces options, clamping each alignment + weight, and caps the count", () => {
    const select = normalizeStartSelect({
      options: [
        { alignment: { type: "centerInRest" }, weight: 3 },
        { alignment: { type: "bogus" }, weight: -5 },
        { alignment: { type: "atSourceReturn" }, weight: MAX_START_WEIGHT + 1 },
      ],
      seed: 9,
    });
    expect(select).toEqual({
      options: [
        { alignment: { type: "centerInRest" }, weight: 3 },
        { alignment: { type: "atEvent" }, weight: 0 },
        { alignment: { type: "atSourceReturn" }, weight: MAX_START_WEIGHT },
      ],
      seed: 9,
    });
    // Over-long lists are capped at MAX_START_OPTIONS.
    const huge = normalizeStartSelect({
      options: Array.from({ length: MAX_START_OPTIONS + 5 }, () => ({
        alignment: { type: "atEvent" },
        weight: 1,
      })),
    });
    expect(huge!.options).toHaveLength(MAX_START_OPTIONS);
  });

  it("normalizeTriggerConfig carries a clamped startSelect, or null when absent", () => {
    const cfg = normalizeTriggerConfig({
      sourceTrackId: "lead",
      startSelect: {
        options: [{ alignment: { type: "atSourceReturn" }, weight: 2 }],
        seed: 4,
      },
    });
    expect(cfg!.startSelect).toEqual({
      options: [{ alignment: { type: "atSourceReturn" }, weight: 2 }],
      seed: 4,
    });
    expect(normalizeTriggerConfig({ sourceTrackId: "lead" })!.startSelect).toBeNull();
  });
});

describe("deferred-but-visible values normalize away (Phase F, nothing lies)", () => {
  // The deferred controls are disabled in the UI, but a hand-edited config could
  // carry them. Normalization must coerce each to a safe, real engine value so
  // the engine never receives an unsupported capability.
  it("a deferred lifetime / length coerces to a real default", () => {
    expect(normalizeTriggerLifetime({ type: "untilStop" })).toEqual({ type: "onePass" });
    expect(normalizeTriggerLength({ type: "untilReturn" })).toEqual({ type: "scoreCycle" });
  });

  it("a deferred START placement coerces to atEvent", () => {
    expect(normalizeTriggerLaunchAlignment({ type: "rotateToAccent" })).toEqual({ type: "atEvent" });
    expect(normalizeTriggerLaunchAlignment({ type: "rotateToCadence" })).toEqual({
      type: "atEvent",
    });
  });

  it("a deferred WHEN subject coerces to isRest", () => {
    expect(normalizeTriggerWhenPredicate({ type: "ratchetFired" })).toEqual({ type: "isRest" });
    expect(normalizeTriggerWhenPredicate({ type: "sourceRunning" })).toEqual({ type: "isRest" });
  });

  it("a whole config carrying deferred values is fully coerced", () => {
    const cfg = normalizeTriggerConfig({
      sourceTrackId: "lead",
      launchAlignment: { type: "rotateToAccent" },
      lifetime: { type: "untilStop" },
      length: { type: "untilReturn" },
    });
    expect(cfg!.launchAlignment).toEqual({ type: "atEvent" });
    expect(cfg!.lifetime).toEqual({ type: "onePass" });
    expect(cfg!.length).toEqual({ type: "scoreCycle" });
  });
});

describe("enforceTriggerGraph (graph validation)", () => {
  const track = (id: string, trigger: TriggerConfig | null): ParallelTrackPatch =>
    ({ ...makeMinimalTrack(id, id), id, trigger });

  it("keeps a valid one-level trigger", () => {
    const tracks = [track("lead", null), track("follow", validTrigger("lead"))];
    const out = enforceTriggerGraph(tracks);
    expect(out[1]!.trigger).not.toBeNull();
    expect(out[1]!.trigger!.sourceTrackId).toBe("lead");
  });

  it("drops a self-trigger", () => {
    const out = enforceTriggerGraph([track("a", validTrigger("a"))]);
    expect(out[0]!.trigger).toBeNull();
  });

  it("drops a dangling source", () => {
    const out = enforceTriggerGraph([track("a", validTrigger("ghost"))]);
    expect(out[0]!.trigger).toBeNull();
  });

  it("drops an edge whose source is itself triggered (one level only)", () => {
    const tracks = [
      track("c", null),
      track("b", validTrigger("c")),
      track("a", validTrigger("b")),
    ];
    const out = enforceTriggerGraph(tracks);
    const byId = new Map(out.map((t) => [t.id, t]));
    expect(byId.get("b")!.trigger).not.toBeNull(); // b -> c (c continuous) ok
    expect(byId.get("a")!.trigger).toBeNull(); // a -> b (b triggered) dropped
  });

  it("keeps a follower whose source was demoted by an impossible trigger", () => {
    const tracks = [
      track("follow", validTrigger("source")),
      track("source", validTrigger("ghost")),
    ];
    const out = enforceTriggerGraph(tracks);
    const byId = new Map(out.map((t) => [t.id, t]));
    expect(byId.get("follow")!.trigger).not.toBeNull();
    expect(byId.get("source")!.trigger).toBeNull();
  });

  it("breaks a mutual cycle by demoting both", () => {
    const out = enforceTriggerGraph([
      track("a", validTrigger("b")),
      track("b", validTrigger("a")),
    ]);
    expect(out[0]!.trigger).toBeNull();
    expect(out[1]!.trigger).toBeNull();
  });
});

describe("parallelSilentSourceIds (muted source still drives followers)", () => {
  type MiniTrack = Pick<ParallelTrackPatch, "id" | "muted" | "soloed" | "trigger">;
  const t = (
    id: string,
    muted: boolean,
    soloed: boolean,
    trigger: TriggerConfig | null
  ): MiniTrack => ({ id, muted, soloed, trigger });

  it("includes a muted source that an audible follower depends on", () => {
    const ids = parallelSilentSourceIds([
      t("lead", true, false, null), // muted source
      t("follow", false, false, validTrigger("lead")), // audible follower
    ]);
    expect([...ids]).toEqual(["lead"]);
  });

  it("does not include an audible source", () => {
    const ids = parallelSilentSourceIds([
      t("lead", false, false, null),
      t("follow", false, false, validTrigger("lead")),
    ]);
    expect(ids.size).toBe(0);
  });

  it("does not include a source hidden behind solo unless needed by an audible follower", () => {
    // follow is soloed (audible), lead is not soloed (hidden) but needed.
    const ids = parallelSilentSourceIds([
      t("lead", false, false, null),
      t("follow", false, true, validTrigger("lead")),
    ]);
    expect([...ids]).toEqual(["lead"]);
  });

  it("ignores a dangling source", () => {
    const ids = parallelSilentSourceIds([
      t("follow", false, false, validTrigger("ghost")),
    ]);
    expect(ids.size).toBe(0);
  });

  it("does not resurrect a valid triggered source as a continuous silent source", () => {
    const ids = parallelSilentSourceIds([
      t("clock", true, false, validTrigger("lead")),
      t("lead", false, false, null),
      t("follow", false, false, validTrigger("clock")),
    ]);
    expect(ids.size).toBe(0);
  });

  it("can still use a source whose own impossible trigger will be demoted", () => {
    const ids = parallelSilentSourceIds([
      t("clock", true, false, validTrigger("ghost")),
      t("follow", false, false, validTrigger("clock")),
    ]);
    expect([...ids]).toEqual(["clock"]);
  });

  it("does not resurrect a source for a muted follower", () => {
    const ids = parallelSilentSourceIds([
      t("lead", true, false, null),
      t("follow", true, false, validTrigger("lead")), // follower also muted
    ]);
    expect(ids.size).toBe(0);
  });
});

describe("patch round-trip", () => {
  it("a valid triggered track survives readPatchDocument", () => {
    const doc = makeMinimalProject(2);
    doc.project.tracks[1]!.trigger = validTrigger(doc.project.tracks[0]!.id);
    const round = readPatchDocument(JSON.parse(JSON.stringify(doc)));
    expect(round.project).not.toBeNull();
    const follower = round.project!.tracks[1]!;
    expect(follower.trigger).not.toBeNull();
    expect(follower.trigger!.sourceTrackId).toBe(round.project!.tracks[0]!.id);
    expect(follower.trigger!.condition).toBeUndefined();
    expect(follower.trigger!.when).toEqual({
      beats: { type: "at", beat: 3 },
      tree: { type: "leaf", predicate: { type: "isRest" } },
    });
  });

  it("a dangling triggered track is demoted to continuous on read", () => {
    const doc = makeMinimalProject(2);
    doc.project.tracks[1]!.trigger = validTrigger("does-not-exist");
    const round = readPatchDocument(JSON.parse(JSON.stringify(doc)));
    expect(round.project!.tracks[1]!.trigger).toBeNull();
  });
});

describe("track import resilience", () => {
  it("nulls a dangling sourceTrackId on import (falls back to continuous)", () => {
    // A track exported with a trigger whose source is not in the destination.
    const exported: ParallelTrackPatch = {
      ...makeMinimalTrack("orphan", "Orphan"),
      trigger: validTrigger("some-other-project-track"),
    };
    const envelope = buildTrackEnvelope(exported, { tempoBpm: 80, cycleBeats: 8 });
    const { track: imported } = readTrackEnvelope(JSON.parse(JSON.stringify(envelope)));
    // Single-track normalization keeps the (well-formed) trigger...
    expect(imported.trigger).not.toBeNull();

    const project = makeMinimalProject(1).project;
    const spliced = spliceImportedTrack(project, imported, {
      keepTrackLocalTiming: false,
      importedGlobalContext: { tempoBpm: 80, cycleBeats: 8 },
      destinationGlobal: { tempoBpm: 80, cycleBeats: 8 },
    });
    // ...but the splice drops the dangling edge to continuous.
    const added = spliced.tracks[spliced.tracks.length - 1]!;
    expect(added.trigger).toBeNull();
  });
});
