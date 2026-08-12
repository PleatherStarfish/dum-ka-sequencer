import { useMemo, useState } from "react";
import {
  articulateGroup,
  builderFromPattern,
  canArticulateGroup,
  classifySelection,
  fillEuclid,
  groupRatio,
  groupSelection,
  insertSibling,
  isValidDumkaStroke,
  patternHasRewritableSugar,
  removeSelection,
  setGroupCount,
  setLeafKind,
  setStroke,
  setWeight,
  siblingRange,
  splitIntoTuplet,
  tryCommitBuilder,
  ungroupNode,
  BUILDER_MAX_TUPLET_COUNT,
  type BuilderLeafKind,
  type BuilderNode,
  type BuilderOpResult,
  type BuilderProjectionSpan,
} from "../dumkaRhythmBuilder";
import { DUMKA_MAX_EUCLID_SLOTS, DUMKA_MAX_WEIGHT } from "../dumkaPattern";
import { NumericField } from "../NumericField";

const STROKE_SUGGESTIONS = ["dum", "ka", "x", "ta", "na", "tin"];

/** Committed-on-blur stroke name field (parser-validated, else reverts). */
function StrokeField({
  value,
  disabled,
  onCommit,
}: {
  value: string;
  disabled: boolean;
  onCommit: (stroke: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft !== null && draft !== value && isValidDumkaStroke(draft)) {
      onCommit(draft);
    }
    setDraft(null);
  };
  return (
    <input
      aria-label="Stroke name"
      className="rb-stroke-input"
      list="dumka-stroke-suggestions"
      spellCheck={false}
      value={draft ?? value}
      disabled={disabled}
      onChange={(event) => setDraft(event.currentTarget.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          commit();
        }
        if (event.key === "Escape") setDraft(null);
      }}
    />
  );
}

function leafGlyph(node: BuilderNode): string {
  if (node.kind === "rest") return "·";
  if (node.kind === "hold") return "‿";
  return node.stroke;
}

