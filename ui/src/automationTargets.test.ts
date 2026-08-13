import { describe, expect, it } from "vitest";

import { automationTargetBuildInput } from "./__fixtures__/automationTargetBuildInput";
import {
  automationGraphSampleValue,
  automationPointEffectiveTime,
  automationPointEffectiveUnit,
  automationSegmentCurveForPoint,
  automationTargetGroups,
  automationTimeFromUnit,
  automationTimeToUnit,
  buildAutomationTargetDefs,
  channelFallbackAutomationTarget,
  channelPositionActionAutomationTarget,
  channelPositionEnabledAutomationTarget,
  channelPositionNthAutomationTarget,
  channelPositionRenderAutomationTarget,
  channelPositionResetAutomationTarget,
  channelTransitionAutomationTarget,
  filterAvailableAutomationTargets,
  DUMKA_DRIFT_LEASH_AUTOMATION_TARGET,
  DUMKA_DENSITY_CEILING_AUTOMATION_TARGET,
  DUMKA_DENSITY_FLOOR_AUTOMATION_TARGET,
  DUMKA_COMPLEXITY_CEILING_AUTOMATION_TARGET,
  DUMKA_COMPLEXITY_FLOOR_AUTOMATION_TARGET,
  DUMKA_PLACEMENT_BIAS_AUTOMATION_TARGET,
  DUMKA_BARLOW_TEMPERATURE_AUTOMATION_TARGET,
  DUMKA_FILL_COMPLEXITY_AUTOMATION_TARGET,
  DUMKA_EVOLUTION_RATE_AUTOMATION_TARGET,
  GENERATOR_DENSITY_AUTOMATION_TARGET,
  makeAutomationCurve,
  sanitizeTargetIdPart,
  scopedAutomationPart,
  snapAutomationUnitToMarker,
  sortAutomationPointsByEffectiveTime,
  warpAutomationUnit,
  type AutomationMarkerData,
  type AutomationPointData,
  type AutomationTargetDef,
} from "./automationTargets";

function def(overrides: Partial<AutomationTargetDef> & { target: string }): AutomationTargetDef {
  return {
    label: overrides.target,
    group: "Misc",
    valueKind: "float",
    min: 0,
    max: 1,
    step: 0.01,
    sampleRate: "beat",
    fallback: 0,
    ...overrides,
  };
}

describe("sanitizeTargetIdPart / scopedAutomationPart", () => {
  it("slugifies, trims dashes, and falls back to 'target'", () => {
    expect(sanitizeTargetIdPart("Hello World!")).toBe("Hello-World");
    expect(sanitizeTargetIdPart("  a  b  ")).toBe("a-b");
    expect(sanitizeTargetIdPart("---")).toBe("target");
    expect(sanitizeTargetIdPart("")).toBe("target");
  });

  it("stringifies values before sanitizing", () => {
    expect(scopedAutomationPart(5)).toBe("5");
    expect(scopedAutomationPart("a b")).toBe("a-b");
  });
});

describe("automation target keys", () => {
  it("builds stable, scoped target strings", () => {
    expect(channelFallbackAutomationTarget(3)).toBe(
      "channelHocket.fallback.channel.3.weight"
    );
    expect(channelTransitionAutomationTarget("first", [1, 2], 3)).toBe(
      "channelHocket.matrix.first.1.2.to.3.weight"
    );
    expect(channelPositionActionAutomationTarget("rule one", "renderOnly")).toBe(
      "channelHocket.positionRule.rule-one.action.renderOnly.weight"
    );
  });
});

