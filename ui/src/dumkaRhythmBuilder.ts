/**
 * Pure model for the visual rhythm builder: an id-tagged view of the
 * pattern's sugar-expanded node tree plus the tree operations the GUI
 * offers (type changes, weights, grouping, tuplet splits).
 *
 * The builder never bypasses the notation. Every operation edits the tree,
 * prints it back to pattern text, and the caller commits that text through
 * the same path as typing — so persistence, preview, playback, and the
 * cross-language parser contract are untouched. Legality is enforced by
 * re-analyzing the printed result with the mirrored compiler
 * (`analyzeDumkaPattern`), so the GUI cannot author a pattern the engine
 * would reject differently; ops only pre-check what they need for a good
 * message. Printing is always the expanded form: `E(...)`/`*n` sugar,
 * comments, and bar separators are rewritten by the first visual edit
 * (`patternHasRewritableSugar` lets the GUI warn before that happens).
 *
 * Ids are DFS pre-order positions. Printing and re-parsing a builder tree
 * preserves its structure node-for-node, so the ids assigned by
 * `builderFromPattern` after a commit equal the ids `reindex` assigned to
 * the op result — which is what lets the GUI keep a stable selection
 * across its own edits.
 */
import {
  analyzeDumkaPattern,
  compileDumkaPattern,
  dumkaEuclid,
  parseDumkaPatternNodes,
  DUMKA_MAX_EUCLID_SLOTS,
  DUMKA_MAX_WEIGHT,
  type DumkaIssue,
  type DumkaPatternNode,
  type DumkaRequiredStructure,
} from "./dumkaPattern";

export type BuilderLeafKind = "note" | "rest" | "hold";

export interface BuilderNode {
  id: number;
  kind: BuilderLeafKind | "group";
  /** Stroke class; meaningful only when kind === "note". */
  stroke: string;
  weight: number;
  /** Children; non-empty only when kind === "group". */
  children: BuilderNode[];
}

export type BuilderOpResult =
  | { ok: true; nodes: BuilderNode[]; focusId: number }
  | { ok: false; message: string };

/** UI cap for tuplet splits and group counts; deliberately small and
 * screen-sized — the analyzer still enforces every real platform cap. */
export const BUILDER_MAX_TUPLET_COUNT = 64;

const DEFAULT_STROKE = "x";

function fromParsed(node: DumkaPatternNode): BuilderNode {
  return {
    id: 0,
    kind: node.kind,
    stroke: node.kind === "note" ? node.stroke : "",
    weight: node.weight,
    children: node.kind === "group" ? node.children.map(fromParsed) : [],
  };
}

function reindex(nodes: BuilderNode[]): void {
  let next = 0;
  const walk = (list: BuilderNode[]): void => {
    for (const node of list) {
      node.id = next;
      next += 1;
      walk(node.children);
    }
  };
  walk(nodes);
}

function clone(nodes: BuilderNode[]): BuilderNode[] {
  return nodes.map((node) => ({ ...node, children: clone(node.children) }));
}

export function builderFromPattern(
  pattern: string
): { ok: true; nodes: BuilderNode[] } | { ok: false; issue: DumkaIssue } {
  const parsed = parseDumkaPatternNodes(pattern);
  if (!parsed.ok) return parsed;
  const nodes = parsed.nodes.map(fromParsed);
  reindex(nodes);
  return { ok: true, nodes };
}

function printNode(node: BuilderNode): string {
  const suffix = node.weight > 1 ? `@${node.weight}` : "";
  switch (node.kind) {
    case "note":
      return `${node.stroke}${suffix}`;
    case "rest":
      return `.${suffix}`;
    case "hold":
      return `_${suffix}`;
    case "group":
      return `[${node.children.map(printNode).join(" ")}]${suffix}`;
  }
}

export function printBuilderPattern(nodes: BuilderNode[]): string {
  return nodes.map(printNode).join(" ");
}

