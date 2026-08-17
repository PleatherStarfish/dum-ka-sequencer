/**
 * Dum-Ka pattern constants shared by persistence, the editor, and mocks.
 *
 * The pattern text is authored freely and persisted verbatim; parsing and
 * canonicalization are the Rust engine's job (`crates/cseq-rhythm/src/
 * generators/dumka`). The values here mirror the engine's serde default and
 * length cap code-point-for-code-point so the two sides cannot drift silently.
 *
 * The notation is rhythm-only: any bare identifier still parses as an onset
 * for backward compatibility, but its label is discarded — `x` is the
 * canonical spelling and the canonical printer emits `x` for every note.
 */

/** Mirrors `DEFAULT_DUMKA_PATTERN` in crates/cseq-rhythm (serde default). */
export const DEFAULT_DUMKA_PATTERN = "[x . . x] [. . x .] [x . x .] [x x . x]";

/** Mirrors `MAX_PATTERN_LEN` in the engine's notation parser. */
export const MAX_DUMKA_PATTERN_LENGTH = 4096;

function codePointLength(value: string): number {
  // Count without materializing an array proportional to an untrusted patch
  // string. The lexer only allocates its code-point array after this cap has
  // passed, so a rejected oversized pattern cannot amplify memory usage.
  let length = 0;
  for (const _codePoint of value) length += 1;
  return length;
}

/**
 * Guard a persisted pattern value: any non-empty string within the length
 * cap round-trips verbatim (no trimming, no rewriting); anything else falls
 * back to the default pattern. Validation of the CONTENT stays in Rust.
 */
export function normalizeDumkaPattern(value: unknown): string {
  if (typeof value !== "string") return DEFAULT_DUMKA_PATTERN;
  const length = codePointLength(value);
  return length > 0 && length <= MAX_DUMKA_PATTERN_LENGTH
    ? value
    : DEFAULT_DUMKA_PATTERN;
}

// ---------------------------------------------------------------------------
// TypeScript mirror of the engine's notation parser/compiler/projector.
//
// The Rust modules in crates/cseq-rhythm/src/generators/dumka are the truth;
// this mirror exists so the editor can show required structure and local
// diagnostics without a preview round trip, and so the mock Tauri driver can
// resolve previews bit-exactly. Every diagnostic message and cell vector is
// pinned against the Rust tests — if the grammar changes on one side only,
// the parity tests fail.
// ---------------------------------------------------------------------------

/** Mirrors the engine parser caps. */
export const DUMKA_MAX_WEIGHT = 512;
export const DUMKA_MAX_REPEAT = 64;
export const DUMKA_MAX_DEPTH = 16;
export const DUMKA_MAX_NODES = 4096;
export const DUMKA_MAX_EUCLID_SLOTS = 64;
export const DUMKA_MAX_TOTAL_BEATS = 128;
export const DUMKA_MAX_SUBDIVISION = 64;

export interface DumkaIssue {
  line: number;
  col: number;
  message: string;
}

/** An exact fraction in beats: value = num / den, den > 0, reduced. */
export type Frac = { num: number; den: number };

export interface DumkaEvent {
  start: Frac;
  dur: Frac;
}

export interface DumkaCompiled {
  totalBeats: number;
  requiredSubdivision: number;
  events: DumkaEvent[];
}

export interface DumkaCell {
  index: number;
  start: number;
  len: number;
  rest: boolean;
  tiedFromPrevious: boolean;
  tiedToNext: boolean;
}

export interface DumkaCellSpan {
  spanId: number;
  spanLen: number;
  cells: DumkaCell[];
}

/** Per-family operator weights, mirroring the engine's OpWeights. */
export interface DumkaOpWeights {
  barlowRemove: number;
  barlowAdd: number;
  rotate: number;
  syncopate: number;
  desyncopate: number;
  fragment: number;
  consolidate: number;
  euclid: number;
}

