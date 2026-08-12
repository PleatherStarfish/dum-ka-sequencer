/**
 * Guardrail 3 (docs/TEST_COVERAGE_PLAN_2026-07.md Phase 4.2): any LARGE
 * component module must have a colocated `<name>.test.tsx`. The model-module
 * guardrail (modelCoverage.test.ts) only watches top-level `src/*.ts`, which
 * left `components/*.tsx` free to accrete untested logic — the shaper-state
 * hooks reached 5.6k combined lines with zero tests and ranked #3/#8 on the
 * fault-risk tool before this closed the hole.
 *
 * The size threshold (not every component) keeps the rule aimed at where
 * logic actually accumulates; small presentational components stay covered by
 * the e2e suite. `KNOWN_UNTESTED` is the shrink-only debt register seeded
 * with the pre-existing violators on 2026-07-07 — adding an entry is not
 * allowed; a NEW large component (or one that grows past the threshold)
 * ships with a test. Prefer extracting pure logic into a `src/*.ts` module
 * (see TESTING.md "Extracting from App.tsx" — the same norm applies to
 * hooks/panels) over testing a monolith in place.
 */
import { describe, expect, it } from "vitest";

const LINE_THRESHOLD = 400;

const sources = import.meta.glob("./components/*.tsx", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const KNOWN_UNTESTED = new Set<string>([
  "ChannelShaperPanel.tsx",
  "PitchNotation.tsx",
  "SeedControls.tsx",
  "useChannelShaperState.tsx",
]);

const names = Object.keys(sources).map((path) =>
  path.replace(/^\.\/components\//, "")
);

const lineCount = (path: string) => (sources[path] ?? "").split("\n").length;

describe("large-component test coverage guardrail", () => {
  const components = names.filter((file) => !file.endsWith(".test.tsx"));
  const tests = new Set(names.filter((file) => file.endsWith(".test.tsx")));
  const hasTest = (file: string) =>
    tests.has(`${file.slice(0, -".tsx".length)}.test.tsx`);
  const large = components.filter(
    (file) => lineCount(`./components/${file}`) >= LINE_THRESHOLD
  );

  it("finds large components to scan", () => {
    expect(large.length).toBeGreaterThan(5);
  });

  it("every large component has a colocated test (or is in the 2026-07 debt register)", () => {
    const missing = large.filter(
      (file) => !hasTest(file) && !KNOWN_UNTESTED.has(file)
    );
    expect(
      missing,
      `≥${LINE_THRESHOLD}-line components need a colocated <name>.test.tsx ` +
        `(or extract the logic into a tested src/*.ts module): ${missing.join(", ")}`
    ).toEqual([]);
  });

  it("KNOWN_UNTESTED only shrinks — drop entries once they are tested", () => {
    const nowTested = [...KNOWN_UNTESTED].filter((file) => hasTest(file));
    expect(
      nowTested,
      `Now tested — delete from KNOWN_UNTESTED: ${nowTested.join(", ")}`
    ).toEqual([]);
  });

  it("KNOWN_UNTESTED entries still exist and are still large", () => {
    const stale = [...KNOWN_UNTESTED].filter(
      (file) =>
        !components.includes(file) ||
        lineCount(`./components/${file}`) < LINE_THRESHOLD
    );
    expect(
      stale,
      `No longer large components — delete from KNOWN_UNTESTED: ${stale.join(", ")}`
    ).toEqual([]);
  });
});