/**
 * Prints and re-analyzes an op result. The returned pattern is what the
 * caller commits; a not-ok result carries the mirrored compiler's message
 * (the same text the engine would use) and means "reject this edit".
 */
export function tryCommitBuilder(
  nodes: BuilderNode[]
):
  | { ok: true; pattern: string; required: DumkaRequiredStructure }
  | { ok: false; message: string } {
  const pattern = printBuilderPattern(nodes);
  const analysis = analyzeDumkaPattern(pattern);
  return analysis.ok
    ? { ok: true, pattern, required: analysis.required }
    : { ok: false, message: analysis.issue.message };
}

/** A stroke name is valid iff the parser reads it back as that one note. */
export function isValidDumkaStroke(name: string): boolean {
  const parsed = parseDumkaPatternNodes(name);
  if (!parsed.ok || parsed.nodes.length !== 1) return false;
  const only = parsed.nodes[0]!;
  return only.kind === "note" && only.stroke === name && only.weight === 1;
}

/** True when visual edits would rewrite sugar, comments, or bar lines. */
export function patternHasRewritableSugar(pattern: string): boolean {
  return /[#|]|\*\s*\d|E\s*\(/.test(pattern);
}

interface Located {
  parent: BuilderNode | null;
  siblings: BuilderNode[];
  index: number;
  node: BuilderNode;
}

function locate(nodes: BuilderNode[], id: number): Located | null {
  const walk = (siblings: BuilderNode[], parent: BuilderNode | null): Located | null => {
    for (let index = 0; index < siblings.length; index += 1) {
      const node = siblings[index]!;
      if (node.id === id) return { parent, siblings, index, node };
      const inner = walk(node.children, node);
      if (inner) return inner;
    }
    return null;
  };
  return walk(nodes, null);
}

export function findBuilderNode(nodes: BuilderNode[], id: number): BuilderNode | null {
  return locate(nodes, id)?.node ?? null;
}

export type BuilderSelection =
  | { kind: "none" }
  | { kind: "single"; node: BuilderNode }
  /** A contiguous run of ≥2 siblings under one parent (null = top level). */
  | { kind: "run"; nodes: BuilderNode[] }
  | { kind: "invalid" };

/** Classifies a selection; ids that are not a contiguous run of siblings
 * (in any order) are "invalid" and the toolbar disables structural ops. */
export function classifySelection(
  nodes: BuilderNode[],
  ids: number[]
): BuilderSelection {
  if (ids.length === 0) return { kind: "none" };
  const first = locate(nodes, ids[0]!);
  if (!first) return { kind: "invalid" };
  if (ids.length === 1) return { kind: "single", node: first.node };
  const indices: number[] = [];
  for (const id of ids) {
    const found = locate(nodes, id);
    if (!found || found.siblings !== first.siblings) return { kind: "invalid" };
    indices.push(found.index);
  }
  indices.sort((a, b) => a - b);
  for (let i = 1; i < indices.length; i += 1) {
    if (indices[i]! !== indices[i - 1]! + 1) return { kind: "invalid" };
  }
  return {
    kind: "run",
    nodes: indices.map((index) => first.siblings[index]!),
  };
}

/** The contiguous sibling run between two ids, for shift-click selection. */
export function siblingRange(
  nodes: BuilderNode[],
  anchorId: number,
  targetId: number
): number[] | null {
  const anchor = locate(nodes, anchorId);
  const target = locate(nodes, targetId);
  if (!anchor || !target || anchor.siblings !== target.siblings) return null;
  const lo = Math.min(anchor.index, target.index);
  const hi = Math.max(anchor.index, target.index);
  return anchor.siblings.slice(lo, hi + 1).map((node) => node.id);
}

/** `children:group-weight` ratio for the tuplet badge, e.g. 5:2. */
export function groupRatio(node: BuilderNode): { count: number; span: number } {
  return { count: node.children.length, span: node.weight };
}

interface BuilderFraction {
  num: bigint;
  den: bigint;
}

interface BuilderNodeGeometry {
  node: BuilderNode;
  start: BuilderFraction;
  span: BuilderFraction;
}

/** The exact generator projection recipe currently displayed by the app.
 * Span lengths and Subdivision are the same values sent to preview/playback. */
export interface BuilderProjectionSpan {
  spanLen: number;
  subdivision: number | null;
}

interface ArticulationContext {
  subdivision: bigint;
  spanEnds: bigint[];
  geometries: Map<number, BuilderNodeGeometry>;
}

interface ArticulationPlan {
  cellsByChildId: Map<number, number>;
}

function bigintGcd(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) {
    const remainder = x % y;
    x = y;
    y = remainder;
  }
  return x;
}