/** Engine defaults: the historical 3/3/2 draw; displacement opt-in at 0. */
export const DEFAULT_DUMKA_OP_WEIGHTS: DumkaOpWeights = {
  barlowRemove: 3,
  barlowAdd: 3,
  rotate: 2,
  syncopate: 0,
  desyncopate: 0,
  fragment: 0,
  consolidate: 0,
  euclid: 0,
};

export interface DumkaRequiredStructure {
  cycleBeats: number;
  /** Minimal grid required by the seed notation itself. */
  subdivision: number;
  /** Fold grid after applying the optional subdivision palette. */
  workingSubdivision: number;
}

export const DUMKA_SUBDIVISION_LEVELS = [2, 3, 5, 7] as const;
export type DumkaSubdivisionLevel = (typeof DUMKA_SUBDIVISION_LEVELS)[number];

/** Tolerant UI/persistence normalization for the authored depth palette. */
export function normalizeDumkaSubdivisionPalette(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(
    value.filter(
      (entry): entry is DumkaSubdivisionLevel =>
        typeof entry === "number" &&
        Number.isInteger(entry) &&
        DUMKA_SUBDIVISION_LEVELS.includes(entry as DumkaSubdivisionLevel)
    )
  )]
    .sort((left, right) => left - right)
    .slice(0, 2);
}

export function workingDumkaSubdivision(
  subdivision: number,
  palette: readonly number[] = []
): number {
  return normalizeDumkaSubdivisionPalette(palette).reduce(
    (working, level) => working * level,
    subdivision
  );
}

export type DumkaPatternAnalysis =
  | { ok: true; required: DumkaRequiredStructure }
  | { ok: false; issue: DumkaIssue };

export type DumkaBeatSlotAnalysis =
  | {
      ok: true;
      /** Minimal compiler-visible slot requirement for each physical beat. */
      slotsPerBeat: number[];
      required: DumkaRequiredStructure;
    }
  | { ok: false; issue: DumkaIssue };

/** Editor-facing view of a pattern: its required structure or first issue. */
export function analyzeDumkaPattern(
  pattern: string,
  subdivisionPalette: readonly number[] = []
): DumkaPatternAnalysis {
  const result = compileDumkaPattern(pattern);
  return result.ok
    ? {
        ok: true,
        required: {
          cycleBeats: result.compiled.totalBeats,
          subdivision: result.compiled.requiredSubdivision,
          workingSubdivision: workingDumkaSubdivision(
            result.compiled.requiredSubdivision,
            subdivisionPalette
          ),
        },
      }
    : { ok: false, issue: result.issue };
}

export interface AuthoredStructureSnapshot {
  cycleBeats: number;
  initialWeights: Array<{ subdivision: number; weight: number }>;
  initialJathiWeights: Array<{ jathi: number; weight: number }>;
  boundaryCount: number;
  hasCustomSubdivision: boolean;
}

/**
 * Whether the authored structure already realizes the pattern: one section
 * (no boundaries, no custom division, no Grouping) of the pattern's beat
 * count whose single fixed Subdivision is a multiple of the requirement.
 * An authored Grouping is deliberately treated as "not ready": it changes
 * the span layout, and the per-beat recipe is what Apply structure writes.
 */
export function dumkaStructureMatches(
  required: DumkaRequiredStructure,
  authored: AuthoredStructureSnapshot
): boolean {
  if (authored.cycleBeats !== required.cycleBeats) return false;
  if (authored.boundaryCount !== 0 || authored.hasCustomSubdivision) return false;
  if (authored.initialJathiWeights.length !== 0) return false;
  if (authored.initialWeights.length !== 1) return false;
  const only = authored.initialWeights[0]!;
  return (
    only.weight > 0 &&
    only.subdivision % required.workingSubdivision === 0
  );
}

/** Formats a parse issue exactly like the engine's GeneratorError Display. */
export function formatDumkaParseError(issue: DumkaIssue): string {
  return `dumka pattern parse error at line ${issue.line}, column ${issue.col}: ${issue.message}`;
}

