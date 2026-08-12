import { describe, expect, it } from "vitest";

// Raw source of the overlay lanes, for the coordinate-space source-scan below.
// Vite's `?raw` import (typed via `vite/client`) keeps this Node-free.
import timelineLanesSource from "./components/TimelineLanes.tsx?raw";
// The Rust-generated preview-limits contract, imported the same Node-free way.
import previewLimitsRaw from "./__fixtures__/dto/preview_limits.json?raw";

import {
  MAX_STOPPED_PREVIEW_CYCLE,
  TIMELINE_PLAYBACK_LANE_SOURCES,
  TIMELINE_PLAYBACK_LANE_TICK_SPACE,
  selectEffectivePreviewCycle,
  selectRealizedRhythmBySpanId,
  selectSeedRecurrenceRows,
  selectStableTimelineRenderModel,
  stoppedPreviewCycleIndex,
  timelineCycleIndex,
  type TimelineRealizedRhythmSnapshot,
} from "./timelineModel";
import { timelineTickToMusicalAkshara } from "./timelineTickSpace";

describe("stopped preview cycle bounds", () => {
  it("matches the Rust-generated preview-limits fixture", () => {
    // dto_fixture_preview_limits_match (src-tauri/src/main.rs) emits this
    // file from the backend constants; a one-sided change to either side
    // fails here instead of letting the UI offer cycles the backend rejects.
    const limits = JSON.parse(previewLimitsRaw) as {
      maxStoppedGeneratorPreviewCycle: number;
    };
    expect(MAX_STOPPED_PREVIEW_CYCLE).toBe(
      limits.maxStoppedGeneratorPreviewCycle
    );
  });

  it("clamps random-access stopped previews to the supported fold horizon", () => {
    expect(stoppedPreviewCycleIndex(Number.MAX_SAFE_INTEGER)).toBe(
      MAX_STOPPED_PREVIEW_CYCLE
    );
    expect(
      selectEffectivePreviewCycle(
        { isPlaying: false },
        MAX_STOPPED_PREVIEW_CYCLE + 500,
        Number.MAX_SAFE_INTEGER
      )
    ).toBe(MAX_STOPPED_PREVIEW_CYCLE);
  });

  it("does not clamp the cycle followed during live playback", () => {
    expect(
      selectEffectivePreviewCycle(
        { isPlaying: true },
        MAX_STOPPED_PREVIEW_CYCLE + 500,
        Number.MAX_SAFE_INTEGER
      )
    ).toBe(MAX_STOPPED_PREVIEW_CYCLE + 500);
  });
});

type TestSpan = { spanId: number; label: string };

function realizedSnapshot(
  isPlaying: boolean,
  events: TimelineRealizedRhythmSnapshot<TestSpan>["realizedRhythmEvents"]
): TimelineRealizedRhythmSnapshot<TestSpan> {
  return { isPlaying, realizedRhythmEvents: events };
}

describe("selectStableTimelineRenderModel", () => {
  it("keeps the current model when stopped, even if it is not coherent", () => {
    const current = { cycle: 2 };
    const last = { cycle: 1 };

    expect(
      selectStableTimelineRenderModel({
        isPlaying: false,
        currentModel: current,
        currentCoherent: false,
        lastCoherentModel: last,
      })
    ).toEqual({ model: current, usingLastCoherentModel: false });
  });

  it("keeps the last coherent model while a playing cycle catches up", () => {
    const current = { cycle: 2 };
    const last = { cycle: 1 };

    expect(
      selectStableTimelineRenderModel({
        isPlaying: true,
        currentModel: current,
        currentCoherent: false,
        lastCoherentModel: last,
      })
    ).toEqual({ model: last, usingLastCoherentModel: true });
  });

  it("uses the current model once playback data is coherent again", () => {
    const current = { cycle: 2 };
    const last = { cycle: 1 };

    expect(
      selectStableTimelineRenderModel({
        isPlaying: true,
        currentModel: current,
        currentCoherent: true,
        lastCoherentModel: last,
      })
    ).toEqual({ model: current, usingLastCoherentModel: false });
  });
});

describe("seed recurrence with u64 decimal seeds", () => {
  it("matches full-width history seeds without numeric coercion", () => {
    const fullWidthSeed = "16602156551234156693";
    const adjacentSeed = "16602156551234156692";
    const rows = selectSeedRecurrenceRows(
      [
        {
          cycle: 2,
          domain: "rhythm",
          seed: fullWidthSeed,
          source: "history",
          historyBefore: [adjacentSeed, fullWidthSeed],
        },
      ],
      [{ domain: "rhythm", label: "R", enabled: true }],
      1
    );

    expect(rows[0]?.cells[0]).toMatchObject({
      seed: fullWidthSeed,
      historyIndex: 1,
      state: "repeat",
    });
    expect(rows[0]?.latestSeed).toBe(fullWidthSeed);
  });
});

