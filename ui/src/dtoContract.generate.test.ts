/**
 * TS-side generators for the cross-language DTO contract fixtures in
 * `src/__fixtures__/dto/` (see the `dto_fixtures` test module in
 * `src-tauri/src/main.rs` for the Rust half and the full scheme).
 *
 * These tests build the TS→Rust payloads through the *real* production code
 * paths — `bridge.ts` request assembly and `patchIo.ts` document builders —
 * and file-snapshot them. The Rust tests then deserialize/validate those
 * exact bytes, so a field renamed or retyped on either side fails a test
 * instead of failing at runtime.
 *
 * Regeneration: `pnpm vitest run -u src/dtoContract.generate.test.ts`
 * (CI compares; it never rewrites).
 */
import { describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn((...args: unknown[]): Promise<unknown> => {
  const [command] = args;
  // These generators assert only the outbound request. Production preview
  // wrappers also normalize the response, so return the smallest valid DTO
  // instead of the old `undefined` sentinel.
  if (command === "score_preview_subdivision_switch") {
    return Promise.resolve({
      cycle: 0,
      beats: [],
      pulseSpans: [],
      historySeeds: [],
    });
  }
  return Promise.resolve(undefined);
});

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: () => Promise.resolve(() => undefined),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  save: () => Promise.resolve(null),
  open: () => Promise.resolve(null),
  ask: () => Promise.resolve(false),
}));

import * as bridge from "./bridge";
import { createNeutralPatchDocument, normalizePatchGeneratorConfig } from "./patchIo";

const FIXTURE_SAVED_AT = "2026-06-11T12:00:00.000Z";

function stableJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