/** Formats a structure issue exactly like the engine's GeneratorError Display. */
export function formatDumkaStructureError(message: string): string {
  return `dumka structure mismatch: ${message}`;
}

type NodeKind =
  | { t: "onset" }
  | { t: "rest" }
  | { t: "hold" }
  | { t: "group"; children: PatternNode[] };

interface PatternNode {
  kind: NodeKind;
  weight: number;
  line: number;
  col: number;
}

interface Tok {
  k:
    | "lbracket"
    | "rbracket"
    | "lparen"
    | "rparen"
    | "comma"
    | "dot"
    | "underscore"
    | "at"
    | "star"
    | "ident"
    | "int";
  text: string;
  value: number;
  line: number;
  col: number;
}

class DumkaParseFailure extends Error {
  issue: DumkaIssue;
  constructor(issue: DumkaIssue) {
    super(issue.message);
    this.issue = issue;
  }
}

function fail(line: number, col: number, message: string): never {
  throw new DumkaParseFailure({ line, col, message });
}

/** Mirrors Rust `char::is_whitespace` for Unicode scalar values. */
function isPatternWhitespace(c: string): boolean {
  const value = c.codePointAt(0)!;
  return (
    (value >= 0x0009 && value <= 0x000d) ||
    value === 0x0020 ||
    value === 0x0085 ||
    value === 0x00a0 ||
    value === 0x1680 ||
    (value >= 0x2000 && value <= 0x200a) ||
    value === 0x2028 ||
    value === 0x2029 ||
    value === 0x202f ||
    value === 0x205f ||
    value === 0x3000
  );
}

function lex(text: string): Tok[] {
  const patternLength = codePointLength(text);
  if (patternLength > MAX_DUMKA_PATTERN_LENGTH) {
    fail(
      1,
      1,
      `pattern is ${patternLength} characters; the maximum is ${MAX_DUMKA_PATTERN_LENGTH}`
    );
  }
  const chars = Array.from(text);
  const tokens: Tok[] = [];
  let line = 1;
  let col = 1;
  let i = 0;
  const isDigit = (c: string) => c >= "0" && c <= "9";
  const isAlpha = (c: string) => /[A-Za-z]/.test(c);
  while (i < chars.length) {
    const c = chars[i]!;
    const at = { line, col };
    if (c === "\n") {
      i += 1;
      line += 1;
      col = 1;
    } else if (isPatternWhitespace(c)) {
      i += 1;
      col += 1;
    } else if (c === "#") {
      while (i < chars.length && chars[i] !== "\n") {
        i += 1;
        col += 1;
      }
    } else if (c === "|") {
      i += 1;
      col += 1;
    } else if ("[](),._@*".includes(c)) {
      i += 1;
      col += 1;
      const k =
        c === "["
          ? "lbracket"
          : c === "]"
            ? "rbracket"
            : c === "("
              ? "lparen"
              : c === ")"
                ? "rparen"
                : c === ","
                  ? "comma"
                  : c === "."
                    ? "dot"
                    : c === "_"
                      ? "underscore"
                      : c === "@"
                        ? "at"
                        : "star";
      tokens.push({ k, text: c, value: 0, ...at });
    } else if (isDigit(c)) {
      let value = 0;
      while (i < chars.length && isDigit(chars[i]!)) {
        value = value * 10 + (chars[i]!.charCodeAt(0) - 48);
        if (value > 0xffffffff) {
          fail(at.line, at.col, "number is too large");
        }
        i += 1;
        col += 1;
      }
      tokens.push({ k: "int", text: "", value, ...at });
    } else if (isAlpha(c)) {
      let ident = "";
      while (i < chars.length && /[A-Za-z0-9]/.test(chars[i]!)) {
        ident += chars[i];
        i += 1;
        col += 1;
      }
      tokens.push({ k: "ident", text: ident, value: 0, ...at });
    } else {
      fail(at.line, at.col, `unexpected character '${c}'`);
    }
  }
  return tokens;
}

