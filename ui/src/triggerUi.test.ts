/**
 * Tests for the trigger inspector pure helpers: select↔config mappings, the
 * Phase-B WHEN-tree editor model, and preset builders. All presets must produce
 * engine-expressible configs.
 */
import { describe, expect, it } from "vitest";

import {
  buildTriggerPreset,
  defaultGateSpec,
  defaultStartSelect,
  defaultTriggerConfig,
  describeConditionNode,
  describeDecisionLine,
  describeGate,
  describeRun,
  describeStart,
  describeTrigger,
  describeWhen,
  editorToWhenSpec,
  perMilleToPercent,
  percentToPerMille,
  TRIGGER_PRESETS,
  TRIGGER_START_ALIGNMENTS,
  TRIGGER_START_ALIGNMENTS_DEFERRED,
  TRIGGER_WHEN_SUBJECTS,
  TRIGGER_WHEN_SUBJECTS_DEFERRED,
  triggerConditionOfType,
  triggerLaunchAlignmentOfType,
  triggerQuantizeOfSelect,
  triggerQuantizeSelectValue,
  triggerWhenPredicateOfType,
  whenSpecToEditor,
  whenSubjectValueKind,
} from "./triggerUi";
import type { TriggerDecisionEvent, TriggerWhenSpec } from "./bridge";

describe("select↔config mappings", () => {
  it("conditionOfType preserves beat and defaults to beatIsRest", () => {
    expect(triggerConditionOfType("gatiIs", 3)).toEqual({ type: "gatiIs", beat: 3, gati: 4 });
    expect(triggerConditionOfType("beatIsSounding", 2)).toEqual({
      type: "beatIsSounding",
      beat: 2,
    });
    expect(triggerConditionOfType("nonsense", 5)).toEqual({ type: "beatIsRest", beat: 5 });
  });

  it("launchAlignmentOfType maps known types and defaults to atEvent", () => {
    expect(triggerLaunchAlignmentOfType("atSourceCycleStart")).toEqual({
      type: "atSourceCycleStart",
    });
    expect(triggerLaunchAlignmentOfType("afterEventTicks")).toEqual({
      type: "afterEventTicks",
      ticks: 0,
    });
    expect(triggerLaunchAlignmentOfType("???")).toEqual({ type: "atEvent" });
  });

  it("quantize select value round-trips", () => {
    expect(triggerQuantizeSelectValue(null)).toBe("off");
    expect(
      triggerQuantizeSelectValue({
        grid: { type: "referenceBeatFraction", divisions: 4 },
        direction: "next",
      })
    ).toBe("fraction");
    expect(
      triggerQuantizeSelectValue({ grid: { type: "sourceGatiMatra" }, direction: "next" })
    ).toBe("gati");
  });

  it("quantizeOfSelect builds grids and preserves direction; off => null", () => {
    expect(triggerQuantizeOfSelect("off", "nearest")).toBeNull();
    expect(triggerQuantizeOfSelect("fraction", "previous")).toEqual({
      grid: { type: "referenceBeatFraction", divisions: 4 },
      direction: "previous",
    });
    expect(triggerQuantizeOfSelect("gati", "next")).toEqual({
      grid: { type: "sourceGatiMatra" },
      direction: "next",
    });
  });
});

describe("presets", () => {
  it("defaultTriggerConfig is the Fill-a-rest config", () => {
    const cfg = defaultTriggerConfig("lead");
    expect(cfg).toEqual({
      sourceTrackId: "lead",
      when: { beats: { type: "at", beat: 3 }, tree: { type: "leaf", predicate: { type: "isRest" } } },
      launchAlignment: { type: "atEvent" },
      launchQuantize: null,
      lifetime: { type: "onePass" },
      reTrigger: "restart",
      length: { type: "scoreCycle" },
      maxRepeats: 64,
    });
  });

  it("available presets build distinct v1-expressible configs", () => {
    const available = TRIGGER_PRESETS.filter((p) => p.available).map((p) => p.id);
    expect(available).toEqual([
      "fillRest",
      "answerNextBeat",
      "phaseLockedShadow",
      "quantizedFill",
      "probabilisticFill",
    ]);

    expect(buildTriggerPreset("fillRest", "lead")).toEqual(defaultTriggerConfig("lead"));
    expect(buildTriggerPreset("answerNextBeat", "lead").launchAlignment).toEqual({
      type: "afterEventTicks",
      ticks: 960,
    });
    expect(buildTriggerPreset("answerNextBeat", "lead").when).toEqual({
      beats: { type: "at", beat: 0 },
      tree: { type: "leaf", predicate: { type: "isSounding" } },
    });
    expect(buildTriggerPreset("phaseLockedShadow", "lead").launchAlignment).toEqual({
      type: "atSourceCycleStart",
    });
    expect(buildTriggerPreset("quantizedFill", "lead").launchQuantize).toEqual({
      grid: { type: "referenceBeatFraction", divisions: 2 },
      direction: "next",
    });
    // Probabilistic fill carries a real engine gate (probability + miss-boost).
    expect(buildTriggerPreset("probabilisticFill", "lead").gate).toEqual({
      probabilityPerMille: 600,
      cooldownCycles: 0,
      missBoostPerMille: 200,
      seed: 0,
    });
  });

  it("disabled presets carry a hint and are not fabricated", () => {
    const disabled = TRIGGER_PRESETS.filter((p) => !p.available);
    expect(disabled.map((p) => p.id)).toEqual(["answerNextCycle", "cadenceIntoReturn"]);
    for (const preset of disabled) {
      expect(preset.hint).toBeTruthy();
    }
  });

  it("an unknown preset id falls back to the default config", () => {
    expect(buildTriggerPreset("does-not-exist", "lead")).toEqual(defaultTriggerConfig("lead"));
  });

  it("presets keep the given source track id", () => {
    for (const preset of TRIGGER_PRESETS) {
      expect(buildTriggerPreset(preset.id, "clock").sourceTrackId).toBe("clock");
    }
  });
});