describe("buildAutomationTargetDefs (characterization)", () => {
  const defs = buildAutomationTargetDefs(automationTargetBuildInput);

  it("produces a stable, sorted, de-duplicated set of target defs", () => {
    // Locks the full enumeration: count + ordered ids + group set. Any change to
    // which targets are produced (or their sort order) trips this snapshot.
    expect({
      count: defs.length,
      groups: automationTargetGroups(defs),
      targets: defs.map((def) => def.target),
    }).toMatchSnapshot();
    // sorted by group, then label, then target — and no duplicate target ids
    expect(new Set(defs.map((d) => d.target)).size).toBe(defs.length);
    const sorted = [...defs].sort(
      (a, b) =>
        a.group.localeCompare(b.group) ||
        a.label.localeCompare(b.label) ||
        a.target.localeCompare(b.target)
    );
    expect(defs.map((d) => d.target)).toEqual(sorted.map((d) => d.target));
  });

  it("snapshots a representative built def in full", () => {
    expect(defs.find((d) => d.target === "transport.tempoBpm")).toMatchSnapshot();
  });

  it("exposes Example generator density as percent automation", () => {
    expect(
      defs.find((definition) =>
        definition.target === GENERATOR_DENSITY_AUTOMATION_TARGET
      )
    ).toEqual({
      target: GENERATOR_DENSITY_AUTOMATION_TARGET,
      label: "Density",
      group: "Generator",
      valueKind: "float",
      min: 0,
      max: 100,
      step: 1,
      unit: "%",
      sampleRate: "cycleStart",
      fallback: 72,
    });
  });

  it("exposes both Dum-Ka density corridor rails at cycle start", () => {
    expect(
      defs
        .filter((definition) =>
          [
            DUMKA_DENSITY_FLOOR_AUTOMATION_TARGET,
            DUMKA_DENSITY_CEILING_AUTOMATION_TARGET,
          ].includes(definition.target)
        )
        .map(({ target, label, fallback, unit, sampleRate }) => ({
          target,
          label,
          fallback,
          unit,
          sampleRate,
        }))
    ).toEqual([
      {
        target: DUMKA_DENSITY_CEILING_AUTOMATION_TARGET,
        label: "Density ceiling",
        fallback: 100,
        unit: "%",
        sampleRate: "cycleStart",
      },
      {
        target: DUMKA_DENSITY_FLOOR_AUTOMATION_TARGET,
        label: "Density floor",
        fallback: 0,
        unit: "%",
        sampleRate: "cycleStart",
      },
    ]);
  });

  it("exposes the depth corridor and placement field at cycle start", () => {
    expect(
      defs
        .filter((definition) =>
          [
            DUMKA_COMPLEXITY_CEILING_AUTOMATION_TARGET,
            DUMKA_COMPLEXITY_FLOOR_AUTOMATION_TARGET,
            DUMKA_PLACEMENT_BIAS_AUTOMATION_TARGET,
          ].includes(definition.target)
        )
        .map((definition) => ({
          target: definition.target,
          label: definition.label,
          valueKind: definition.valueKind,
          min: definition.min,
          max: definition.max,
          step: definition.step,
          unit: definition.unit,
          sampleRate: definition.sampleRate,
          fallback: definition.fallback,
        }))
    ).toEqual([
      {
        target: DUMKA_COMPLEXITY_CEILING_AUTOMATION_TARGET,
        label: "Complexity ceiling",
        valueKind: "integer",
        min: 0,
        max: 100_000,
        step: 1,
        unit: "milli",
        sampleRate: "cycleStart",
        fallback: 60_000,
      },
      {
        target: DUMKA_COMPLEXITY_FLOOR_AUTOMATION_TARGET,
        label: "Complexity floor",
        valueKind: "integer",
        min: 0,
        max: 100_000,
        step: 1,
        unit: "milli",
        sampleRate: "cycleStart",
        fallback: 12_000,
      },
      {
        target: DUMKA_PLACEMENT_BIAS_AUTOMATION_TARGET,
        label: "Placement bias",
        valueKind: "float",
        min: 0,
        max: 100,
        step: 1,
        unit: "%",
        sampleRate: "cycleStart",
        fallback: 35,
      },
    ]);
  });

  it("exposes the Dum-Ka evolution knobs as cycle-start percent automation", () => {
    expect(
      defs.find(
        (definition) =>
          definition.target === DUMKA_EVOLUTION_RATE_AUTOMATION_TARGET
      )
    ).toEqual({
      target: DUMKA_EVOLUTION_RATE_AUTOMATION_TARGET,
      label: "Evolution rate",
      group: "Generator",
      valueKind: "float",
      min: 0,
      max: 100,
      step: 1,
      unit: "%",
      sampleRate: "cycleStart",
      fallback: 0,
    });
    expect(
      defs.find(
        (definition) =>
          definition.target === DUMKA_BARLOW_TEMPERATURE_AUTOMATION_TARGET
      )
    ).toEqual({
      target: DUMKA_BARLOW_TEMPERATURE_AUTOMATION_TARGET,
      label: "Barlow temperature",
      group: "Generator",
      valueKind: "float",
      min: 0,
      max: 100,
      step: 1,
      unit: "%",
      sampleRate: "cycleStart",
      fallback: 0,
    });
    expect(
      defs.find(
        (definition) =>
          definition.target === DUMKA_FILL_COMPLEXITY_AUTOMATION_TARGET
      )
    ).toEqual({
      target: DUMKA_FILL_COMPLEXITY_AUTOMATION_TARGET,
      label: "Fill complexity",
      group: "Generator",
      valueKind: "float",
      min: 0,
      max: 100,
      step: 1,
      unit: "%",
      sampleRate: "cycleStart",
      fallback: 0,
    });
    expect(
      defs.find(
        (definition) => definition.target === DUMKA_DRIFT_LEASH_AUTOMATION_TARGET
      )
    ).toEqual({
      target: DUMKA_DRIFT_LEASH_AUTOMATION_TARGET,
      label: "Drift leash",
      group: "Generator",
      valueKind: "float",
      min: 0,
      max: 100,
      step: 1,
      unit: "%",
      sampleRate: "cycleStart",
      fallback: 25,
    });
  });

  it("adds per-note-group channel position automation targets", () => {
    const withPosition = buildAutomationTargetDefs({
      ...automationTargetBuildInput,
      channelPositionRules: [
        {
          id: "beat two",
          label: "Beat Two",
          enabled: true,
          scope: "beat",
          nth: 2,
          actionWeights: { normalMarkov: 0, renderOnly: 5, resetMarkov: 1 },
          renderWeights: { "3": 9 },
          resetMode: "customWeighted",
          resetWeights: { "2": 7 },
        },
      ],
    });
    const byTarget = new Map(withPosition.map((def) => [def.target, def]));

    expect(byTarget.get(channelPositionEnabledAutomationTarget("beat two"))).toMatchObject({
      group: "Channel Positions",
      valueKind: "boolean",
    });
    expect(byTarget.get(channelPositionNthAutomationTarget("beat two"))).toMatchObject({
      group: "Channel Positions",
      valueKind: "integer",
      sampleRate: "noteGroup",
      fallback: 2,
    });
    expect(
      byTarget.get(channelPositionActionAutomationTarget("beat two", "renderOnly"))
    ).toMatchObject({ valueKind: "weight", fallback: 5 });
    expect(byTarget.get(channelPositionRenderAutomationTarget("beat two", 3))).toMatchObject({
      valueKind: "weight",
      fallback: 9,
    });
    expect(byTarget.get(channelPositionResetAutomationTarget("beat two", 2))).toMatchObject({
      valueKind: "weight",
      fallback: 7,
    });
  });
});

