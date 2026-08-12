import { describe, expect, it } from "vitest";
import parserContract from "./__fixtures__/dumka_parser_contract.json";
import {
  DEFAULT_DUMKA_PATTERN,
  compileDumkaPattern,
  deriveDumkaBeatSlotCounts,
  dumkaEuclid,
  formatDumkaParseError,
  normalizeDumkaPattern,
  resolveDumkaCells,
} from "./dumkaPattern";

interface ParserProjectionContract {
  cycleBeats: number;
  spans: Array<{
    spanId: number;
    spanLen: number;
    subdivision: number | null;
  }>;
  outcome: ReturnType<typeof resolveDumkaCells>;
}

interface ParserContractCase {
  pattern: string;
  outcome: ReturnType<typeof compileDumkaPattern>;
  projection?: ParserProjectionContract;
}

const parserContractCases = parserContract as ParserContractCase[];

// Every vector and message in this file is pinned against the Rust engine's
// tests in crates/cseq-rhythm/src/generators/dumka. If either side changes
// alone, this suite (or the Rust suite) must fail.

const README_PATTERN = "[dum@3 ka] [. ka] [dum ka dum ka dum]@2";

function compiled(text: string) {
  const result = compileDumkaPattern(text);
  if (!result.ok) throw new Error(`unexpected issue: ${result.issue.message}`);
  return result.compiled;
}

function issue(text: string) {
  const result = compileDumkaPattern(text);
  if (result.ok) throw new Error("expected an issue");
  return result.issue;
}

