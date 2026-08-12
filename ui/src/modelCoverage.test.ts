/**
 * Guardrail 2: every top-level `src/*.ts` model module must have a colocated
 * `<name>.test.ts`. New pure logic ships with a fast unit test or this fails —
 * the mechanism that keeps the "logic trapped in components" gap closed once
 * Phase 1 opened it. See docs/COMPONENT_LOGIC_EXTRACTION_PLAN.md.
 *
 * `KNOWN_UNTESTED` is a shrink-only escape hatch for pre-existing gaps. It is
 * empty now that Phase 0 is complete; adding an entry is not allowed — a fresh
 * module without a test should fail the first check.
 */
import { describe, expect, it } from "vitest";

// Enumerated at build time by Vite (no filesystem access). Non-recursive `./*.ts`
// matches the convention of model modules living directly in src/.
const names = Object.keys(import.meta.glob("./*.ts")).map((path) =>
  path.replace(/^\.\//, "")
);

const KNOWN_UNTESTED = new Set<string>([]);

describe("model module test coverage guardrail", () => {
  const modules = names.filter(
    (file) =>
      !file.endsWith(".test.ts") &&
      !file.endsWith(".bench.ts") &&
      !file.endsWith(".d.ts")
  );
  const tests = new Set(names.filter((file) => file.endsWith(".test.ts")));
  const hasTest = (mod: string) =>
    tests.has(`${mod.slice(0, -".ts".length)}.test.ts`);

  it("finds the model modules to scan", () => {
    expect(modules.length).toBeGreaterThan(10);
  });

  it("every model module has a colocated test (or is in the Phase 0 backlog)", () => {
    const missing = modules.filter(
      (mod) => !hasTest(mod) && !KNOWN_UNTESTED.has(mod)
    );
    expect(
      missing,
      `Add a colocated <name>.test.ts for: ${missing.join(", ")}`
    ).toEqual([]);
  });

  it("KNOWN_UNTESTED only shrinks — drop entries once they are tested", () => {
    const nowTested = [...KNOWN_UNTESTED].filter((mod) => hasTest(mod));
    expect(
      nowTested,
      `Now tested — delete from KNOWN_UNTESTED: ${nowTested.join(", ")}`
    ).toEqual([]);

    const stale = [...KNOWN_UNTESTED].filter((mod) => !modules.includes(mod));
    expect(
      stale,
      `No longer exist — delete from KNOWN_UNTESTED: ${stale.join(", ")}`
    ).toEqual([]);
  });
});