describe("WHEN-tree editor (Phase B)", () => {
  it("every subject maps to a real engine predicate type", () => {
    // Nothing-lies: the subject catalog only advertises predicates the engine
    // implements (the WhenPredicate variants).
    expect(TRIGGER_WHEN_SUBJECTS.map((s) => s.type)).toEqual([
      "isRest",
      "isSounding",
      "isSectionStart",
      "hasJathiPulse",
      "gatiIs",
      "matraIsRest",
      "matraIsSounding",
      "restCountInCycle",
      "soundingCountInCycle",
    ]);
  });

  it("whenSubjectValueKind classifies the extra value control", () => {
    expect(whenSubjectValueKind("isRest")).toBe("none");
    expect(whenSubjectValueKind("gatiIs")).toBe("gati");
    expect(whenSubjectValueKind("matraIsSounding")).toBe("matra");
    expect(whenSubjectValueKind("restCountInCycle")).toBe("count");
    expect(whenSubjectValueKind("???")).toBe("none");
  });

  it("triggerWhenPredicateOfType builds predicates and carries compatible fields", () => {
    expect(triggerWhenPredicateOfType("isSounding")).toEqual({ type: "isSounding" });
    expect(triggerWhenPredicateOfType("gatiIs")).toEqual({ type: "gatiIs", gati: 4 });
    // Carry a typed gati when switching gati→gati is a no-op, but a matra value
    // survives a matraIsRest→matraIsSounding switch.
    expect(
      triggerWhenPredicateOfType("matraIsSounding", { type: "matraIsRest", matra: 2 })
    ).toEqual({ type: "matraIsSounding", matra: 2 });
    expect(
      triggerWhenPredicateOfType("soundingCountInCycle", {
        type: "restCountInCycle",
        op: "atMost",
        count: 3,
      })
    ).toEqual({ type: "soundingCountInCycle", op: "atMost", count: 3 });
    // Unknown subject falls back to isRest.
    expect(triggerWhenPredicateOfType("???")).toEqual({ type: "isRest" });
  });

  it("decodes a bare leaf as a one-row ALL model", () => {
    const when: TriggerWhenSpec = {
      beats: { type: "at", beat: 2 },
      tree: { type: "leaf", predicate: { type: "isSounding" } },
    };
    expect(whenSpecToEditor(when)).toEqual({
      kind: "flat",
      combinator: "all",
      beats: { type: "at", beat: 2 },
      rows: [{ negated: false, predicate: { type: "isSounding" } }],
    });
  });

  it("decodes an ALL/ANY of (maybe-NOT) leaves into flat rows", () => {
    const when: TriggerWhenSpec = {
      beats: { type: "anyBeat" },
      tree: {
        type: "any",
        nodes: [
          { type: "leaf", predicate: { type: "isRest" } },
          { type: "not", node: { type: "leaf", predicate: { type: "isSectionStart" } } },
        ],
      },
    };
    expect(whenSpecToEditor(when)).toEqual({
      kind: "flat",
      combinator: "any",
      beats: { type: "anyBeat" },
      rows: [
        { negated: false, predicate: { type: "isRest" } },
        { negated: true, predicate: { type: "isSectionStart" } },
      ],
    });
  });

  it("flags a nested tree as custom (engine-valid, not flat-editable)", () => {
    const when: TriggerWhenSpec = {
      beats: { type: "at", beat: 0 },
      tree: {
        type: "all",
        nodes: [
          { type: "leaf", predicate: { type: "isRest" } },
          { type: "any", nodes: [{ type: "leaf", predicate: { type: "isSounding" } }] },
        ],
      },
    };
    const model = whenSpecToEditor(when);
    expect(model.kind).toBe("custom");
  });

  it("editorToWhenSpec wraps rows in the chosen combinator with per-row NOT", () => {
    const spec = editorToWhenSpec({
      kind: "flat",
      combinator: "all",
      beats: { type: "at", beat: 1 },
      rows: [
        { negated: false, predicate: { type: "isRest" } },
        { negated: true, predicate: { type: "gatiIs", gati: 3 } },
      ],
    });
    expect(spec).toEqual({
      beats: { type: "at", beat: 1 },
      tree: {
        type: "all",
        nodes: [
          { type: "leaf", predicate: { type: "isRest" } },
          { type: "not", node: { type: "leaf", predicate: { type: "gatiIs", gati: 3 } } },
        ],
      },
    });
  });

  it("round-trips a flat model through spec and back", () => {
    const model = {
      kind: "flat" as const,
      combinator: "any" as const,
      beats: { type: "anyBeat" as const },
      rows: [
        { negated: false, predicate: { type: "isSounding" as const } },
        {
          negated: true,
          predicate: { type: "soundingCountInCycle" as const, op: "moreThan" as const, count: 2 },
        },
      ],
    };
    expect(whenSpecToEditor(editorToWhenSpec(model))).toEqual(model);
  });
});