function bjorklund(onsets: number, slots: number): boolean[] {
  if (slots === 0) return [];
  if (onsets === 0) return Array<boolean>(slots).fill(false);
  if (onsets === slots) return Array<boolean>(slots).fill(true);
  let front: boolean[][] = Array.from({ length: onsets }, () => [true]);
  let back: boolean[][] = Array.from({ length: slots - onsets }, () => [false]);
  while (back.length > 1) {
    const pairs = Math.min(front.length, back.length);
    const paired: boolean[][] = [];
    for (let p = 0; p < pairs; p += 1) {
      paired.push([...front.shift()!, ...back.shift()!]);
    }
    const leftover = [...front, ...back];
    front = paired;
    back = leftover;
  }
  return [...front, ...back].flat();
}

export function dumkaEuclid(onsets: number, slots: number, rotation: number): boolean[] {
  const pattern = bjorklund(onsets, slots);
  if (pattern.length === 0) return pattern;
  const by = rotation % pattern.length;
  return [...pattern.slice(by), ...pattern.slice(0, by)];
}

interface ParserState {
  tokens: Tok[];
  index: number;
  nodeCount: number;
  endLine: number;
  endCol: number;
}

function here(state: ParserState): { line: number; col: number } {
  const token = state.tokens[state.index];
  return token
    ? { line: token.line, col: token.col }
    : { line: state.endLine, col: state.endCol };
}

function expectInt(state: ParserState, what: string): Tok {
  const token = state.tokens[state.index];
  if (token && token.k === "int") {
    state.index += 1;
    return token;
  }
  const at = here(state);
  fail(at.line, at.col, `expected ${what}`);
}

function expectKind(state: ParserState, k: Tok["k"], what: string): Tok {
  const token = state.tokens[state.index];
  if (token && token.k === k) {
    state.index += 1;
    return token;
  }
  const at = here(state);
  fail(at.line, at.col, `expected ${what}`);
}

function nodeSize(node: PatternNode): number {
  return node.kind.t === "group"
    ? 1 + node.kind.children.reduce((sum, child) => sum + nodeSize(child), 0)
    : 1;
}

function countNodes(state: ParserState, added: number, line: number, col: number) {
  state.nodeCount += added;
  if (state.nodeCount > DUMKA_MAX_NODES) {
    fail(line, col, `pattern expands to more than ${DUMKA_MAX_NODES} nodes`);
  }
}

function parseSiblings(state: ParserState, depth: number, inGroup: boolean): PatternNode[] {
  const nodes: PatternNode[] = [];
  for (;;) {
    const token = state.tokens[state.index];
    if (!token) {
      if (inGroup) fail(state.endLine, state.endCol, "unclosed '['");
      return nodes;
    }
    if (token.k === "rbracket") {
      if (inGroup) {
        state.index += 1;
        return nodes;
      }
      fail(token.line, token.col, "']' without a matching '['");
    }
    nodes.push(...parseNode(state, depth));
  }
}

function parseEuclid(state: ParserState, line: number, col: number): NodeKind {
  expectKind(state, "lparen", "'(' after E");
  const onsets = expectInt(state, "an onset count in E(k,n)");
  expectKind(state, "comma", "',' in E(k,n)");
  const slots = expectInt(state, "a slot count in E(k,n)");
  let rotation = 0;
  if (state.tokens[state.index]?.k === "comma") {
    state.index += 1;
    rotation = expectInt(state, "a rotation in E(k,n,r)").value;
  }
  expectKind(state, "rparen", "')' to close E(...)");
  if (slots.value === 0 || slots.value > DUMKA_MAX_EUCLID_SLOTS) {
    fail(slots.line, slots.col, `E(...) slots must be 1-${DUMKA_MAX_EUCLID_SLOTS}`);
  }
  if (onsets.value > slots.value) {
    fail(line, col, `E(${onsets.value},${slots.value}) has more onsets than slots`);
  }
  countNodes(state, slots.value, line, col);
  const children = dumkaEuclid(onsets.value, slots.value, rotation).map<PatternNode>(
    (sounds) => ({
      kind: sounds ? { t: "onset" } : { t: "rest" },
      weight: 1,
      line,
      col,
    })
  );
  return { t: "group", children };
}