describe("dumkaPattern mirror", () => {
  it("matches the Rust-generated parser/compiler contract corpus", () => {
    for (const entry of parserContractCases) {
      expect(compileDumkaPattern(entry.pattern), entry.pattern).toEqual(entry.outcome);
    }
  });

  it("matches the Rust-generated tied projection contract corpus", () => {
    const projections = parserContractCases.filter(
      (entry): entry is ParserContractCase & {
        projection: ParserProjectionContract;
      } => entry.projection !== undefined
    );
    expect(projections.map((entry) => entry.pattern)).toEqual([
      "[x x x x x]@2",
      "x _ _ .",
    ]);

    for (const entry of projections) {
      const result = compileDumkaPattern(entry.pattern);
      if (!result.ok) throw new Error(`contract pattern failed: ${entry.pattern}`);
      expect(
        resolveDumkaCells(
          result.compiled,
          entry.projection.cycleBeats,
          entry.projection.spans
        ),
        entry.pattern
      ).toEqual(entry.projection.outcome);
    }
  });

  it("guards persisted patterns verbatim", () => {
    expect(normalizeDumkaPattern("  x .  x . ")).toBe("  x .  x . ");
    expect(normalizeDumkaPattern("")).toBe(DEFAULT_DUMKA_PATTERN);
    expect(normalizeDumkaPattern(7)).toBe(DEFAULT_DUMKA_PATTERN);

    const atLimit = `x #${"😀".repeat(4093)}`;
    expect(normalizeDumkaPattern(atLimit)).toBe(atLimit);
    expect(normalizeDumkaPattern(`${atLimit}😀`)).toBe(DEFAULT_DUMKA_PATTERN);
  });

  it("matches Rust Unicode scalar length, whitespace, and columns", () => {
    expect(compiled("x\u0085x").totalBeats).toBe(2);
    expect(issue("x\ufeffx")).toEqual({
      line: 1,
      col: 2,
      message: "unexpected character '\ufeff'",
    });
    expect(issue("x 😀")).toEqual({
      line: 1,
      col: 3,
      message: "unexpected character '😀'",
    });

    const atLimit = `x #${"😀".repeat(4093)}`;
    expect(compiled(atLimit).totalBeats).toBe(1);
    expect(issue(`${atLimit}😀`).message).toBe(
      "pattern is 4097 characters; the maximum is 4096"
    );
  });

  it("matches the engine's canonical Euclidean timelines", () => {
    const asString = (pattern: boolean[]) =>
      pattern.map((b) => (b ? "1" : "0")).join("");
    expect(asString(dumkaEuclid(3, 8, 0))).toBe("10010010");
    expect(asString(dumkaEuclid(5, 8, 0))).toBe("10110110");
    expect(asString(dumkaEuclid(5, 16, 0))).toBe("1001001001001000");
    expect(asString(dumkaEuclid(3, 8, 3))).toBe("10010100");
  });

  it("compiles the reference pattern to the engine's exact structure", () => {
    const seed = compiled(README_PATTERN);
    expect(seed.totalBeats).toBe(4);
    expect(seed.requiredSubdivision).toBe(20);
    expect(seed.events).toHaveLength(8);
    expect(seed.events[0]).toEqual({
      start: { num: 0, den: 1 },
      dur: { num: 3, den: 4 },
      cls: "dum",
    });
    expect(seed.events[3]).toEqual({
      start: { num: 2, den: 1 },
      dur: { num: 2, den: 5 },
      cls: "dum",
    });
  });

  it("derives the exact minimal slot grid for every physical beat", () => {
    const heterogeneous = deriveDumkaBeatSlotCounts(
      "[x x x x x] [x . x .] x x"
    );
    expect(heterogeneous).toEqual({
      ok: true,
      slotsPerBeat: [5, 4, 1, 1],
      required: { cycleBeats: 4, subdivision: 20 },
    });

    // Top-level weight scales the proportional subtree before it is divided
    // back into physical beats: four slots over two beats need a 2-grid in
    // each beat, while three slots over two beats need a 3-grid in each.
    expect(deriveDumkaBeatSlotCounts("[x x x x]@2 [x x x]@2")).toEqual({
      ok: true,
      slotsPerBeat: [2, 2, 3, 3],
      required: { cycleBeats: 4, subdivision: 6 },
    });

    // Nested proportional denominators multiply exactly: the first half is a
    // duplet and the second half a triplet, so their starts need LCM 12.
    expect(deriveDumkaBeatSlotCounts("[[x .] [x x x]]")).toEqual({
      ok: true,
      slotsPerBeat: [12],
      required: { cycleBeats: 1, subdivision: 12 },
    });
  });

  it("includes rests and applies holds before deriving beat grids", () => {
    // Public compiled events omit rests, but their starts still define the
    // authored grid used by the compiler.
    expect(deriveDumkaBeatSlotCounts("[. . . .]")).toEqual({
      ok: true,
      slotsPerBeat: [4],
      required: { cycleBeats: 1, subdivision: 4 },
    });
    // Holds do not start elements. A fully held beat therefore collapses to
    // the one-slot grid, while a later rest exposes the original fifths.
    expect(deriveDumkaBeatSlotCounts("[x _ _ _ _]")).toEqual({
      ok: true,
      slotsPerBeat: [1],
      required: { cycleBeats: 1, subdivision: 1 },
    });
    expect(deriveDumkaBeatSlotCounts("[x _ . . .]")).toEqual({
      ok: true,
      slotsPerBeat: [5],
      required: { cycleBeats: 1, subdivision: 5 },
    });
    expect(deriveDumkaBeatSlotCounts("x _")).toEqual({
      ok: true,
      slotsPerBeat: [1, 1],
      required: { cycleBeats: 2, subdivision: 1 },
    });
  });

  it("projects the reference pattern to the engine's exact cell picture", () => {
    const result = resolveDumkaCells(compiled(README_PATTERN), 4, [
      { spanId: 7, spanLen: 80, subdivision: 20 },
    ]);
    if (!result.ok) throw new Error(result.message);
    const picture = result.spans[0]!.cells.map((cell) => [
      cell.start,
      cell.len,
      cell.rest,
    ]);
    expect(picture).toEqual([
      [0, 15, false],
      [15, 5, false],
      [20, 10, true],
      [30, 10, false],
      [40, 8, false],
      [48, 8, false],
      [56, 8, false],
      [64, 8, false],
      [72, 8, false],
    ]);
  });

  it("plays the default pattern on a fresh four-beat structure", () => {
    const result = resolveDumkaCells(
      compiled(DEFAULT_DUMKA_PATTERN),
      4,
      [1, 2, 3, 4].map((spanId) => ({ spanId, spanLen: 4, subdivision: 4 }))
    );
    if (!result.ok) throw new Error(result.message);
    const sounding = result.spans
      .flatMap((span) => span.cells)
      .filter((cell) => !cell.rest).length;
    expect(sounding).toBe(8);
    for (const span of result.spans) {
      const total = span.cells.reduce((sum, cell) => sum + cell.len, 0);
      expect(total).toBe(span.spanLen);
    }
  });

  it("merges holds exactly like the engine", () => {
    const seed = compiled(". _ x _");
    expect(seed.events).toHaveLength(1);
    expect(seed.events[0]!.start).toEqual({ num: 2, den: 1 });
    expect(seed.events[0]!.dur).toEqual({ num: 2, den: 1 });
  });

  it("pins parse diagnostics byte-for-byte", () => {
    const weight = issue("x .\n[x ka@0]");
    expect(weight).toEqual({ line: 2, col: 7, message: "weight must be 1-512" });
    expect(formatDumkaParseError(weight)).toBe(
      "dumka pattern parse error at line 2, column 7: weight must be 1-512"
    );

    expect(issue("[x x").message).toBe("unclosed '['");
    expect(issue("x ]").message).toBe("']' without a matching '['");
    expect(issue("").message).toBe(
      "empty pattern; write at least one note, e.g. x . x ."
    );
    expect(issue("[]").message).toBe("empty group '[]'");
    expect(issue("E(9,8)").message).toBe("E(9,8) has more onsets than slots");
    expect(issue("dum(3,8)").message).toBe(
      "'(' is only valid after E, as in E(3,8)"
    );
    expect(issue("_ x").message).toBe(
      "'_' has nothing to extend; start with a note or rest"
    );
    const tuplet = issue(`[${"x ".repeat(97)}]`);
    expect(tuplet.message).toBe(
      "pattern needs a per-beat Subdivision of 97, above the maximum 64; simplify the tuplet here"
    );
  });

  it("counts actual expanded nodes exactly once", () => {
    expect(issue("x*64 ".repeat(64)).message).toBe(
      "pattern spans 4096 beats; the maximum is 128"
    );
    expect(issue("x*64 ".repeat(65)).message).toBe(
      "pattern expands to more than 4096 nodes"
    );

    const nested = `${"[".repeat(16)}x ${"_ ".repeat(239)}${"]".repeat(16)}`;
    const seed = compiled(nested);
    expect(seed.totalBeats).toBe(1);
    expect(seed.events).toEqual([
      { start: { num: 0, den: 1 }, dur: { num: 1, den: 1 }, cls: "x" },
    ]);
  });

  it("keeps adversarial rational nesting exact and total", () => {
    // Mirrored in tree.rs: this used to overflow/panic in Rust and round in JS.
    expect(issue("[[[[x .@512] .@512] .@512] .@512]")).toEqual({
      line: 1,
      col: 7,
      message:
        "pattern needs a per-beat Subdivision of 69257922561, above the maximum 64; simplify the tuplet here",
    });

    let cancelled = "x";
    for (let depth = 0; depth < 16; depth += 1) {
      cancelled = `[${cancelled} _@512]`;
    }
    expect(compiled(cancelled)).toEqual({
      totalBeats: 1,
      requiredSubdivision: 1,
      events: [{ start: { num: 0, den: 1 }, dur: { num: 1, den: 1 }, cls: "x" }],
    });
  });

  it("pins structure diagnostics byte-for-byte", () => {
    const quintuplets = compiled("[x x x x x]@2 x x");
    const spans4 = [1, 2, 3, 4].map((spanId) => ({
      spanId,
      spanLen: 4,
      subdivision: 4,
    }));

    const beats = resolveDumkaCells(quintuplets, 3, [
      { spanId: 1, spanLen: 60, subdivision: 20 },
    ]);
    expect(beats).toEqual({
      ok: false,
      message: "pattern spans 4 beats but the cycle has 3",
    });

    const subdivision = resolveDumkaCells(quintuplets, 4, spans4);
    expect(subdivision).toEqual({
      ok: false,
      message: "pattern needs Subdivision 5 (or a multiple); the section has 4",
    });

    const nonUniform = resolveDumkaCells(quintuplets, 4, [
      { spanId: 1, spanLen: 30, subdivision: 10 },
      { spanId: 2, spanLen: 20, subdivision: 5 },
    ]);
    expect(nonUniform).toEqual({
      ok: false,
      message:
        "spans carry 50 steps over 4 beats; a uniform per-beat Subdivision is required",
    });
  });

  it("projects a 5:2 tuplet through per-beat Subdivision 5 spans", () => {
    const result = resolveDumkaCells(compiled("[x x x x x]@2"), 2, [
      { spanId: 1, spanLen: 5, subdivision: 5 },
      { spanId: 2, spanLen: 5, subdivision: 5 },
    ]);
    if (!result.ok) throw new Error(result.message);

    expect(result.spans).toEqual([
      {
        spanId: 1,
        spanLen: 5,
        cells: [
          { index: 0, start: 0, len: 2, rest: false, tiedFromPrevious: false, tiedToNext: false },
          { index: 1, start: 2, len: 2, rest: false, tiedFromPrevious: false, tiedToNext: false },
          { index: 2, start: 4, len: 1, rest: false, tiedFromPrevious: false, tiedToNext: true },
        ],
      },
      {
        spanId: 2,
        spanLen: 5,
        cells: [
          { index: 0, start: 0, len: 1, rest: false, tiedFromPrevious: true, tiedToNext: false },
          { index: 1, start: 1, len: 2, rest: false, tiedFromPrevious: false, tiedToNext: false },
          { index: 2, start: 3, len: 2, rest: false, tiedFromPrevious: false, tiedToNext: false },
        ],
      },
    ]);
  });

  it("emits paired tied chains across every crossed span", () => {
    const result = resolveDumkaCells(compiled("x _ _ ."), 4, [1, 2, 3, 4].map(
      (spanId) => ({ spanId, spanLen: 1, subdivision: 1 })
    ));
    if (!result.ok) throw new Error(result.message);

    const cells = result.spans.flatMap((span) => span.cells);
    expect(cells).toEqual([
      { index: 0, start: 0, len: 1, rest: false, tiedFromPrevious: false, tiedToNext: true },
      { index: 0, start: 0, len: 1, rest: false, tiedFromPrevious: true, tiedToNext: true },
      { index: 0, start: 0, len: 1, rest: false, tiedFromPrevious: true, tiedToNext: false },
      { index: 0, start: 0, len: 1, rest: true, tiedFromPrevious: false, tiedToNext: false },
    ]);

    expect(cells[0]!.tiedFromPrevious).toBe(false);
    expect(cells.at(-1)!.tiedToNext).toBe(false);
    for (let index = 0; index < cells.length - 1; index += 1) {
      expect(cells[index]!.tiedToNext).toBe(cells[index + 1]!.tiedFromPrevious);
      if (cells[index]!.tiedToNext) {
        expect(cells[index]!.rest).toBe(false);
        expect(cells[index + 1]!.rest).toBe(false);
      }
    }
  });

  it("accepts coarser multiples like the engine", () => {
    const seed = compiled("x . x .");
    const result = resolveDumkaCells(seed, 4, [
      { spanId: 1, spanLen: 16, subdivision: 4 },
    ]);
    if (!result.ok) throw new Error(result.message);
    expect(result.spans[0]!.cells).toHaveLength(4);
    expect(result.spans[0]!.cells.every((cell) => cell.len === 4)).toBe(true);
  });

  it("uses exact subdivision metadata instead of averaging Grouping spans", () => {
    const grouped = [3, 3, 3, 3, 4, 4, 4].map((spanLen, index) => ({
      spanId: index + 1,
      spanLen,
      subdivision: 4,
    }));
    expect(resolveDumkaCells(compiled(". . . . . ."), 6, grouped).ok).toBe(true);

    const switched = [
      ...[3, 3, 3, 3].map((spanLen, index) => ({
        spanId: index + 1,
        spanLen,
        subdivision: 4,
      })),
      ...[6, 6, 6].map((spanLen, index) => ({
        spanId: index + 5,
        spanLen,
        subdivision: 6,
      })),
    ];
    const averaged = compiled("[x . . . .] . [x . . . .] . [x . . . .] .");
    expect(resolveDumkaCells(averaged, 6, switched)).toEqual({
      ok: false,
      message:
        "spans carry 30 steps over 6 beats; a uniform per-beat Subdivision is required",
    });

    expect(
      resolveDumkaCells(compiled(". . . . . ."), 6, [
        { spanId: 1, spanLen: 24, subdivision: null },
      ])
    ).toEqual({
      ok: false,
      message:
        "spans carry 24 steps over 6 beats; a uniform per-beat Subdivision is required",
    });

    expect(
      resolveDumkaCells(compiled(". . . . . ."), 6, [
        { spanId: 1, spanLen: 0, subdivision: 4 },
        { spanId: 2, spanLen: 24, subdivision: 4 },
      ]).ok
    ).toBe(false);

    expect(
      resolveDumkaCells(compiled(". ."), 2, [
        { spanId: 1, spanLen: 0xffffffff, subdivision: 1 },
        { spanId: 2, spanLen: 0xffffffff, subdivision: 1 },
      ])
    ).toEqual({
      ok: false,
      message:
        "spans carry 8589934590 steps over 2 beats; a uniform per-beat Subdivision is required",
    });
  });
});