describe("GATE helpers (Phase C)", () => {
  it("per-mille ⇄ percent round-trips and clamps", () => {
    expect(perMilleToPercent(620)).toBe(62);
    expect(percentToPerMille(62)).toBe(620);
    expect(percentToPerMille(0)).toBe(0);
    expect(percentToPerMille(100)).toBe(1000);
    // Out-of-range percent is clamped before scaling.
    expect(percentToPerMille(150)).toBe(1000);
    expect(percentToPerMille(-10)).toBe(0);
  });

  it("defaultGateSpec is a neutral, always-accept gate", () => {
    expect(defaultGateSpec()).toEqual({
      probabilityPerMille: 1000,
      cooldownCycles: 0,
      missBoostPerMille: 0,
      seed: 0,
    });
  });
});

describe("START helpers (Phase D)", () => {
  it("alignment options cover every engine LaunchAlignment kind", () => {
    expect(TRIGGER_START_ALIGNMENTS.map((a) => a.type)).toEqual([
      "atEvent",
      "atSourceCycleStart",
      "atNextReferenceBeat",
      "afterEventTicks",
      "centerInRest",
      "atSourceReturn",
    ]);
  });

  it("launchAlignmentOfType builds the Phase-D placements", () => {
    expect(triggerLaunchAlignmentOfType("centerInRest")).toEqual({ type: "centerInRest" });
    expect(triggerLaunchAlignmentOfType("atSourceReturn")).toEqual({ type: "atSourceReturn" });
    // Unknown still falls back to atEvent.
    expect(triggerLaunchAlignmentOfType("???")).toEqual({ type: "atEvent" });
  });

  it("defaultStartSelect seeds a one-option weighted select from the alignment", () => {
    expect(defaultStartSelect({ type: "centerInRest" })).toEqual({
      options: [{ alignment: { type: "centerInRest" }, weight: 1 }],
      seed: 0,
    });
  });
});

describe("deferred-but-visible roadmap options (Phase F)", () => {
  it("deferred catalogs are non-empty and every entry carries a hint", () => {
    expect(TRIGGER_WHEN_SUBJECTS_DEFERRED.length).toBeGreaterThan(0);
    expect(TRIGGER_START_ALIGNMENTS_DEFERRED.length).toBeGreaterThan(0);
    for (const entry of [...TRIGGER_WHEN_SUBJECTS_DEFERRED, ...TRIGGER_START_ALIGNMENTS_DEFERRED]) {
      expect(entry.hint.length).toBeGreaterThan(0);
      expect(entry.label).toMatch(/later/i);
    }
  });

  it("no deferred type collides with a real engine option (nothing lies)", () => {
    const realSubjects = new Set(TRIGGER_WHEN_SUBJECTS.map((s) => s.type));
    for (const d of TRIGGER_WHEN_SUBJECTS_DEFERRED) {
      expect(realSubjects.has(d.type as never)).toBe(false);
    }
    const realAligns = new Set(TRIGGER_START_ALIGNMENTS.map((a) => a.type));
    for (const d of TRIGGER_START_ALIGNMENTS_DEFERRED) {
      expect(realAligns.has(d.type)).toBe(false);
    }
  });

  it("a deferred subject/alignment coerces to a safe real value if ever selected", () => {
    // Disabled in the UI, but if a deferred type leaked through, the builders
    // must fall back to a real engine variant — never fabricate one.
    expect(triggerWhenPredicateOfType("ratchetFired")).toEqual({ type: "isRest" });
    expect(triggerLaunchAlignmentOfType("rotateToAccent")).toEqual({ type: "atEvent" });
  });
});