describe("automationTargetGroups", () => {
  it("prepends 'all' and keeps distinct groups in first-seen order", () => {
    const defs = [
      def({ target: "a", group: "Transport" }),
      def({ target: "b", group: "Cycle" }),
      def({ target: "c", group: "Transport" }),
    ];
    expect(automationTargetGroups(defs)).toEqual(["all", "Transport", "Cycle"]);
  });

  it("returns just 'all' for no defs", () => {
    expect(automationTargetGroups([])).toEqual(["all"]);
  });
});

describe("filterAvailableAutomationTargets", () => {
  const defs = [
    def({ target: "transport.tempoBpm", label: "Tempo", group: "Transport", valueKind: "float" }),
    def({ target: "sequencer.pitch", label: "Pitch", group: "Cycle", valueKind: "integer" }),
    def({ target: "channelHocket.enabled", label: "Hocket enabled", group: "Channel Hocket", valueKind: "boolean" }),
  ];

  it("excludes targets that already have an active track", () => {
    const result = filterAvailableAutomationTargets(
      defs,
      [{ target: "transport.tempoBpm" }],
      "all",
      "all",
      ""
    );
    expect(result.map((d) => d.target)).toEqual(["sequencer.pitch", "channelHocket.enabled"]);
  });

  it("narrows by group and by kind", () => {
    expect(
      filterAvailableAutomationTargets(defs, [], "Cycle", "all", "").map((d) => d.target)
    ).toEqual(["sequencer.pitch"]);
    expect(
      filterAvailableAutomationTargets(defs, [], "all", "boolean", "").map((d) => d.target)
    ).toEqual(["channelHocket.enabled"]);
  });

  it("matches a trimmed, case-insensitive query over group, label, and target", () => {
    expect(
      filterAvailableAutomationTargets(defs, [], "all", "all", "  HOCKET ").map((d) => d.target)
    ).toEqual(["channelHocket.enabled"]);
    // matches on the target id even when the label does not contain the query
    expect(
      filterAvailableAutomationTargets(defs, [], "all", "all", "sequencer").map((d) => d.target)
    ).toEqual(["sequencer.pitch"]);
  });

  it("returns everything when the query is whitespace and no filters apply", () => {
    expect(
      filterAvailableAutomationTargets(defs, [], "all", "all", "   ")
    ).toHaveLength(3);
  });
});