function builderFraction(num: bigint, den: bigint): BuilderFraction {
  const divisor = bigintGcd(num, den);
  return { num: num / divisor, den: den / divisor };
}

function addBuilderFractions(
  left: BuilderFraction,
  right: BuilderFraction
): BuilderFraction {
  return builderFraction(
    left.num * right.den + right.num * left.den,
    left.den * right.den
  );
}

function scaleBuilderFraction(
  value: BuilderFraction,
  numerator: number,
  denominator = 1
): BuilderFraction {
  return builderFraction(
    value.num * BigInt(numerator),
    value.den * BigInt(denominator)
  );
}

/** Exact start/span geometry for every builder node, plus the current
 * generator fences. Top-level weights are beats; nested sibling weights
 * divide their parent's exact span. Invalid or stale layouts fail closed. */
function buildArticulationContext(
  nodes: BuilderNode[],
  projectionSpans: readonly BuilderProjectionSpan[]
): ArticulationContext | null {
  const analysis = analyzeDumkaPattern(printBuilderPattern(nodes));
  if (!analysis.ok) return null;

  const totalBeats = nodes.reduce((sum, node) => sum + node.weight, 0);
  const subdivision = projectionSpans[0]?.subdivision;
  if (
    typeof subdivision !== "number" ||
    !Number.isSafeInteger(subdivision) ||
    subdivision <= 0 ||
    subdivision % analysis.required.subdivision !== 0 ||
    projectionSpans.length === 0 ||
    projectionSpans.some(
      (span) =>
        !Number.isSafeInteger(span.spanLen) ||
        span.spanLen <= 0 ||
        span.subdivision !== subdivision
    )
  ) {
    return null;
  }

  const subdivisionTicks = BigInt(subdivision);
  const expectedTicks = BigInt(totalBeats) * subdivisionTicks;
  const spanEnds: bigint[] = [];
  let spanEnd = 0n;
  for (const span of projectionSpans) {
    spanEnd += BigInt(span.spanLen);
    spanEnds.push(spanEnd);
  }
  if (spanEnd !== expectedTicks) return null;

  const geometries = new Map<number, BuilderNodeGeometry>();
  const walk = (
    siblings: BuilderNode[],
    start: BuilderFraction,
    span: BuilderFraction
  ): void => {
    const weightSum = siblings.reduce((sum, node) => sum + node.weight, 0);
    let cursor = start;
    for (const node of siblings) {
      const nodeSpan = scaleBuilderFraction(span, node.weight, weightSum);
      geometries.set(node.id, { node, start: cursor, span: nodeSpan });
      if (node.kind === "group") {
        walk(node.children, cursor, nodeSpan);
      }
      cursor = addBuilderFractions(cursor, nodeSpan);
    }
  };
  walk(nodes, builderFraction(0n, 1n), builderFraction(BigInt(totalBeats), 1n));
  return { subdivision: subdivisionTicks, spanEnds, geometries };
}

function fractionAsGridTicks(
  value: BuilderFraction,
  subdivision: bigint
): bigint | null {
  const scaled = value.num * subdivision;
  return scaled % value.den === 0n ? scaled / value.den : null;
}