function parseNode(state: ParserState, depth: number): PatternNode[] {
  const token = state.tokens[state.index]!;
  state.index += 1;
  const { line, col } = token;
  let kind: NodeKind;
  switch (token.k) {
    case "lbracket": {
      if (depth + 1 > DUMKA_MAX_DEPTH) {
        fail(line, col, `groups nest deeper than ${DUMKA_MAX_DEPTH} levels`);
      }
      const children = parseSiblings(state, depth + 1, true);
      if (children.length === 0) fail(line, col, "empty group '[]'");
      kind = { t: "group", children };
      break;
    }
    case "dot":
      kind = { t: "rest" };
      break;
    case "underscore":
      kind = { t: "hold" };
      break;
    case "ident": {
      const isEuclid = token.text === "E" && state.tokens[state.index]?.k === "lparen";
      if (isEuclid) {
        kind = parseEuclid(state, line, col);
      } else if (state.tokens[state.index]?.k === "lparen") {
        const at = here(state);
        fail(at.line, at.col, "'(' is only valid after E, as in E(3,8)");
      } else {
        // Rhythm-only: the identifier text is deliberately discarded — any
        // name (historical `dum`/`ka` included) is just an onset.
        kind = { t: "onset" };
      }
      break;
    }
    case "at":
      fail(line, col, "'@' must follow a note, rest, or group");
      break;
    case "star":
      fail(line, col, "'*' must follow a note, rest, or group");
      break;
    case "int":
      fail(line, col, "a number is only valid after '@', '*', or inside E(...)");
      break;
    default:
      fail(line, col, "'(' is only valid after E, as in E(3,8)");
  }

  const node: PatternNode = { kind, weight: 1, line, col };
  let repeat = 1;
  let sawWeight = false;
  let sawRepeat = false;
  for (;;) {
    const suffix = state.tokens[state.index];
    if (suffix?.k === "at") {
      state.index += 1;
      if (sawWeight) fail(suffix.line, suffix.col, "duplicate '@' weight");
      sawWeight = true;
      const value = expectInt(state, "a weight after '@'");
      if (value.value === 0 || value.value > DUMKA_MAX_WEIGHT) {
        fail(value.line, value.col, `weight must be 1-${DUMKA_MAX_WEIGHT}`);
      }
      node.weight = value.value;
    } else if (suffix?.k === "star") {
      state.index += 1;
      if (sawRepeat) fail(suffix.line, suffix.col, "duplicate '*' repeat");
      sawRepeat = true;
      const value = expectInt(state, "a count after '*'");
      if (value.value === 0 || value.value > DUMKA_MAX_REPEAT) {
        fail(value.line, value.col, `repeat must be 1-${DUMKA_MAX_REPEAT}`);
      }
      repeat = value.value;
    } else {
      break;
    }
  }
  // Children (including Euclidean sugar) were counted while parsing this
  // node. Charge this node once, then each complete repeated subtree.
  countNodes(state, 1 + nodeSize(node) * (repeat - 1), line, col);
  return Array.from({ length: repeat }, () => node);
}

const EXACT_RATIONAL_LIMIT_MESSAGE =
  "pattern's proportional nesting exceeds the exact-rational limit; simplify the tuplet here";

type ExactFrac = { num: bigint; den: bigint };

function exactGcd(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) {
    const t = x % y;
    x = y;
    y = t;
  }
  return x;
}

function exactFrac(num: bigint, den: bigint, line: number, col: number): ExactFrac {
  if (den <= 0n) fail(line, col, EXACT_RATIONAL_LIMIT_MESSAGE);
  const divisor = exactGcd(num, den);
  const reducedNum = num / divisor;
  const reducedDen = den / divisor;
  if (reducedNum < 0n) {
    fail(line, col, EXACT_RATIONAL_LIMIT_MESSAGE);
  }
  return { num: reducedNum, den: reducedDen };
}

