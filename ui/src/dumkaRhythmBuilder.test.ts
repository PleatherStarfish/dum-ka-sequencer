import { describe, expect, it } from "vitest";
import parserContract from "./__fixtures__/dumka_parser_contract.json";

import {
  compileDumkaPattern,
  DEFAULT_DUMKA_PATTERN,
  resolveDumkaCells,
  type DumkaCompiled,
} from "./dumkaPattern";
import {
  articulateGroup,
  articulatableGroupIds,
  articulatableGroupIdsForBoundaryError,
  builderFromPattern,
  canArticulateGroup,
  classifySelection,
  fillEuclid,
  groupRatio,
  groupSelection,
  hasArticulatableGroup,
  insertSibling,
  isDumkaSpanBoundaryError,
  isValidDumkaStroke,
  patternHasRewritableSugar,
  printBuilderPattern,
  removeSelection,
  setGroupCount,
  setLeafKind,
  setStroke,
  setWeight,
  siblingRange,
  splitIntoTuplet,
  tryCommitBuilder,
  ungroupNode,
  type BuilderNode,
} from "./dumkaRhythmBuilder";

interface ContractCase {
  pattern: string;
  outcome: { ok: boolean };
}

function mustBuild(pattern: string): BuilderNode[] {
  const built = builderFromPattern(pattern);
  if (!built.ok) throw new Error(`expected ${pattern} to parse`);
  return built.nodes;
}

function mustCompile(pattern: string): DumkaCompiled {
  const result = compileDumkaPattern(pattern);
  if (!result.ok) throw new Error(`expected ${pattern} to compile`);
  return result.compiled;
}

function perBeatProjection(pattern: string, subdivision?: number) {
  const compiled = mustCompile(pattern);
  const grid = subdivision ?? compiled.requiredSubdivision;
  return Array.from({ length: compiled.totalBeats }, () => ({
    spanLen: grid,
    subdivision: grid,
  }));
}

function ids(nodes: BuilderNode[]): number[] {
  const out: number[] = [];
  const walk = (list: BuilderNode[]) => {
    for (const node of list) {
      out.push(node.id);
      walk(node.children);
    }
  };
  walk(nodes);
  return out;
}