function publicFractionAsGridTicks(
  value: { num: number; den: number },
  subdivision: bigint
): bigint | null {
  return fractionAsGridTicks(
    { num: BigInt(value.num), den: BigInt(value.den) },
    subdivision
  );
}

function smallestArticulationCellCount(
  durationTicks: bigint,
  ticksToSpanEnd: bigint
): number | null {
  for (let cells = 2n; cells <= durationTicks; cells += 1n) {
    if (
      durationTicks % cells === 0n &&
      durationTicks / cells <= ticksToSpanEnd
    ) {
      return Number(cells);
    }
  }
  return null;
}

/** Plan detachment for a flat note/rest group at any nesting depth or beat
 * offset. Equal-duration tuplets keep one uniform articulation across their
 * note children; weighted tuplets refine only notes that cross a current span. */
function articulationPlan(
  context: ArticulationContext,
  id: number
): ArticulationPlan | null {
  const geometry = context.geometries.get(id);
  if (
    !geometry ||
    geometry.node.kind !== "group" ||
    geometry.node.children.length === 0 ||
    !geometry.node.children.every(
      (child) => child.kind === "note" || child.kind === "rest"
    ) ||
    !geometry.node.children.some((child) => child.kind === "note")
  ) {
    return null;
  }

  const notes = geometry.node.children.filter(
    (child): child is BuilderNode & { kind: "note" } => child.kind === "note"
  );
  const firstWeight = geometry.node.children[0]!.weight;
  const allEqualWeight = geometry.node.children.every(
    (child) => child.weight === firstWeight
  );
  if (allEqualWeight) {
    const count = geometry.node.children.length;
    const slotSpan = scaleBuilderFraction(geometry.span, 1, count);
    const slotTicks = fractionAsGridTicks(slotSpan, context.subdivision);
    if (slotTicks === null || slotTicks <= 0n) return null;

    let minTicksToSpanEnd: bigint | null = null;
    for (const note of notes) {
      const noteGeometry = context.geometries.get(note.id);
      if (!noteGeometry) return null;
      const onsetTicks = fractionAsGridTicks(
        noteGeometry.start,
        context.subdivision
      );
      if (onsetTicks === null) return null;
      const nextSpanEnd = context.spanEnds.find((end) => end > onsetTicks);
      if (nextSpanEnd === undefined) return null;
      const ticksToSpanEnd = nextSpanEnd - onsetTicks;
      minTicksToSpanEnd =
        minTicksToSpanEnd === null || ticksToSpanEnd < minTicksToSpanEnd
          ? ticksToSpanEnd
          : minTicksToSpanEnd;
    }

    if (minTicksToSpanEnd === null || slotTicks <= minTicksToSpanEnd) {
      return null;
    }
    const cells = smallestArticulationCellCount(
      slotTicks,
      minTicksToSpanEnd
    );
    return cells === null
      ? null
      : {
          cellsByChildId: new Map(notes.map((note) => [note.id, cells])),
        };
  }

  const cellsByChildId = new Map<number, number>();
  for (const note of notes) {
    const noteGeometry = context.geometries.get(note.id);
    if (!noteGeometry) return null;
    const onsetTicks = fractionAsGridTicks(
      noteGeometry.start,
      context.subdivision
    );
    const durationTicks = fractionAsGridTicks(
      noteGeometry.span,
      context.subdivision
    );
    if (onsetTicks === null || durationTicks === null || durationTicks <= 0n) {
      return null;
    }
    const nextSpanEnd = context.spanEnds.find((end) => end > onsetTicks);
    if (nextSpanEnd === undefined) return null;
    const ticksToSpanEnd = nextSpanEnd - onsetTicks;
    if (durationTicks <= ticksToSpanEnd) continue;
    const cells = smallestArticulationCellCount(
      durationTicks,
      ticksToSpanEnd
    );
    if (cells === null) return null;
    cellsByChildId.set(note.id, cells);
  }
  return cellsByChildId.size > 0 ? { cellsByChildId } : null;
}