describe("plain-language descriptions (design rebuild)", () => {
  function decision(o: Partial<TriggerDecisionEvent> = {}): TriggerDecisionEvent {
    return {
      trackIndex: 1,
      trackId: "follow",
      trackName: "Follow",
      sourceCycleIndex: 4,
      matchedBeat: 3,
      eventTick: 2880,
      candidateTick: 2880,
      startKind: "atEvent",
      outcome: "launched",
      suppressReason: null,
      launchTick: 2880,
      runIndex: 0,
      rollValue: null,
      rollThreshold: null,
      rollPassed: null,
      consecutiveMisses: 0,
      lastAcceptSourceCycle: 4,
      ...o,
    };
  }

  it("describes the default fill-a-rest config as one readable sentence", () => {
    expect(describeTrigger(defaultTriggerConfig("lead"), "Lead")).toBe(
      "When Lead rests on beat index 3, launch one cycle from the trigger event. Retrigger: restart."
    );
  });

  it("folds the GATE into the summary (probabilistic fill)", () => {
    const summary = describeTrigger(buildTriggerPreset("probabilisticFill", "lead"), "Lead");
    expect(summary).toContain("60% probability");
    expect(summary).toContain("+20% per miss");
  });

  it("describes condition trees (leaf / not / all / any / count)", () => {
    expect(describeConditionNode({ type: "leaf", predicate: { type: "isSounding" } })).toBe("plays");
    expect(
      describeConditionNode({ type: "not", node: { type: "leaf", predicate: { type: "isRest" } } })
    ).toBe("not (rests)");
    expect(
      describeConditionNode({
        type: "all",
        nodes: [
          { type: "leaf", predicate: { type: "isRest" } },
          { type: "leaf", predicate: { type: "isSectionStart" } },
        ],
      })
    ).toBe("rests and starts a section");
    expect(
      describeConditionNode({
        type: "leaf",
        predicate: { type: "soundingCountInCycle", op: "atLeast", count: 2 },
      })
    ).toBe("has at least 2 sounding beats");
  });

  it("describes WHEN with the any-beat selector", () => {
    const when: TriggerWhenSpec = {
      beats: { type: "anyBeat" },
      tree: { type: "leaf", predicate: { type: "isRest" } },
    };
    expect(describeWhen(when, "Lead")).toBe("Lead rests on any beat");
  });

  it("describes GATE, START, and RUN clauses", () => {
    expect(describeGate(null)).toBe("");
    expect(describeGate({ probabilityPerMille: 1000, cooldownCycles: 0, missBoostPerMille: 0, seed: 0 })).toBe(
      ""
    );
    expect(
      describeGate({ probabilityPerMille: 500, cooldownCycles: 2, missBoostPerMille: 0, seed: 0 })
    ).toBe("50% probability, minimum gap 2 source cycles");

    const base = defaultTriggerConfig("lead");
    expect(describeStart({ ...base, launchAlignment: { type: "centerInRest" } })).toBe(
      "the center of the matched beat"
    );
    expect(
      describeStart({
        ...base,
        launchQuantize: { grid: { type: "referenceBeatFraction", divisions: 2 }, direction: "next" },
      })
    ).toBe("the trigger event, snapped to grid");
    expect(
      describeStart({ ...base, startSelect: { options: [{ alignment: { type: "atEvent" }, weight: 1 }], seed: 0 } })
    ).toBe("a weighted start placement");

    expect(describeRun(base)).toBe("one cycle");
    expect(describeRun({ ...base, length: { type: "fixedBeats", beats: 3 }, lifetime: { type: "repeats", passes: 4 } })).toBe(
      "3 beats ×4"
    );
  });

  it("humanizes the decision log line", () => {
    expect(describeDecisionLine(decision({ outcome: "launched", startKind: "centerInRest" }))).toBe(
      "launched · start matched-beat center"
    );
    expect(
      describeDecisionLine(decision({ outcome: "suppressed", suppressReason: "gateProbability" }))
    ).toBe("suppressed (probability)");
    expect(
      describeDecisionLine(decision({ outcome: "suppressed", suppressReason: "gateCooldown" }))
    ).toBe("suppressed (minimum gap)");
    expect(
      describeDecisionLine(decision({ outcome: "suppressed", suppressReason: "reTriggerQueueFull" }))
    ).toBe("suppressed (queue full)");
    expect(describeDecisionLine(decision({ outcome: "queued" }))).toBe("queued · start trigger event");
  });
});