function exactAdd(
  a: ExactFrac,
  b: ExactFrac,
  line: number,
  col: number
): ExactFrac {
  return exactFrac(a.num * b.den + b.num * a.den, a.den * b.den, line, col);
}

function exactMulInt(a: ExactFrac, n: number, line: number, col: number): ExactFrac {
  return exactFrac(a.num * BigInt(n), a.den, line, col);
}

function exactDivInt(a: ExactFrac, n: number, line: number, col: number): ExactFrac {
  return exactFrac(a.num, a.den * BigInt(n), line, col);
}

function publicFrac(value: ExactFrac, line: number, col: number): Frac {
  const num = Number(value.num);
  const den = Number(value.den);
  if (!Number.isSafeInteger(num) || !Number.isSafeInteger(den)) {
    fail(line, col, EXACT_RATIONAL_LIMIT_MESSAGE);
  }
  return { num, den };
}

type InternalDumkaCompileResult =
  | { ok: true; compiled: DumkaCompiled; slotsPerBeat: number[] }
  | { ok: false; issue: DumkaIssue };

function compileDumkaPatternInternal(
  text: string
): InternalDumkaCompileResult {
  try {
    const tokens = lex(text);
    let endLine = 1;
    let endCol = 1;
    for (const ch of text) {
      if (ch === "\n") {
        endLine += 1;
        endCol = 1;
      } else {
        endCol += 1;
      }
    }
    const state: ParserState = { tokens, index: 0, nodeCount: 0, endLine, endCol };
    const nodes = parseSiblings(state, 0, false);
    if (nodes.length === 0) {
      fail(1, 1, "empty pattern; write at least one note, e.g. x . x .");
    }

    const totalBeats = nodes.reduce((sum, node) => sum + node.weight, 0);
    if (totalBeats > DUMKA_MAX_TOTAL_BEATS) {
      const first = nodes[0]!;
      fail(
        first.line,
        first.col,
        `pattern spans ${totalBeats} beats; the maximum is ${DUMKA_MAX_TOTAL_BEATS}`
      );
    }

    type Element = {
      start: ExactFrac;
      dur: ExactFrac;
      sounding: boolean;
      line: number;
      col: number;
    };
    const elements: Element[] = [];
    const walk = (list: PatternNode[], start: ExactFrac, span: ExactFrac): void => {
      const weightSum = list.reduce((sum, node) => sum + node.weight, 0);
      const first = list[0]!;
      const unit = exactDivInt(span, weightSum, first.line, first.col);
      let cursor = start;
      for (const node of list) {
        const dur = exactMulInt(unit, node.weight, node.line, node.col);
        switch (node.kind.t) {
          case "onset":
            elements.push({
              start: cursor,
              dur,
              sounding: true,
              line: node.line,
              col: node.col,
            });
            break;
          case "rest":
            elements.push({
              start: cursor,
              dur,
              sounding: false,
              line: node.line,
              col: node.col,
            });
            break;
          case "hold": {
            const last = elements[elements.length - 1];
            if (!last) {
              fail(
                node.line,
                node.col,
                "'_' has nothing to extend; start with a note or rest"
              );
            }
            last.dur = exactAdd(last.dur, dur, node.line, node.col);
            break;
          }
          case "group":
            walk(node.kind.children, cursor, dur);
            break;
        }
        cursor = exactAdd(cursor, dur, node.line, node.col);
      }
    };
    walk(nodes, exactFrac(0n, 1n, 1, 1), exactFrac(BigInt(totalBeats), 1n, 1, 1));

    // Every top-level weight is an integer beat count, so each exact element
    // start belongs unambiguously to one physical beat. Partitioning the same
    // reduced denominators used by the global requirement gives the minimal
    // local grid for each beat. Keep rests here: the public event projection
    // below intentionally drops them, but their starts are real grid
    // boundaries (for example `[. . . .]` needs four slots).
    let subdivision = 1n;
    const beatSubdivisions = Array<bigint>(totalBeats).fill(1n);
    for (const element of elements) {
      const denom = element.start.den;
      const next = (subdivision / exactGcd(subdivision, denom)) * denom;
      if (next > BigInt(DUMKA_MAX_SUBDIVISION)) {
        fail(
          element.line,
          element.col,
          `pattern needs a per-beat Subdivision of ${next}, above the maximum ${DUMKA_MAX_SUBDIVISION}; simplify the tuplet here`
        );
      }
      subdivision = next;

      const beatIndex = Number(element.start.num / element.start.den);
      if (beatIndex >= 0 && beatIndex < beatSubdivisions.length) {
        const local = beatSubdivisions[beatIndex]!;
        beatSubdivisions[beatIndex] = (local / exactGcd(local, denom)) * denom;
      }
    }

    return {
      ok: true,
      compiled: {
        totalBeats,
        requiredSubdivision: Number(subdivision),
        events: elements
          .filter((element) => element.sounding)
          .map((element) => ({
            start: publicFrac(element.start, element.line, element.col),
            dur: publicFrac(element.dur, element.line, element.col),
          })),
      },
      slotsPerBeat: beatSubdivisions.map(Number),
    };
  } catch (error) {
    if (error instanceof DumkaParseFailure) {
      return { ok: false, issue: error.issue };
    }
    throw error;
  }
}