/** Whether a selected flat note/rest group can use the spanning-tuplet escape
 * on the current preview layout, including nested/off-beat groups. */
export function canArticulateGroup(
  nodes: BuilderNode[],
  id: number,
  projectionSpans: readonly BuilderProjectionSpan[]
): boolean {
  const context = buildArticulationContext(nodes, projectionSpans);
  if (context === null) return false;
  const plan = articulationPlan(context, id);
  return (
    plan !== null &&
    articulatedCandidate(nodes, id, plan, context.subdivision) !== null
  );
}

function groupDirectNoteCrossesBoundary(
  context: ArticulationContext,
  id: number,
  boundaryTicks: bigint
): boolean {
  const geometry = context.geometries.get(id);
  if (!geometry || geometry.node.kind !== "group") return false;
  return geometry.node.children.some((child) => {
    if (child.kind !== "note") return false;
    const childGeometry = context.geometries.get(child.id);
    if (!childGeometry) return false;
    const startTicks = fractionAsGridTicks(
      childGeometry.start,
      context.subdivision
    );
    const durationTicks = fractionAsGridTicks(
      childGeometry.span,
      context.subdivision
    );
    return (
      startTicks !== null &&
      durationTicks !== null &&
      startTicks < boundaryTicks &&
      startTicks + durationTicks > boundaryTicks
    );
  });
}

function preflightedArticulatableGroupIds(
  nodes: BuilderNode[],
  context: ArticulationContext,
  boundaryTicks: bigint | null = null
): number[] {
  const ids: number[] = [];
  for (const id of context.geometries.keys()) {
    if (
      boundaryTicks !== null &&
      !groupDirectNoteCrossesBoundary(context, id, boundaryTicks)
    ) {
      continue;
    }
    const plan = articulationPlan(context, id);
    if (
      plan !== null &&
      articulatedCandidate(nodes, id, plan, context.subdivision) !== null
    ) {
      ids.push(id);
    }
  }
  return ids;
}

/** Ordered DFS ids of every group whose exact current-layout articulation
 * candidate survives the same compiler and grid preflight as the toolbar op. */
export function articulatableGroupIds(
  nodes: BuilderNode[],
  projectionSpans: readonly BuilderProjectionSpan[]
): number[] {
  const context = buildArticulationContext(nodes, projectionSpans);
  if (context === null) return [];
  return preflightedArticulatableGroupIds(nodes, context);
}

/** Reproduce the resolver's first sounding event that crosses the exact current
 * span layout. This is deliberately derived from ticks instead of the Rust
 * diagnostic's `beat` number, which truncates fractional Grouping fences. */
function firstCrossedSpanEnd(
  nodes: BuilderNode[],
  context: ArticulationContext
): bigint | null {
  const compiled = compileDumkaPattern(printBuilderPattern(nodes));
  if (!compiled.ok) return null;
  for (const event of compiled.compiled.events) {
    const startTicks = publicFractionAsGridTicks(
      event.start,
      context.subdivision
    );
    const durationTicks = publicFractionAsGridTicks(
      event.dur,
      context.subdivision
    );
    if (startTicks === null || durationTicks === null) return null;
    const spanEnd = context.spanEnds.find((end) => end > startTicks);
    if (spanEnd === undefined) return null;
    if (startTicks + durationTicks > spanEnd) return spanEnd;
  }
  return null;
}

/** Ordered, fully preflighted articulation candidates that cross the same exact
 * span end as the resolver's current first boundary error. An unrelated later
 * tuplet is therefore never offered as a direct repair for an earlier sustain. */