describe("DTO contract fixture generation (TS → Rust)", () => {
  it("subdivision switch request assembled by the real bridge", async () => {
    // Deliberately rich: forced gati 7, one certain mid-cycle boundary
    // (two 3-beat sections), and jathi 3 — which tiles each section's
    // 21 matras without duplicating gati beat starts — so the
    // Rust-generated preview fixture exercises sections, jathi pulse
    // spans, and boundary resolution.
    await bridge.scorePreviewSubdivisionSwitch(
      "dto-contract-fixture",
      6,
      [{ subdivision: 7, weight: 1 }],
      [{ jathi: 3, weight: 1 }],
      null,
      null,
      null,
      null,
      [
        {
          id: "boundary-after-3",
          position: 0.5,
          changeProbability: 1,
          subdivisionWeights: [{ subdivision: 7, weight: 1 }],
          jathiWeights: [{ jathi: 3, weight: 1 }],
          customSubdivision: null,
          jathiBhedam: null,
        },
      ],
      [
        { count: 0, weight: 0 },
        { count: 1, weight: 1 },
      ],
      "locked",
      20260611,
      [],
      1,
      1,
      8,
      15,
      50,
      16,
      false,
      {
        beatStart: { min: 4, max: 4 },
        sectionStartExtra: { min: 8, max: 8 },
        jathiStart: { min: 6, max: 6 },
        jathiMode: "overrideGati",
      },
      60,
      96,
      80,
      0
    );

    expect(invokeMock).toHaveBeenCalledTimes(1);
    const [command, payload] = invokeMock.mock.calls[0] as [
      string,
      { request: Record<string, unknown>; cycle: number },
    ];
    expect(command).toBe("score_preview_subdivision_switch");
    expect(payload.cycle).toBe(0);

    await expect(stableJson(payload.request)).toMatchFileSnapshot(
      "./__fixtures__/dto/subdivision_switch_request.json"
    );
  });


  it("patch document built by the real patchIo serializer", async () => {
    const document = createNeutralPatchDocument({
      savedAt: FIXTURE_SAVED_AT,
      seed: 20260611,
      scoreName: "dto-contract-fixture",
      cycleBeats: 4,
    });

    await expect(stableJson(document)).toMatchFileSnapshot(
      "./__fixtures__/dto/patch_document.json"
    );
  });

  it("dumka generator preview request assembled by the real bridge", async () => {
    invokeMock.mockClear();
    invokeMock.mockResolvedValueOnce({
      seed: { seed: "20260611", source: "locked", history: [] },
      spans: [],
    });
    // The articulated reference pattern: quintuplet ONSETS span beats three
    // and four, but each note is detached inside its slot, so nothing
    // sustains across a per-beat span boundary. It needs Subdivision 20 over
    // four beats; the spans are the matching per-beat layout so the Rust
    // half can resolve the exact wire bytes through the one shared dispatch.
    await bridge.generatorPreview({
      spans: [1, 2, 3, 4].map((spanId) => ({
        spanId,
        spanLen: 20,
        label: null,
        sectionIndex: 1,
        subdivision: 20,
      })),
      // Authored accent velocities per span matra (beat starts boosted, and
      // distinct per span so the Rust half can pin exact stamped cells).
      spanVelocities: [1, 2, 3, 4].map((spanId) => ({
        spanId,
        velocities: Array.from({ length: 20 }, (_, matra) =>
          matra === 0 ? 112 + spanId : 96
        ),
      })),
      enabled: true,
      generator: {
        kind: "dumka",
        pattern: "[dum@3 ka] [. ka] [[dum .] [ka .] [dum .] [ka .] [dum .]]@2",
        evolutionRate: 15,
        driftLeash: 30,
        barlowTemperature: 0,
        weightBarlowRemove: 3,
        weightBarlowAdd: 3,
        weightRotate: 2,
        weightSyncopate: 0,
        weightDesyncopate: 0,
        weightFragment: 0,
        weightConsolidate: 0,
        fillComplexity: 0,
        weightEuclid: 0,
        euclidMaxRun: 1,
        euclidInvert: 0,
        euclidRestPolicy: "tied",
        plan: [
          {
            id: 101,
            order: 0,
            enabled: true,
            fromCycle: 13,
            toCycle: 13,
            family: "barlowRemove",
            pacing: "perCycle",
            intensity: 15,
            scope: null,
            options: {
              barlowTemperature: 0,
              fillComplexity: null,
              euclidMaxRun: null,
              euclidInvert: null,
              euclidRestPolicy: null,
              rotateDirection: "earlier",
            },
          },
          {
            id: 102,
            order: 1,
            enabled: true,
            fromCycle: 5,
            toCycle: 9,
            family: "syncopate",
            pacing: "linear",
            intensity: 32,
            scope: { startBeat: 2, lenBeats: 2 },
            options: {
              barlowTemperature: null,
              fillComplexity: null,
              euclidMaxRun: null,
              euclidInvert: null,
              euclidRestPolicy: null,
              rotateDirection: "earlier",
            },
          },
          {
            id: 103,
            order: 2,
            enabled: false,
            fromCycle: 15,
            toCycle: 15,
            family: "fragment",
            pacing: "easeInOut",
            intensity: 22,
            scope: { startBeat: 2, lenBeats: 2 },
            options: {
              barlowTemperature: null,
              fillComplexity: 70,
              euclidMaxRun: null,
              euclidInvert: null,
              euclidRestPolicy: null,
              rotateDirection: "earlier",
            },
          },
        ],
        planLengthCycles: 20,
        seedMode: { type: "locked", seed: 20260611 },
      },
      cycle: 0,
      cycleBeats: 4,
      automation: null,
      trackId: null,
    });

    const call = invokeMock.mock.calls.at(-1) as [
      string,
      { request: Record<string, unknown> },
    ];
    expect(call[0]).toBe("generator_preview");
    await expect(stableJson(call[1].request)).toMatchFileSnapshot(
      "./__fixtures__/dto/dumka_generator_preview_request.json"
    );
  });

  it("dumka patch document produced by the real normalizer", async () => {
    const document = createNeutralPatchDocument({
      savedAt: FIXTURE_SAVED_AT,
      seed: 20260611,
      scoreName: "dto-contract-fixture",
      cycleBeats: 4,
    });
    const dumkaGenerator = normalizePatchGeneratorConfig({
      kind: "dumka",
      pattern: "[dum@3 ka] [. ka] [[dum .] [ka .] [dum .] [ka .] [dum .]]@2",
      plan: [
        {
          id: 101,
          order: 0,
          enabled: true,
          fromCycle: 13,
          toCycle: 13,
          family: "barlowRemove",
          pacing: "perCycle",
          intensity: 15,
          scope: null,
          options: { barlowTemperature: 0 },
        },
        {
          id: 102,
          order: 1,
          enabled: true,
          fromCycle: 5,
          toCycle: 9,
          family: "syncopate",
          pacing: "linear",
          intensity: 32,
          scope: { startBeat: 2, lenBeats: 2 },
        },
        {
          id: 103,
          order: 2,
          enabled: false,
          fromCycle: 15,
          toCycle: 15,
          family: "fragment",
          pacing: "easeInOut",
          intensity: 22,
          scope: { startBeat: 2, lenBeats: 2 },
          options: { fillComplexity: 70 },
        },
      ],
      planLengthCycles: 20,
      seedMode: { type: "locked", seed: 20260611 },
    });
    // Mutate in place: the document's non-enumerable toJSON carries the v1
    // persistence projection, and spread-copying would bypass it (the
    // documented in-memory-vs-disk trap).
    document.generatorEnabled = true;
    document.generator = dumkaGenerator;
    for (const track of document.project.tracks) {
      track.generatorEnabled = true;
      track.generator = dumkaGenerator;
    }

    await expect(stableJson(document)).toMatchFileSnapshot(
      "./__fixtures__/dto/dumka_patch_document.json"
    );
  });
});