export function compileDumkaPattern(
  text: string
): { ok: true; compiled: DumkaCompiled } | { ok: false; issue: DumkaIssue } {
  const result = compileDumkaPatternInternal(text);
  return result.ok
    ? { ok: true, compiled: result.compiled }
    : { ok: false, issue: result.issue };
}

/**
 * Minimal compiler-visible grid for each physical beat in a committed
 * pattern. Its LCM is exactly `required.subdivision`; unlike the public
 * sounding-event list, this analysis includes rest starts and applies holds
 * before deriving boundaries.
 */
export function deriveDumkaBeatSlotCounts(
  text: string,
  subdivisionPalette: readonly number[] = []
): DumkaBeatSlotAnalysis {
  const result = compileDumkaPatternInternal(text);
  return result.ok
    ? {
        ok: true,
        slotsPerBeat: result.slotsPerBeat,
        required: {
          cycleBeats: result.compiled.totalBeats,
          subdivision: result.compiled.requiredSubdivision,
          workingSubdivision: workingDumkaSubdivision(
            result.compiled.requiredSubdivision,
            subdivisionPalette
          ),
        },
      }
    : { ok: false, issue: result.issue };
}

/** Mirrors the engine's `resolve_seed_cells` including its exact messages. */
export function resolveDumkaCells(
  compiled: DumkaCompiled,
  cycleBeats: number,
  // `subdivision` is required to match the wire type (bridge.ts
  // GeneratorSpanInput): the per-span rate is the load-bearing metadata, and
  // an accidentally omitted field must be a compile error, not a plausible
  // "uniform per-beat Subdivision is required" runtime result.
  spans: Array<{ spanId: number; spanLen: number; subdivision: number | null }>
): { ok: true; spans: DumkaCellSpan[] } | { ok: false; message: string } {
  if (cycleBeats !== compiled.totalBeats) {
    return {
      ok: false,
      message: `pattern spans ${compiled.totalBeats} beats but the cycle has ${cycleBeats}`,
    };
  }
  const totalMatras = spans.reduce((sum, span) => sum + span.spanLen, 0);
  const actualSubdivision = spans[0]?.subdivision;
  const uniformSubdivision =
    Number.isInteger(actualSubdivision) &&
    actualSubdivision! > 0 &&
    spans.every((span) => span.spanLen > 0 && span.subdivision === actualSubdivision) &&
    totalMatras === cycleBeats * actualSubdivision!;
  if (
    cycleBeats === 0 ||
    totalMatras === 0 ||
    !uniformSubdivision
  ) {
    return {
      ok: false,
      message: `spans carry ${totalMatras} steps over ${cycleBeats} beats; a uniform per-beat Subdivision is required`,
    };
  }
  const subdivision = actualSubdivision!;
  if (subdivision % compiled.requiredSubdivision !== 0) {
    return {
      ok: false,
      message: `pattern needs Subdivision ${compiled.requiredSubdivision} (or a multiple); the section has ${subdivision}`,
    };
  }

  const intervals = compiled.events.map((event) => {
    const start = (event.start.num * subdivision) / event.start.den;
    const end =
      start + (event.dur.num * subdivision) / event.dur.den;
    return { start, end };
  });

  const out: DumkaCellSpan[] = [];
  let spanStart = 0;
  let eventIndex = 0;
  for (const span of spans) {
    const spanEnd = spanStart + span.spanLen;
    const cells: DumkaCell[] = [];
    let cursor = spanStart;
    const push = (
      to: number,
      rest: boolean,
      tiedFromPrevious = false,
      tiedToNext = false
    ) => {
      cells.push({
        index: cells.length,
        start: cursor - spanStart,
        len: to - cursor,
        rest,
        tiedFromPrevious,
        tiedToNext,
      });
      cursor = to;
    };
    while (cursor < spanEnd) {
      while (eventIndex < intervals.length && intervals[eventIndex]!.end <= cursor) {
        eventIndex += 1;
      }
      const next = intervals[eventIndex];
      if (next && next.start <= cursor && next.end > cursor) {
        const tiedFromPrevious = next.start < cursor;
        const tiedToNext = next.end > spanEnd;
        push(
          Math.min(next.end, spanEnd),
          false,
          tiedFromPrevious,
          tiedToNext
        );
        if (!tiedToNext) eventIndex += 1;
      } else if (next && next.start < spanEnd) {
        push(next.start, true);
      } else {
        push(spanEnd, true);
      }
    }
    out.push({ spanId: span.spanId, spanLen: span.spanLen, cells });
    spanStart = spanEnd;
  }
  return { ok: true, spans: out };
}