describe("automation time <-> unit", () => {
  it("maps a fraction to a 0-1 unit, guarding zero denominators", () => {
    expect(automationTimeToUnit({ numer: 1, denom: 2 })).toBe(0.5);
    expect(automationTimeToUnit({ numer: 5, denom: 0 })).toBe(0);
    expect(automationTimeToUnit({ numer: 9, denom: 4 })).toBe(1);
  });

  it("round-trips a unit back through a reduced fraction", () => {
    for (const unit of [0, 0.25, 0.5, 0.75, 1]) {
      const time = automationTimeFromUnit(unit);
      expect(automationTimeToUnit(time)).toBeCloseTo(unit, 6);
    }
  });
});

/**
 * GOLDEN SEGMENT-CURVE TABLE — shared with the backend.
 *
 * The same (t, kind, amount) → value rows are asserted against Rust's
 * `warp_automation_t` in `crates/cseq-model` (`automation_warp_matches_the_
 * golden_parity_table`). The editor graph and the playback sampler must warp
 * identically or the drawn curve lies; if you change one implementation,
 * change the other and BOTH tables.
 */
const GOLDEN_WARP_TABLE: Array<{
  kind: "linear" | "hold" | "smooth" | "easeIn" | "easeOut" | "easeInOut" | "exponential";
  amount: number;
  t: number;
  expected: number;
}> = [
  { kind: "linear", amount: 1, t: 0.25, expected: 0.25 },
  { kind: "hold", amount: 1, t: 0.7, expected: 0 },
  { kind: "smooth", amount: 1, t: 0.25, expected: 0.15625 },
  { kind: "smooth", amount: 0.5, t: 0.25, expected: 0.203125 },
  { kind: "easeIn", amount: 1, t: 0.25, expected: 0.000244140625 },
  { kind: "easeIn", amount: 0, t: 0.25, expected: 0.25 },
  { kind: "easeOut", amount: 1, t: 0.25, expected: 0.822021484375 },
  { kind: "easeInOut", amount: 1, t: 0.25, expected: 0.0078125 },
  { kind: "easeInOut", amount: 1, t: 0.75, expected: 0.9921875 },
  // (9^0.5 - 1) / 8 — exactly 0.25.
  { kind: "exponential", amount: 1, t: 0.5, expected: 0.25 },
  // (9^0.25 - 1) / 8 = (sqrt(3) - 1) / 8.
  { kind: "exponential", amount: 1, t: 0.25, expected: (Math.sqrt(3) - 1) / 8 },
  { kind: "exponential", amount: 0, t: 0.3, expected: 0.3 },
];

describe("warpAutomationUnit (golden parity with the backend sampler)", () => {
  it("matches the shared table exactly", () => {
    for (const row of GOLDEN_WARP_TABLE) {
      const warped = warpAutomationUnit(row.t, { kind: row.kind, amount: row.amount });
      expect(warped, `${row.kind} amount=${row.amount} t=${row.t}`).toBeCloseTo(
        row.expected,
        12
      );
    }
  });

  it("flows through automationGraphSampleValue as a plain lerp of the warp", () => {
    const d = def({ target: "x", fallback: 0 });
    const left: AutomationPointData = {
      id: "l",
      time: { numer: 0, denom: 1 },
      value: { type: "number", value: 10 },
      anchorId: null,
      outCurve: { kind: "easeInOut", amount: 1 },
    };
    const right: AutomationPointData = {
      id: "r",
      time: { numer: 1, denom: 1 },
      value: { type: "number", value: 20 },
      anchorId: null,
      outCurve: null,
    };
    expect(automationGraphSampleValue(left, right, 0.25, d)).toBeCloseTo(
      10 + 10 * 0.0078125,
      12
    );
  });
});