export function articulatableGroupIdsForBoundaryError(
  nodes: BuilderNode[],
  projectionSpans: readonly BuilderProjectionSpan[]
): number[] {
  const context = buildArticulationContext(nodes, projectionSpans);
  if (context === null) return [];
  const boundaryTicks = firstCrossedSpanEnd(nodes, context);
  return boundaryTicks === null
    ? []
    : preflightedArticulatableGroupIds(nodes, context, boundaryTicks);
}

/** Whether any group crosses a fence in the current preview layout. */
export function hasArticulatableGroup(
  nodes: BuilderNode[],
  projectionSpans: readonly BuilderProjectionSpan[]
): boolean {
  return articulatableGroupIds(nodes, projectionSpans).length > 0;
}

/** True when the backend's current projection error is the cross-span fence
 * that Articulate can help resolve. Match the stable diagnostic clause so an
 * invoke wrapper prefix or a different beat number cannot hide the hint. */
export function isDumkaSpanBoundaryError(message: string | null | undefined): boolean {
  return message?.includes("a note sustains across the span boundary") ?? false;
}

function finish(nodes: BuilderNode[], focus: BuilderNode): BuilderOpResult {
  reindex(nodes);
  return { ok: true, nodes, focusId: focus.id };
}

export function setLeafKind(
  nodes: BuilderNode[],
  id: number,
  kind: BuilderLeafKind
): BuilderOpResult {
  const next = clone(nodes);
  const found = locate(next, id);
  if (!found || found.node.kind === "group") {
    return { ok: false, message: "select a note, rest, or hold" };
  }
  found.node.kind = kind;
  found.node.stroke =
    kind === "note" ? found.node.stroke || DEFAULT_STROKE : "";
  return finish(next, found.node);
}

export function setStroke(
  nodes: BuilderNode[],
  id: number,
  stroke: string
): BuilderOpResult {
  const next = clone(nodes);
  const found = locate(next, id);
  if (!found || found.node.kind !== "note") {
    return { ok: false, message: "select a note to name its stroke" };
  }
  if (!isValidDumkaStroke(stroke)) {
    return { ok: false, message: `"${stroke}" is not a valid stroke name` };
  }
  found.node.stroke = stroke;
  return finish(next, found.node);
}

export function setWeight(
  nodes: BuilderNode[],
  id: number,
  weight: number
): BuilderOpResult {
  if (!Number.isInteger(weight) || weight < 1 || weight > DUMKA_MAX_WEIGHT) {
    return { ok: false, message: `weight must be 1-${DUMKA_MAX_WEIGHT}` };
  }
  const next = clone(nodes);
  const found = locate(next, id);
  if (!found) return { ok: false, message: "select an element" };
  found.node.weight = weight;
  return finish(next, found.node);
}

export function insertSibling(
  nodes: BuilderNode[],
  id: number,
  side: "before" | "after"
): BuilderOpResult {
  const next = clone(nodes);
  const found = locate(next, id);
  if (!found) return { ok: false, message: "select an element" };
  const inserted: BuilderNode = {
    id: 0,
    kind: "note",
    stroke: DEFAULT_STROKE,
    weight: 1,
    children: [],
  };
  found.siblings.splice(found.index + (side === "after" ? 1 : 0), 0, inserted);
  return finish(next, inserted);
}

export function removeSelection(
  nodes: BuilderNode[],
  ids: number[]
): BuilderOpResult {
  const next = clone(nodes);
  const selection = classifySelection(next, ids);
  if (selection.kind !== "single" && selection.kind !== "run") {
    return { ok: false, message: "select one element or a run of neighbors" };
  }
  const run = selection.kind === "single" ? [selection.node] : selection.nodes;
  const found = locate(next, run[0]!.id)!;
  if (found.siblings.length === run.length) {
    return {
      ok: false,
      message:
        found.parent === null
          ? "the pattern needs at least one element"
          : "a group cannot be left empty; ungroup or delete the group instead",
    };
  }
  found.siblings.splice(found.index, run.length);
  const focus =
    found.siblings[Math.min(found.index, found.siblings.length - 1)] ??
    found.parent ??
    next[0]!;
  return finish(next, focus);
}