/**
 * Public, sugar-expanded view of the parse tree (`E(...)` becomes its
 * necklace group, `*n` becomes distinct siblings, comments and bars are
 * gone). This is the visual rhythm builder's read model; it reuses the one
 * lexer/parser above, so its caps and diagnostics cannot drift from the
 * compile path the parser contract fixture pins.
 */
export type DumkaPatternNode =
  | { kind: "note"; weight: number }
  | { kind: "rest"; weight: number }
  | { kind: "hold"; weight: number }
  | { kind: "group"; weight: number; children: DumkaPatternNode[] };

export function parseDumkaPatternNodes(
  text: string
): { ok: true; nodes: DumkaPatternNode[] } | { ok: false; issue: DumkaIssue } {
  try {
    const tokens = lex(text);
    let endLine = 1;
    let endCol = 1;
    for (const ch of text) {
      if (ch === "\n") {
        endLine += 1;
        endCol = 1;
      } else {
        endCol += 1;
      }
    }
    const state: ParserState = { tokens, index: 0, nodeCount: 0, endLine, endCol };
    const parsed = parseSiblings(state, 0, false);
    if (parsed.length === 0) {
      fail(1, 1, "empty pattern; write at least one note, e.g. x . x .");
    }
    // The map below deep-copies every node, which also un-shares the `*n`
    // repeat clones (parseNode returns the same object for each repetition).
    const convert = (node: PatternNode): DumkaPatternNode => {
      switch (node.kind.t) {
        case "onset":
          return { kind: "note", weight: node.weight };
        case "rest":
          return { kind: "rest", weight: node.weight };
        case "hold":
          return { kind: "hold", weight: node.weight };
        case "group":
          return {
            kind: "group",
            weight: node.weight,
            children: node.kind.children.map(convert),
          };
      }
    };
    return { ok: true, nodes: parsed.map(convert) };
  } catch (error) {
    if (error instanceof DumkaParseFailure) {
      return { ok: false, issue: error.issue };
    }
    throw error;
  }
}