describe("TIMELINE_PLAYBACK_LANE_SOURCES guardrail", () => {
  it("sources every playing-mode lane from the realized snapshot, never preview", () => {
    // This is the regression fence: during playback, every lane that depicts a
    // realized stochastic outcome must be realized-sourced. If a future lane is
    // added as preview-sourced (or a new realized lane is left off this table),
    // this assertion fails loudly rather than letting the rhythm-row vs audio
    // divergence quietly return through another feature.
    for (const [lane, source] of Object.entries(TIMELINE_PLAYBACK_LANE_SOURCES)) {
      expect(source, `lane "${lane}" must be realized-sourced during playback`).toBe(
        "realized-snapshot"
      );
    }
  });

  it("covers the rhythm lane that originally diverged from the audio", () => {
    expect(TIMELINE_PLAYBACK_LANE_SOURCES.rhythm).toBe("realized-snapshot");
  });
});

describe("selectRealizedRhythmBySpanId", () => {
  const cycle = 1;
  const events = [
    { cycle: timelineCycleIndex(cycle), span: { spanId: 10, label: "a" } },
    { cycle: timelineCycleIndex(cycle), span: { spanId: 11, label: "b" } },
  ];

  it("returns an empty map when stopped, so the caller falls back to preview", () => {
    const map = selectRealizedRhythmBySpanId(realizedSnapshot(false, events), cycle, null);
    expect(map.size).toBe(0);
  });

  it("returns realized spans keyed by spanId while playing", () => {
    const map = selectRealizedRhythmBySpanId(realizedSnapshot(true, events), cycle, null);
    expect([...map.keys()].sort((a, b) => a - b)).toEqual([10, 11]);
    expect(map.get(10)).toEqual({ spanId: 10, label: "a" });
  });

  it("only includes events for the visible cycle", () => {
    const mixed = [
      { cycle: timelineCycleIndex(1), span: { spanId: 10, label: "visible" } },
      { cycle: timelineCycleIndex(2), span: { spanId: 11, label: "other-cycle" } },
    ];
    const map = selectRealizedRhythmBySpanId(realizedSnapshot(true, mixed), 1, null);
    expect([...map.keys()]).toEqual([10]);
  });

  it("filters by active track, keeping untagged (all-track) events", () => {
    const tagged = [
      { cycle: timelineCycleIndex(cycle), parallelTrackId: "alpha", span: { spanId: 10, label: "alpha" } },
      { cycle: timelineCycleIndex(cycle), parallelTrackId: "beta", span: { spanId: 11, label: "beta" } },
      { cycle: timelineCycleIndex(cycle), parallelTrackId: null, span: { spanId: 12, label: "shared" } },
    ];
    const map = selectRealizedRhythmBySpanId(realizedSnapshot(true, tagged), cycle, "alpha");
    expect([...map.keys()].sort((a, b) => a - b)).toEqual([10, 12]);
  });

  it("returns an empty map for a null snapshot", () => {
    expect(selectRealizedRhythmBySpanId(null, cycle, null).size).toBe(0);
  });
});

describe("timeline coordinate-space contract", () => {
  // The frontend half of the parity harness: playback overlay lanes must place
  // their markers in the same musical coordinate space the rhythm row and
  // playhead use. Tick space is linear in Dum-Ka, but every lane still routes
  // through one helper so a future coordinate-policy change has one seam.

  it("declares a tick space for exactly the lanes in the source registry", () => {
    // Adding a playback lane to one registry but not the other should be a
    // compile/test failure, so a new lane can't skip declaring how it converts
    // ticks to musical position.
    expect(Object.keys(TIMELINE_PLAYBACK_LANE_TICK_SPACE).sort()).toEqual(
      Object.keys(TIMELINE_PLAYBACK_LANE_SOURCES).sort()
    );
  });

  it("requires every tick-sourced overlay lane to use the identity helper", () => {
    // The rhythm row is drawn from akshara spans (nothing to warp); every lane
    // whose markers come from transport ticks must declare the shared identity
    // conversion path.
    expect(TIMELINE_PLAYBACK_LANE_TICK_SPACE.rhythm).toBe("akshara-native");
    for (const lane of ["channelHocket"] as const) {
      expect(
        TIMELINE_PLAYBACK_LANE_TICK_SPACE[lane],
        `lane "${lane}" sources from ticks and must use the tick-space helper`
      ).toBe("tick-via-identity-helper");
    }
  });

  it("maps ticks linearly", () => {
    expect(timelineTickToMusicalAkshara(250, 1000, 8)).toBe(2);
    expect(timelineTickToMusicalAkshara(500, 1000, 8)).toBe(4);
  });

  it("forbids raw (tick / ticksPerCycle) * cycleBeats conversions in the overlay lanes", () => {
    // Source-level fence: the channel lane lives in
    // TimelineLanes.tsx and must route every tick→akshara conversion through
    // `timelineTickToMusicalAkshara`. A direct linear conversion bypasses the
    // shared tick-space contract, so its mere presence fails here.
    const rawLinearConversion = /ticksPerCycle\s*\)\s*\*\s*cycleBeats/;
    expect(
      rawLinearConversion.test(timelineLanesSource),
      "found a raw (tick / ticksPerCycle) * cycleBeats conversion in a playback lane — route it through timelineTickToMusicalAkshara instead"
    ).toBe(false);
    // ...and the shared identity helper is actually the conversion path used.
    expect(timelineLanesSource).toContain("timelineTickToMusicalAkshara");
  });
});