/** Wraps a contiguous run in a group whose weight is the run's weight sum,
 * so the wrap itself never changes timing (adjust the weight to tupletize). */
export function groupSelection(
  nodes: BuilderNode[],
  ids: number[]
): BuilderOpResult {
  const next = clone(nodes);
  const selection = classifySelection(next, ids);
  if (selection.kind !== "single" && selection.kind !== "run") {
    return { ok: false, message: "select one element or a run of neighbors" };
  }
  const run = selection.kind === "single" ? [selection.node] : selection.nodes;
  const weight = run.reduce((sum, node) => sum + node.weight, 0);
  if (weight > DUMKA_MAX_WEIGHT) {
    return { ok: false, message: `group weight would exceed ${DUMKA_MAX_WEIGHT}` };
  }
  const found = locate(next, run[0]!.id)!;
  const group: BuilderNode = {
    id: 0,
    kind: "group",
    stroke: "",
    weight,
    children: run,
  };
  found.siblings.splice(found.index, run.length, group);
  return finish(next, group);
}

export function ungroupNode(nodes: BuilderNode[], id: number): BuilderOpResult {
  const next = clone(nodes);
  const found = locate(next, id);
  if (!found || found.node.kind !== "group") {
    return { ok: false, message: "select a group to ungroup" };
  }
  found.siblings.splice(found.index, 1, ...found.node.children);
  return finish(next, found.node.children[0] ?? next[0]!);
}

/** Replaces a leaf with a group of `count` equal strokes over the leaf's
 * span: the direct "k in the time of w" gesture (weight stays the leaf's). */
export function splitIntoTuplet(
  nodes: BuilderNode[],
  id: number,
  count: number
): BuilderOpResult {
  if (!Number.isInteger(count) || count < 2 || count > BUILDER_MAX_TUPLET_COUNT) {
    return { ok: false, message: `split count must be 2-${BUILDER_MAX_TUPLET_COUNT}` };
  }
  const next = clone(nodes);
  const found = locate(next, id);
  if (!found || found.node.kind === "group") {
    return { ok: false, message: "select a note, rest, or hold to split" };
  }
  const group: BuilderNode = {
    id: 0,
    kind: "group",
    stroke: "",
    weight: found.node.weight,
    children: Array.from({ length: count }, () => ({
      id: 0,
      kind: "note" as const,
      stroke: DEFAULT_STROKE,
      weight: 1,
      children: [],
    })),
  };
  found.siblings.splice(found.index, 1, group);
  return finish(next, group);
}

function restNodesForWeight(weight: number): BuilderNode[] {
  const nodes: BuilderNode[] = [];
  let remaining = weight;
  while (remaining > 0) {
    const chunk = Math.min(DUMKA_MAX_WEIGHT, remaining);
    nodes.push({
      id: 0,
      kind: "rest",
      stroke: "",
      weight: chunk,
      children: [],
    });
    remaining -= chunk;
  }
  return nodes;
}

/** Builds and compiler-preflights the exact tree the toolbar would commit.
 * This keeps the action hidden at the DSL's depth/node/text limits. */
function articulatedCandidate(
  nodes: BuilderNode[],
  id: number,
  plan: ArticulationPlan,
  subdivision: bigint
): BuilderNode[] | null {
  const next = clone(nodes);
  const found = locate(next, id);
  if (!found || found.node.kind !== "group") return null;

  for (const childId of plan.cellsByChildId.keys()) {
    const child = found.node.children.find((candidate) => candidate.id === childId);
    if (!child || child.kind !== "note") return null;
  }

  found.node.children = found.node.children.map((child) => {
    const cells = plan.cellsByChildId.get(child.id);
    if (cells === undefined || child.kind !== "note") return child;
    return {
      id: 0,
      kind: "group",
      stroke: "",
      weight: child.weight,
      children: [
        {
          id: 0,
          kind: "note",
          stroke: child.stroke,
          weight: 1,
          children: [],
        },
        ...restNodesForWeight(cells - 1),
      ],
    };
  });
  reindex(next);

  const commit = tryCommitBuilder(next);
  if (
    !commit.ok ||
    subdivision % BigInt(commit.required.subdivision) !== 0n
  ) {
    return null;
  }
  return next;
}