describe("dumkaRhythmBuilder", () => {
  it("round-trips every contract success case with identical semantics", () => {
    const cases = (parserContract as ContractCase[]).filter(
      (contractCase) => contractCase.outcome.ok
    );
    expect(cases.length).toBeGreaterThan(0);
    for (const contractCase of cases) {
      const nodes = mustBuild(contractCase.pattern);
      const printed = printBuilderPattern(nodes);
      const source = compileDumkaPattern(contractCase.pattern);
      const roundTripped = compileDumkaPattern(printed);
      expect(roundTripped).toEqual(source);
    }
  });

  it("assigns DFS ids that survive a print/parse round trip", () => {
    const nodes = mustBuild(DEFAULT_DUMKA_PATTERN);
    const reparsed = mustBuild(printBuilderPattern(nodes));
    expect(ids(reparsed)).toEqual(ids(nodes));
  });

  it("cycles a leaf's type and defaults the stroke", () => {
    const nodes = mustBuild("x . x .");
    const result = setLeafKind(nodes, 1, "note");
    expect(result.ok && printBuilderPattern(result.nodes)).toBe("x x x .");
    const back = setLeafKind(nodes, 0, "rest");
    expect(back.ok && printBuilderPattern(back.nodes)).toBe(". . x .");
    expect(setLeafKind(mustBuild("[x x]"), 0, "rest").ok).toBe(false);
  });

  it("names strokes only when the parser reads them back verbatim", () => {
    expect(isValidDumkaStroke("dum")).toBe(true);
    expect(isValidDumkaStroke("E")).toBe(true);
    expect(isValidDumkaStroke("")).toBe(false);
    expect(isValidDumkaStroke("two words")).toBe(false);
    expect(isValidDumkaStroke("x@2")).toBe(false);
    const nodes = mustBuild("x . x .");
    const named = setStroke(nodes, 0, "dum");
    expect(named.ok && printBuilderPattern(named.nodes)).toBe("dum . x .");
    expect(setStroke(nodes, 0, "not valid").ok).toBe(false);
    expect(setStroke(nodes, 1, "dum").ok).toBe(false);
  });

  it("wraps a contiguous run in an identity group, then a weight edit makes the tuplet", () => {
    const nodes = mustBuild("x x x .");
    const range = siblingRange(nodes, 0, 2);
    expect(range).toEqual([0, 1, 2]);
    const grouped = groupSelection(nodes, range!);
    if (!grouped.ok) throw new Error(grouped.message);
    expect(printBuilderPattern(grouped.nodes)).toBe("[x x x]@3 .");
    // Identity wrap: compiled output is unchanged.
    expect(compileDumkaPattern(printBuilderPattern(grouped.nodes))).toEqual(
      compileDumkaPattern("x x x .")
    );
    const tuplet = setWeight(grouped.nodes, grouped.focusId, 2);
    expect(tuplet.ok && printBuilderPattern(tuplet.nodes)).toBe("[x x x]@2 .");
    const group = tuplet.ok ? tuplet.nodes[0]! : null;
    expect(group && groupRatio(group)).toEqual({ count: 3, span: 2 });
  });

  it("splits a weighted leaf into k equal strokes over the same span", () => {
    const nodes = mustBuild("x@2 . .");
    const split = splitIntoTuplet(nodes, 0, 5);
    expect(split.ok && printBuilderPattern(split.nodes)).toBe(
      "[x x x x x]@2 . ."
    );
    expect(splitIntoTuplet(nodes, 0, 1).ok).toBe(false);
    expect(splitIntoTuplet(mustBuild("[x x]"), 0, 3).ok).toBe(false);
  });

  it("resizes a group by appending and trimming from the end", () => {
    const nodes = mustBuild("[dum ka]@2 .");
    const grown = setGroupCount(nodes, 0, 3);
    expect(grown.ok && printBuilderPattern(grown.nodes)).toBe("[dum ka x]@2 .");
    const trimmed = setGroupCount(nodes, 0, 1);
    expect(trimmed.ok && printBuilderPattern(trimmed.nodes)).toBe("[dum]@2 .");
  });

  it("articulates a spanning 5:2 group into one existing-grid tick per note", () => {
    const nodes = mustBuild("[x x x x x]@2");
    const projection = perBeatProjection("[x x x x x]@2");
    expect(canArticulateGroup(nodes, 0, projection)).toBe(true);

    const result = articulateGroup(nodes, 0, projection);
    if (!result.ok) throw new Error(result.message);
    expect(printBuilderPattern(nodes)).toBe("[x x x x x]@2");
    expect(printBuilderPattern(result.nodes)).toBe(
      "[[x .] [x .] [x .] [x .] [x .]]@2"
    );

    const commit = tryCommitBuilder(result.nodes);
    expect(commit).toEqual({
      ok: true,
      pattern: "[[x .] [x .] [x .] [x .] [x .]]@2",
      required: { cycleBeats: 2, subdivision: 5 },
    });
    expect(
      compileDumkaPattern(printBuilderPattern(result.nodes))
    ).toEqual(
      compileDumkaPattern("[[x .] [x .] [x .] [x .] [x .]]@2")
    );

    const perBeatSpans = [1, 2].map((spanId) => ({
      spanId,
      spanLen: 5,
      subdivision: 5,
    }));
    expect(
      resolveDumkaCells(mustCompile("[x x x x x]@2"), 2, perBeatSpans)
    ).toEqual({
      ok: false,
      message:
        "a note sustains across the span boundary at beat 1; split the note or keep the hold inside one beat or Grouping tile",
    });
    expect(
      resolveDumkaCells(
        mustCompile(printBuilderPattern(result.nodes)),
        2,
        perBeatSpans
      ).ok
    ).toBe(true);
  });

  it("preserves strokes and outer weight, using exact-grid slot cells", () => {
    const source = mustBuild("[dum@3 ka] [. ka] [dum ka dum ka dum]@2");
    const result = articulateGroup(
      source,
      source[2]!.id,
      perBeatProjection("[dum@3 ka] [. ka] [dum ka dum ka dum]@2")
    );
    expect(result.ok && printBuilderPattern(result.nodes)).toBe(
      "[dum@3 ka] [. ka] [[dum .] [ka .] [dum .] [ka .] [dum .]]@2"
    );

    const threeBeat = mustBuild("[dum ka dum ka dum]@3");
    const generalized = articulateGroup(
      threeBeat,
      0,
      perBeatProjection("[dum ka dum ka dum]@3")
    );
    expect(generalized.ok && printBuilderPattern(generalized.nodes)).toBe(
      "[[dum .@2] [ka .@2] [dum .@2] [ka .@2] [dum .@2]]@3"
    );
    const before = tryCommitBuilder(threeBeat);
    const after = generalized.ok ? tryCommitBuilder(generalized.nodes) : null;
    expect(before.ok && before.required).toEqual({
      cycleBeats: 3,
      subdivision: 5,
    });
    expect(after && after.ok && after.required).toEqual({
      cycleBeats: 3,
      subdivision: 5,
    });
  });

  it("articulates an offset group whose original sustain fails at beat 2", () => {
    const source = mustBuild("x [x x x x x]@2 x");
    const group = source[1]!;
    const projection = perBeatProjection("x [x x x x x]@2 x");
    expect(canArticulateGroup(source, group.id, projection)).toBe(true);

    const spans = [1, 2, 3, 4].map((spanId) => ({
      spanId,
      spanLen: 5,
      subdivision: 5,
    }));
    expect(resolveDumkaCells(mustCompile(printBuilderPattern(source)), 4, spans)).toEqual({
      ok: false,
      message:
        "a note sustains across the span boundary at beat 2; split the note or keep the hold inside one beat or Grouping tile",
    });

    const result = articulateGroup(source, group.id, projection);
    if (!result.ok) throw new Error(result.message);
    expect(printBuilderPattern(result.nodes)).toBe(
      "x [[x .] [x .] [x .] [x .] [x .]]@2 x"
    );
    expect(
      resolveDumkaCells(
        mustCompile(printBuilderPattern(result.nodes)),
        4,
        spans
      ).ok
    ).toBe(true);
  });

  it("uses exact parent geometry to articulate a nested spanning group", () => {
    const source = mustBuild("[[x x x x x]@2]@2");
    const nested = source[0]!.children[0]!;
    const projection = perBeatProjection("[[x x x x x]@2]@2");
    expect(canArticulateGroup(source, nested.id, projection)).toBe(true);
    expect(hasArticulatableGroup(source, projection)).toBe(true);

    const result = articulateGroup(source, nested.id, projection);
    expect(result.ok && printBuilderPattern(result.nodes)).toBe(
      "[[[x .] [x .] [x .] [x .] [x .]]@2]@2"
    );
  });

  it("lists every preflighted articulation candidate in DFS order without mutation", () => {
    const pattern = "[[x x x x x]@2]@2 [x x x x x]@2";
    const source = mustBuild(pattern);
    const projection = perBeatProjection(pattern);

    expect(articulatableGroupIds(source, projection)).toEqual([1, 7]);
    expect(hasArticulatableGroup(source, projection)).toBe(true);
    expect(printBuilderPattern(source)).toBe(pattern);
  });

  it("repairs the mixed 5:2 tuplet from the reported five-beat pattern", () => {
    const pattern =
      "[dum . . ka] [. . ka . x]@2 [dum . ka .] [x x . x]";
    const source = mustBuild(pattern);
    const group = source[1]!;
    const projection = perBeatProjection(pattern);
    const spans = projection.map((span, index) => ({
      spanId: index + 1,
      ...span,
    }));

    expect(resolveDumkaCells(mustCompile(pattern), 5, spans)).toEqual({
      ok: false,
      message:
        "a note sustains across the span boundary at beat 2; split the note or keep the hold inside one beat or Grouping tile",
    });
    expect(canArticulateGroup(source, group.id, projection)).toBe(true);
    expect(articulatableGroupIdsForBoundaryError(source, projection)).toEqual([
      group.id,
    ]);

    const result = articulateGroup(source, group.id, projection);
    if (!result.ok) throw new Error(result.message);
    expect(printBuilderPattern(result.nodes)).toBe(
      "[dum . . ka] [. . [ka .] . [x .]]@2 [dum . ka .] [x x . x]"
    );
    expect(
      resolveDumkaCells(
        mustCompile(printBuilderPattern(result.nodes)),
        5,
        spans
      ).ok
    ).toBe(true);
  });

  it("does not localize an earlier unrelated sustain to a later tuplet", () => {
    const pattern = "x x@2 [x x x x x]@2";
    const source = mustBuild(pattern);
    const projection = perBeatProjection(pattern);
    const spans = projection.map((span, index) => ({
      spanId: index + 1,
      ...span,
    }));

    expect(resolveDumkaCells(mustCompile(pattern), 5, spans)).toEqual({
      ok: false,
      message:
        "a note sustains across the span boundary at beat 2; split the note or keep the hold inside one beat or Grouping tile",
    });
    expect(articulatableGroupIds(source, projection)).toEqual([2]);
    expect(articulatableGroupIdsForBoundaryError(source, projection)).toEqual(
      []
    );
  });

  it("repairs only the crossing note when direct child weights differ", () => {
    const pattern = "[x@2 x]@2";
    const source = mustBuild(pattern);
    const projection = perBeatProjection(pattern);
    const result = articulateGroup(source, 0, projection);
    expect(result.ok && printBuilderPattern(result.nodes)).toBe(
      "[[x .]@2 x]@2"
    );
  });

  it("keeps equal-duration articulation invariant to common weight scaling", () => {
    const pattern = "[x@2 x@2 x@2 x@2 x@2]@2";
    const result = articulateGroup(
      mustBuild(pattern),
      0,
      perBeatProjection(pattern)
    );
    expect(result.ok && printBuilderPattern(result.nodes)).toBe(
      "[[x .]@2 [x .]@2 [x .]@2 [x .]@2 [x .]@2]@2"
    );
  });

  it("uses the actual Grouping cuts instead of inferred whole-beat fences", () => {
    const pattern = "[[x x x x x]@2 .]@2";
    const source = mustBuild(pattern);
    const nested = source[0]!.children[0]!;
    const projection = Array.from({ length: 10 }, () => ({
      spanLen: 3,
      subdivision: 15,
    }));

    const beforeSpans = projection.map((span, index) => ({
      spanId: index + 1,
      ...span,
    }));
    expect(resolveDumkaCells(mustCompile(pattern), 2, beforeSpans).ok).toBe(false);
    expect(canArticulateGroup(source, nested.id, projection)).toBe(true);
    expect(articulatableGroupIdsForBoundaryError(source, projection)).toEqual([
      nested.id,
    ]);

    const result = articulateGroup(source, nested.id, projection);
    if (!result.ok) throw new Error(result.message);
    expect(printBuilderPattern(result.nodes)).toBe(
      "[[[x .@3] [x .@3] [x .@3] [x .@3] [x .@3]]@2 .]@2"
    );
    expect(
      resolveDumkaCells(
        mustCompile(printBuilderPattern(result.nodes)),
        2,
        beforeSpans
      ).ok
    ).toBe(true);
  });

  it("keeps the canonical 5:2 repair on a compatible larger grid", () => {
    const pattern = "[x x x x x]@2";
    const source = mustBuild(pattern);
    const projection = perBeatProjection(pattern, 10);
    const result = articulateGroup(source, 0, projection);
    expect(result.ok && printBuilderPattern(result.nodes)).toBe(
      "[[x .] [x .] [x .] [x .] [x .]]@2"
    );
  });

  it("fails closed for stale layouts and DSL-depth overflow", () => {
    const source = mustBuild("[x x x x x]@2");
    for (const projection of [
      [],
      [{ spanLen: 5, subdivision: 5 }],
      [
        { spanLen: 5, subdivision: 5 },
        { spanLen: 10, subdivision: 10 },
      ],
    ]) {
      expect(canArticulateGroup(source, 0, projection)).toBe(false);
      expect(articulatableGroupIds(source, projection)).toEqual([]);
      expect(articulateGroup(source, 0, projection).ok).toBe(false);
    }

    let deepest = "[x x x x x]@2";
    for (let depth = 1; depth < 16; depth += 1) deepest = `[${deepest}]@2`;
    const deepNodes = mustBuild(deepest);
    expect(
      canArticulateGroup(
        deepNodes,
        15,
        perBeatProjection(deepest)
      )
    ).toBe(false);
    expect(
      articulatableGroupIds(deepNodes, perBeatProjection(deepest))
    ).toEqual([]);
  });

  it("chunks a large articulation rest without exceeding the weight cap", () => {
    const pattern = "[.@6 [x]@55]@10";
    const source = mustBuild(pattern);
    const projection = perBeatProjection(pattern);
    const result = articulateGroup(source, 2, projection);
    expect(result.ok && printBuilderPattern(result.nodes)).toBe(
      "[.@6 [[x .@512 .@37]]@55]@10"
    );
    const spans = projection.map((span, index) => ({
      spanId: index + 1,
      ...span,
    }));
    expect(
      resolveDumkaCells(
        mustCompile(result.ok ? printBuilderPattern(result.nodes) : ""),
        10,
        spans
      ).ok
    ).toBe(true);
  });

  it("offers articulation only for flat note/rest groups with a crossing note", () => {
    for (const pattern of [
      "[x x x x]@2",
      "[x . x]@2",
      "[x x]",
      "[x _ x]@2",
      "[[x] x]@2",
      "[. . .]@2",
    ]) {
      const nodes = mustBuild(pattern);
      const projection = perBeatProjection(pattern);
      for (const id of ids(nodes)) {
        expect(
          canArticulateGroup(nodes, id, projection),
          `${pattern} at ${id}`
        ).toBe(false);
      }
      expect(articulateGroup(nodes, nodes[0]!.id, projection).ok).toBe(false);
      expect(hasArticulatableGroup(nodes, projection)).toBe(false);
    }
    expect(isDumkaSpanBoundaryError(null)).toBe(false);
    expect(isDumkaSpanBoundaryError("pattern needs Subdivision 5")).toBe(false);
    expect(
      isDumkaSpanBoundaryError(
        "dumka structure mismatch: a note sustains across the span boundary at beat 1; split it"
      )
    ).toBe(true);
  });

  it("inserts, removes, and refuses to empty a group or the pattern", () => {
    const nodes = mustBuild("[x x] .");
    const added = insertSibling(nodes, 2, "after");
    expect(added.ok && printBuilderPattern(added.nodes)).toBe("[x x x] .");
    const removed = removeSelection(nodes, [3]);
    expect(removed.ok && printBuilderPattern(removed.nodes)).toBe("[x x]");
    expect(removeSelection(mustBuild("x"), [0]).ok).toBe(false);
    const emptying = removeSelection(nodes, siblingRange(nodes, 1, 2)!);
    expect(emptying.ok).toBe(false);
  });

  it("ungroups in place and classifies selections strictly", () => {
    const nodes = mustBuild("[x .]@2 ka");
    const flat = ungroupNode(nodes, 0);
    expect(flat.ok && printBuilderPattern(flat.nodes)).toBe("x . ka");
    expect(ungroupNode(nodes, 1).ok).toBe(false);

    // ids 1 (inside the group) and 3 (top level) are not siblings.
    expect(classifySelection(nodes, [1, 3])).toEqual({ kind: "invalid" });
    expect(siblingRange(nodes, 1, 3)).toBeNull();
    // ids 0 and 3 are siblings but a run needs contiguity — here they are
    // adjacent (indices 0 and 1), so the run is legal.
    const run = classifySelection(nodes, [3, 0]);
    expect(run.kind).toBe("run");
  });

  it("fills a leaf with the shared Bjorklund necklace expansion", () => {
    const nodes = mustBuild("x@2 . .");
    const tresillo = fillEuclid(nodes, 0, 3, 8, 0);
    expect(tresillo.ok && printBuilderPattern(tresillo.nodes)).toBe(
      "[x . . x . . x .]@2 . ."
    );
    // Identical to the notation sugar over the same span.
    expect(
      compileDumkaPattern(tresillo.ok ? printBuilderPattern(tresillo.nodes) : "")
    ).toEqual(compileDumkaPattern("E(3,8)@2 . ."));
    const rotated = fillEuclid(nodes, 0, 3, 8, 3);
    expect(rotated.ok && printBuilderPattern(rotated.nodes)).toBe(
      "[x . . x . x . .]@2 . ."
    );
    expect(fillEuclid(nodes, 0, 9, 8, 0).ok).toBe(false);
    expect(fillEuclid(nodes, 0, 3, 65, 0).ok).toBe(false);
    expect(fillEuclid(mustBuild("[x x]"), 0, 3, 8, 0).ok).toBe(false);
  });

  it("rejects an illegal commit with the mirrored compiler's message", () => {
    const nodes = mustBuild("x . x .");
    const holdFirst = setLeafKind(nodes, 0, "hold");
    if (!holdFirst.ok) throw new Error(holdFirst.message);
    const commit = tryCommitBuilder(holdFirst.nodes);
    expect(commit.ok).toBe(false);
    if (!commit.ok) {
      expect(commit.message).toBe(
        "'_' has nothing to extend; start with a note or rest"
      );
    }
    const fine = tryCommitBuilder(nodes);
    expect(fine.ok && fine.pattern).toBe("x . x .");
    expect(fine.ok && fine.required).toEqual({ cycleBeats: 4, subdivision: 1 });
  });

  it("flags sugar, comments, and bars for the rewrite hint", () => {
    expect(patternHasRewritableSugar("E(3,8)")).toBe(true);
    expect(patternHasRewritableSugar("x*4")).toBe(true);
    expect(patternHasRewritableSugar("x . | x .")).toBe(true);
    expect(patternHasRewritableSugar("x . # tail")).toBe(true);
    expect(patternHasRewritableSugar(DEFAULT_DUMKA_PATTERN)).toBe(false);
  });
});