describe("automationSegmentCurveForPoint (curve-interpolation fallback parity)", () => {
  const point = (outCurve: AutomationPointData["outCurve"]): AutomationPointData => ({
    id: "p",
    time: { numer: 0, denom: 1 },
    value: { type: "number", value: 0 },
    anchorId: null,
    outCurve,
  });

  it("prefers the point's explicit outCurve", () => {
    expect(
      automationSegmentCurveForPoint(point({ kind: "exponential", amount: 0.5 }), "hold")
    ).toEqual({ kind: "exponential", amount: 0.5 });
  });

  it("falls back to the CURVE interpolation like the backend, not plain linear", () => {
    // Regression: a null outCurve on a hold/smooth curve rendered linear in the
    // editor while the sampler played hold/smooth.
    expect(automationSegmentCurveForPoint(point(null), "hold")).toEqual({
      kind: "hold",
      amount: 1,
    });
    expect(automationSegmentCurveForPoint(point(null), "smooth")).toEqual({
      kind: "smooth",
      amount: 1,
    });
    expect(automationSegmentCurveForPoint(point(null), "linear")).toEqual({
      kind: "linear",
      amount: 1,
    });
    expect(automationSegmentCurveForPoint(point(null))).toEqual({
      kind: "linear",
      amount: 1,
    });
  });
});

describe("marker-anchored effective time (mirror of the backend resolver)", () => {
  const markers: AutomationMarkerData[] = [
    { id: "m-early", time: { numer: 1, denom: 10 }, label: "early" },
    { id: "m-late", time: { numer: 4, denom: 5 }, label: "late" },
  ];
  const point = (
    id: string,
    time: { numer: number; denom: number },
    anchorId: string | null
  ): AutomationPointData => ({
    id,
    time,
    value: { type: "number", value: 0 },
    anchorId,
    outCurve: null,
  });

  it("unanchored and dangling anchors use the stored time", () => {
    const free = point("free", { numer: 1, denom: 2 }, null);
    const dangling = point("dangling", { numer: 1, denom: 2 }, "no-such-marker");
    expect(automationPointEffectiveTime(free, markers)).toEqual({ numer: 1, denom: 2 });
    expect(automationPointEffectiveTime(dangling, markers)).toEqual({
      numer: 1,
      denom: 2,
    });
  });

  it("an anchored point lives at its marker's time", () => {
    const anchored = point("anchored", { numer: 1, denom: 2 }, "m-late");
    expect(automationPointEffectiveTime(anchored, markers)).toEqual({
      numer: 4,
      denom: 5,
    });
    expect(automationPointEffectiveUnit(anchored, markers)).toBeCloseTo(0.8, 12);
  });

  it("sorting follows effective time, so a moved marker reorders points", () => {
    // Stored order: anchored(0.5→m-early@0.1), free(0.3). Effective order flips.
    const anchored = point("anchored", { numer: 1, denom: 2 }, "m-early");
    const free = point("free", { numer: 3, denom: 10 }, null);
    const sorted = sortAutomationPointsByEffectiveTime([anchored, free], markers);
    expect(sorted.map((p) => p.id)).toEqual(["anchored", "free"]);
    // Without the marker the same list sorts by stored time.
    const stored = sortAutomationPointsByEffectiveTime([anchored, free], []);
    expect(stored.map((p) => p.id)).toEqual(["free", "anchored"]);
  });
});

describe("makeAutomationCurve endpoints", () => {
  it("creates a two-point flat lane with NO anchor sentinels", () => {
    // Regression: endpoints used to carry dangling `automation-start`/`-end`
    // anchorIds, which became live (wrong) data once the sampler started
    // evaluating marker anchors.
    const curve = makeAutomationCurve(def({ target: "x", fallback: 7 }), "c");
    expect(curve.points).toHaveLength(2);
    expect(curve.points[0]!.time).toEqual({ numer: 0, denom: 1 });
    expect(curve.points[1]!.time).toEqual({ numer: 1, denom: 1 });
    for (const point of curve.points) {
      expect(point.anchorId).toBeNull();
      expect(point.value).toEqual({ type: "number", value: 7 });
    }
  });
});

describe("snapAutomationUnitToMarker", () => {
  const markers: AutomationMarkerData[] = [
    { id: "m", time: { numer: 1, denom: 2 }, label: "" },
  ];

  it("snaps and anchors within the snap window", () => {
    expect(snapAutomationUnitToMarker(0.51, markers)).toEqual({
      unit: 0.5,
      anchorId: "m",
    });
  });

  it("stays free outside the snap window", () => {
    expect(snapAutomationUnitToMarker(0.6, markers)).toEqual({
      unit: 0.6,
      anchorId: null,
    });
  });

  it("clamps into the span and stays free with no markers", () => {
    expect(snapAutomationUnitToMarker(1.4, [])).toEqual({ unit: 1, anchorId: null });
  });
});