/** Detaches notes in an eligible flat k:w group without changing onsets,
 * rests, outer weight, or strokes. Exact current span geometry chooses the
 * smallest safe division and the compiler preflights the rewritten tree. */
export function articulateGroup(
  nodes: BuilderNode[],
  id: number,
  projectionSpans: readonly BuilderProjectionSpan[]
): BuilderOpResult {
  const context = buildArticulationContext(nodes, projectionSpans);
  if (context === null) {
    return {
      ok: false,
      message: "select a flat tuplet with a note crossing a playback span",
    };
  }
  const plan = articulationPlan(context, id);
  if (plan === null) {
    return {
      ok: false,
      message: "select a flat tuplet with a note crossing a playback span",
    };
  }

  const next = articulatedCandidate(nodes, id, plan, context.subdivision);
  if (next === null) {
    return {
      ok: false,
      message: "this tuplet cannot be articulated within the pattern limits",
    };
  }
  return { ok: true, nodes: next, focusId: id };
}

/** Replaces a leaf with the Bjorklund necklace E(onsets,slots,rotation)
 * over the leaf's span — the same expansion as the `E(...)` notation sugar
 * (dumkaEuclid is the one shared implementation). */
export function fillEuclid(
  nodes: BuilderNode[],
  id: number,
  onsets: number,
  slots: number,
  rotation: number
): BuilderOpResult {
  if (
    !Number.isInteger(slots) ||
    slots < 1 ||
    slots > DUMKA_MAX_EUCLID_SLOTS ||
    !Number.isInteger(onsets) ||
    onsets < 0 ||
    !Number.isInteger(rotation) ||
    rotation < 0
  ) {
    return { ok: false, message: `E(k,n) needs 1-${DUMKA_MAX_EUCLID_SLOTS} slots` };
  }
  if (onsets > slots) {
    return { ok: false, message: `E(${onsets},${slots}) has more onsets than slots` };
  }
  const next = clone(nodes);
  const found = locate(next, id);
  if (!found || found.node.kind === "group") {
    return { ok: false, message: "select a note, rest, or hold to fill" };
  }
  const group: BuilderNode = {
    id: 0,
    kind: "group",
    stroke: "",
    weight: found.node.weight,
    children: dumkaEuclid(onsets, slots, rotation).map((sounds) => ({
      id: 0,
      kind: sounds ? ("note" as const) : ("rest" as const),
      stroke: sounds ? DEFAULT_STROKE : "",
      weight: 1,
      children: [],
    })),
  };
  found.siblings.splice(found.index, 1, group);
  return finish(next, group);
}

/** Grows or trims a group to `count` children (append `x` notes; trim from
 * the end), so count + weight edit any group into any k:w tuplet. */
export function setGroupCount(
  nodes: BuilderNode[],
  id: number,
  count: number
): BuilderOpResult {
  if (!Number.isInteger(count) || count < 1 || count > BUILDER_MAX_TUPLET_COUNT) {
    return { ok: false, message: `count must be 1-${BUILDER_MAX_TUPLET_COUNT}` };
  }
  const next = clone(nodes);
  const found = locate(next, id);
  if (!found || found.node.kind !== "group") {
    return { ok: false, message: "select a group to resize" };
  }
  const children = found.node.children;
  while (children.length > count) children.pop();
  while (children.length < count) {
    children.push({
      id: 0,
      kind: "note",
      stroke: DEFAULT_STROKE,
      weight: 1,
      children: [],
    });
  }
  return finish(next, found.node);
}