function BlockRow({
  nodes,
  disabled,
  selectedIds,
  onPick,
}: {
  nodes: BuilderNode[];
  disabled: boolean;
  selectedIds: ReadonlySet<number>;
  onPick: (id: number, extend: boolean) => void;
}) {
  return (
    <div className="rb-row">
      {nodes.map((node) => {
        if (node.kind === "group") {
          const ratio = groupRatio(node);
          const badge =
            ratio.count === node.weight
              ? `@${node.weight}`
              : `${ratio.count}:${node.weight}`;
          const name = `group ${node.id}: ${ratio.count} in the time of ${node.weight}`;
          return (
            <div
              key={node.id}
              className={`rb-group${selectedIds.has(node.id) ? " is-selected" : ""}`}
              style={{ flexGrow: node.weight, flexBasis: 0 }}
            >
              <button
                type="button"
                className="rb-group-handle"
                disabled={disabled}
                aria-pressed={selectedIds.has(node.id)}
                aria-label={name}
                title={name}
                onClick={(event) => onPick(node.id, event.shiftKey)}
              >
                <span className="rb-group-badge">{badge}</span>
              </button>
              <BlockRow
                nodes={node.children}
                disabled={disabled}
                selectedIds={selectedIds}
                onPick={onPick}
              />
            </div>
          );
        }
        const label =
          node.kind === "note"
            ? `note ${node.stroke}`
            : node.kind;
        const name = `block ${node.id}: ${label}${
          node.weight > 1 ? ` over ${node.weight}` : ""
        }`;
        return (
          <button
            key={node.id}
            type="button"
            className={`rb-cell rb-cell-${node.kind}${
              selectedIds.has(node.id) ? " is-selected" : ""
            }`}
            style={{ flexGrow: node.weight, flexBasis: 0 }}
            disabled={disabled}
            aria-pressed={selectedIds.has(node.id)}
            aria-label={name}
            title={name}
            onClick={(event) => onPick(node.id, event.shiftKey)}
          >
            <b>{leafGlyph(node)}</b>
            {node.weight > 1 ? <i>@{node.weight}</i> : null}
            {node.kind === "note" ? (
              <span className="rb-cell-dot" aria-hidden="true">
                •
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Visual editor over the Dum-Ka notation: a proportional block tree with a
 * selection toolbar. Every edit prints the tree back to pattern text and
 * commits it through the caller (the same path as typing in the textarea);
 * illegal results are rejected with the mirrored compiler's message and the
 * pattern is left untouched. See dumkaRhythmBuilder.ts for the model.
 */
export function RhythmBuilder({
  pattern,
  disabled,
  projectionSpans = [],
  onCommit,
}: {
  pattern: string;
  disabled: boolean;
  previewError?: string | null;
  projectionSpans?: readonly BuilderProjectionSpan[];
  onCommit: (pattern: string) => void;
}) {
  const [selected, setSelected] = useState<number[]>([]);
  const [anchor, setAnchor] = useState<number | null>(null);
  const [splitCount, setSplitCount] = useState(3);
  const [euclidOnsets, setEuclidOnsets] = useState(3);
  const [euclidSlots, setEuclidSlots] = useState(8);
  const [opError, setOpError] = useState<string | null>(null);

  const built = useMemo(() => builderFromPattern(pattern), [pattern]);
  if (!built.ok) {
    return (
      <div className="rhythm-builder" role="group" aria-label="Rhythm builder">
        <p className="rb-hint">
          Fix the pattern text below to edit it visually.
        </p>
      </div>
    );
  }
  const nodes = built.nodes;
  const idSet = new Set<number>();
  const collect = (list: BuilderNode[]) => {
    for (const node of list) {
      idSet.add(node.id);
      collect(node.children);
    }
  };
  collect(nodes);
  const selection = selected.filter((id) => idSet.has(id));
  const info = classifySelection(nodes, selection);
  const totalBeats = nodes.reduce((sum, node) => sum + node.weight, 0);

  const pick = (id: number, extend: boolean) => {
    setOpError(null);
    if (extend && anchor !== null) {
      const range = siblingRange(nodes, anchor, id);
      if (range) {
        setSelected(range);
        return;
      }
    }
    setAnchor(id);
    setSelected((current) =>
      current.length === 1 && current[0] === id ? [] : [id]
    );
  };

  const apply = (result: BuilderOpResult) => {
    if (!result.ok) {
      setOpError(result.message);
      return;
    }
    const commit = tryCommitBuilder(result.nodes);
    if (!commit.ok) {
      setOpError(commit.message);
      return;
    }
    onCommit(commit.pattern);
    setSelected([result.focusId]);
    setAnchor(result.focusId);
    setOpError(null);
  };

  const single = info.kind === "single" ? info.node : null;
  const leaf = single && single.kind !== "group" ? single : null;
  const group = single && single.kind === "group" ? single : null;
  const articulatableGroup =
    group && canArticulateGroup(nodes, group.id, projectionSpans) ? group : null;
  const run = info.kind === "run";
  const anySelection = single !== null || run;
  return (
    <div className="rhythm-builder" role="group" aria-label="Rhythm builder">
      <div className="rb-canvas">
        <div className="rb-ruler" aria-hidden="true">
          {Array.from({ length: totalBeats }, (_, beat) => (
            <span key={beat}>{beat + 1}</span>
          ))}
        </div>
        <BlockRow
          nodes={nodes}
          disabled={disabled}
          selectedIds={new Set(selection)}
          onPick={pick}
        />
      </div>

      <div className="rb-toolbar" role="toolbar" aria-label="Rhythm builder tools">
        {leaf ? (
          <>
            <span className="rb-tool-cluster" aria-label="Element type">
              {(["note", "rest", "hold"] as BuilderLeafKind[]).map((kind) => (
                <button
                  key={kind}
                  type="button"
                  className={leaf.kind === kind ? "is-active" : ""}
                  disabled={disabled}
                  aria-pressed={leaf.kind === kind}
                  aria-label={`Set element to ${kind}`}
                  onClick={() => apply(setLeafKind(nodes, leaf.id, kind))}
                >
                  {kind}
                </button>
              ))}
            </span>
            {leaf.kind === "note" ? (
              <StrokeField
                value={leaf.stroke}
                disabled={disabled}
                onCommit={(stroke) => apply(setStroke(nodes, leaf.id, stroke))}
              />
            ) : null}
          </>
        ) : null}

        {single ? (
          <label className="rb-tool-field">
            <span>{group ? "span" : "weight"}</span>
            <NumericField
              aria-label="Element weight"
              min={1}
              max={DUMKA_MAX_WEIGHT}
              value={single.weight}
              disabled={disabled}
              onValueCommit={(value) =>
                apply(setWeight(nodes, single.id, Math.round(value)))
              }
            />
          </label>
        ) : null}

        {group ? (
          <>
            <label className="rb-tool-field">
              <span>count</span>
              <NumericField
                aria-label="Group count"
                min={1}
                max={BUILDER_MAX_TUPLET_COUNT}
                value={group.children.length}
                disabled={disabled}
                onValueCommit={(value) =>
                  apply(setGroupCount(nodes, group.id, Math.round(value)))
                }
              />
            </label>
            <button
              type="button"
              disabled={disabled}
              onClick={() => apply(ungroupNode(nodes, group.id))}
            >
              Ungroup
            </button>
            {articulatableGroup ? (
              <button
                type="button"
                disabled={disabled}
                title="Detach this group's sustained notes at current Subdivision or Grouping spans"
                onClick={() =>
                  apply(
                    articulateGroup(
                      nodes,
                      articulatableGroup.id,
                      projectionSpans
                    )
                  )
                }
              >
                Articulate
              </button>
            ) : null}
          </>
        ) : null}

        {leaf ? (
          <span className="rb-tool-cluster" aria-label="Split into tuplet">
            <label className="rb-tool-field">
              <span>split</span>
              <NumericField
                aria-label="Split count"
                min={2}
                max={BUILDER_MAX_TUPLET_COUNT}
                value={splitCount}
                disabled={disabled}
                onValueCommit={(value) =>
                  setSplitCount(Math.max(2, Math.round(value)))
                }
              />
            </label>
            <button
              type="button"
              disabled={disabled}
              aria-label="Split into tuplet"
              onClick={() => apply(splitIntoTuplet(nodes, leaf.id, splitCount))}
            >
              Split
            </button>
          </span>
        ) : null}

        {leaf ? (
          <span className="rb-tool-cluster" aria-label="Euclidean fill E(k,n)">
            <label className="rb-tool-field">
              <span>k</span>
              <NumericField
                aria-label="Euclid onsets"
                min={0}
                max={DUMKA_MAX_EUCLID_SLOTS}
                value={euclidOnsets}
                disabled={disabled}
                onValueCommit={(value) =>
                  setEuclidOnsets(Math.max(0, Math.round(value)))
                }
              />
            </label>
            <label className="rb-tool-field">
              <span>n</span>
              <NumericField
                aria-label="Euclid slots"
                min={1}
                max={DUMKA_MAX_EUCLID_SLOTS}
                value={euclidSlots}
                disabled={disabled}
                onValueCommit={(value) =>
                  setEuclidSlots(Math.max(1, Math.round(value)))
                }
              />
            </label>
            <button
              type="button"
              disabled={disabled}
              aria-label="Fill with Euclidean rhythm"
              onClick={() =>
                apply(fillEuclid(nodes, leaf.id, euclidOnsets, euclidSlots, 0))
              }
            >
              E-fill
            </button>
          </span>
        ) : null}

        {anySelection ? (
          <>
            <button
              type="button"
              disabled={disabled}
              aria-label="Group selection"
              onClick={() => apply(groupSelection(nodes, selection))}
            >
              Group
            </button>
            <button
              type="button"
              disabled={disabled || !single}
              aria-label="Insert before"
              onClick={() => single && apply(insertSibling(nodes, single.id, "before"))}
            >
              + before
            </button>
            <button
              type="button"
              disabled={disabled || !single}
              aria-label="Insert after"
              onClick={() => single && apply(insertSibling(nodes, single.id, "after"))}
            >
              + after
            </button>
            <button
              type="button"
              disabled={disabled}
              aria-label="Delete selection"
              onClick={() => apply(removeSelection(nodes, selection))}
            >
              Delete
            </button>
          </>
        ) : (
          <span className="rb-hint">
            Select a block to edit it — shift-click extends along siblings.
          </span>
        )}
        <datalist id="dumka-stroke-suggestions">
          {STROKE_SUGGESTIONS.map((stroke) => (
            <option key={stroke} value={stroke} />
          ))}
        </datalist>
      </div>

      {opError ? (
        <p className="rb-op-error" role="alert">
          {opError}
        </p>
      ) : null}
      {patternHasRewritableSugar(pattern) ? (
        <p className="rb-hint">
          Visual edits rewrite E(...), *n repeats, comments, and bar lines in
          expanded form.
        </p>
      ) : null}
    </div>
  );
}
