const assert = require("node:assert/strict");
const test = require("node:test");

const {
  formatBeatFraction,
  filterSeedPathItemsForTrack,
  pruneTimelineAutomationTargetIds,
  seedPathTrackMatches,
  seedTraceDedupeKey,
  selectActiveParallelTrackPosition,
  selectActiveTrackTimelineLayers,
  selectEffectivePreviewCycle,
  selectSeedRecurrenceRows,
  selectTimelineAutomationTracks,
  selectTimelineRenderLayers,
  selectTimelineTransportLayerVisibility,
  timelineEventBelongsToActiveTrack,
  TIMELINE_CHANNEL_COLORS,
  timelineChannelColor,
  timelineCycleIndex,
  timelineSourcesAreCoherent,
} = require("../../target/ui-timeline-tests/timelineModel.js");

const EMPTY_LAYERS = {
  emptyChannelHocketEvents: [],
};

test("timelineCycleIndex clamps non-finite and negative cycles to cycle zero", () => {
  assert.equal(timelineCycleIndex(-1), 0);
  assert.equal(timelineCycleIndex(Number.NaN), 0);
  assert.equal(timelineCycleIndex(2.9), 2);
});

test("live preview cycle follows the visual transport cycle", () => {
  assert.equal(selectEffectivePreviewCycle({ isPlaying: true }, 4.1, 1), 4);
  assert.equal(selectEffectivePreviewCycle({ isPlaying: true }, 4.999, 1), 4);
  assert.equal(selectEffectivePreviewCycle({ isPlaying: true }, 5, 1), 5);
});

test("stopped preview cycle follows user inspection", () => {
  assert.equal(selectEffectivePreviewCycle({ isPlaying: false }, 8, 3), 3);
  assert.equal(selectEffectivePreviewCycle(null, 8, 3), 3);
});

test("parallel active-track timeline follows the matching local track position", () => {
  const positions = [
    { trackId: "alpha", cycle: 3, tickInCycle: 120 },
    { trackId: "beta", cycle: 7, tickInCycle: 480 },
  ];

  assert.deepEqual(selectActiveParallelTrackPosition(positions, "beta"), positions[1]);
  assert.equal(selectActiveParallelTrackPosition(positions, "missing"), null);
  assert.equal(selectActiveParallelTrackPosition(positions, null), null);
});

test("parallel playback layers only show the active track while preserving single-track events", () => {
  assert.equal(
    timelineEventBelongsToActiveTrack({ parallelTrackId: "alpha" }, "alpha"),
    true
  );
  assert.equal(
    timelineEventBelongsToActiveTrack({ parallelTrackId: "beta" }, "alpha"),
    false
  );
  assert.equal(timelineEventBelongsToActiveTrack({}, "alpha"), true);
  assert.equal(timelineEventBelongsToActiveTrack({ parallelTrackId: null }, "alpha"), true);
});

test("active-track timeline layers are scoped to both the local cycle and the active track", () => {
  // selectTimelineRenderLayers scopes to the displayed local cycle; the active
  // track may sit on a different local cycle (2) than its peer (5) under a
  // custom BPM. Feeding the cycle-filtered output into
  // selectActiveTrackTimelineLayers must yield only events that match BOTH the
  // local cycle and the active track.
  const snapshot = {
    isPlaying: true,
    channelHocketEvents: [
      { cycle: 2, parallelTrackId: "alpha", id: "chan-alpha-c2" },
      { cycle: 2, parallelTrackId: "beta", id: "chan-beta-c2" },
      { cycle: 5, parallelTrackId: "beta", id: "chan-beta-c5" },
    ],
  };
  // Active track "beta" is on local cycle 2.
  const rendered = selectTimelineRenderLayers(snapshot, 2, []);
  const visible = selectActiveTrackTimelineLayers({
    activeTrackId: "beta",
    showChannelHocketTransportRenderLayers: true,
    activeChannelHocketEvents: rendered.activeChannelHocketEvents,
    ...EMPTY_LAYERS,
  });

  assert.deepEqual(
    visible.visibleChannelHocketEvents.map((event) => event.id),
    ["chan-beta-c2"],
    "peer-track and other-cycle hocket events must be excluded"
  );
});

test("active-track timeline layers gate each lane by its own visibility flag", () => {
  const events = {
    activeChannelHocketEvents: [{ cycle: 0, parallelTrackId: "beta", id: "c" }],
  };
  const visible = selectActiveTrackTimelineLayers({
    activeTrackId: "beta",
    showChannelHocketTransportRenderLayers: false,
    ...events,
    ...EMPTY_LAYERS,
  });
  assert.equal(
    visible.visibleChannelHocketEvents,
    EMPTY_LAYERS.emptyChannelHocketEvents
  );
});

test("active-track timeline layers preserve untagged single-track events", () => {
  // Single-track playback emits events with no parallelTrackId; with no active
  // track id they must all remain visible.
  const events = {
    activeChannelHocketEvents: [{ cycle: 1, id: "c1" }],
  };
  const visible = selectActiveTrackTimelineLayers({
    activeTrackId: null,
    showChannelHocketTransportRenderLayers: true,
    ...events,
    ...EMPTY_LAYERS,
  });
  assert.deepEqual(visible.visibleChannelHocketEvents.map((e) => e.id), ["c1"]);
});

test("seed-path track match rule handles legacy and concrete ids", () => {
  // Mirrors the Rust seed_path_track_matches rule.
  assert.equal(seedPathTrackMatches(null, "beta"), true); // legacy entry, any track
  assert.equal(seedPathTrackMatches(undefined, "beta"), true);
  assert.equal(seedPathTrackMatches("alpha", null), true); // single-track replay
  assert.equal(seedPathTrackMatches("beta", "beta"), true);
  assert.equal(seedPathTrackMatches("alpha", "beta"), false);
});

test("seed-path items filter to a track while keeping legacy items", () => {
  const items = [
    { trackId: "alpha", seed: 1 },
    { trackId: "beta", seed: 2 },
    { trackId: null, seed: 3 }, // legacy / all-tracks
  ];
  assert.deepEqual(
    filterSeedPathItemsForTrack(items, "beta").map((i) => i.seed),
    [2, 3]
  );
  assert.deepEqual(
    filterSeedPathItemsForTrack(items, "alpha").map((i) => i.seed),
    [1, 3]
  );
  // Single-track replay (null) keeps everything (back-compat).
  assert.deepEqual(
    filterSeedPathItemsForTrack(items, null).map((i) => i.seed),
    [1, 2, 3]
  );
});

test("seed-trace dedupe key separates tracks on the same domain/cycle", () => {
  const base = { cycle: 0, domain: "rhythm", label: "Rhythm Shaper" };
  const alpha = seedTraceDedupeKey({ ...base, trackId: "alpha" });
  const beta = seedTraceDedupeKey({ ...base, trackId: "beta" });
  assert.notEqual(alpha, beta);
  // Legacy/single-track (null) is stable and equals the empty-track form.
  assert.equal(
    seedTraceDedupeKey({ ...base, trackId: null }),
    seedTraceDedupeKey(base)
  );
});

test("timeline channel colors are stable unique user-channel identities", () => {
  assert.equal(TIMELINE_CHANNEL_COLORS.length, 16);
  assert.equal(new Set(TIMELINE_CHANNEL_COLORS).size, 16);
  assert.equal(timelineChannelColor(1), TIMELINE_CHANNEL_COLORS[0]);
  assert.equal(timelineChannelColor(9), TIMELINE_CHANNEL_COLORS[8]);
  assert.notEqual(timelineChannelColor(1), timelineChannelColor(9));
  assert.equal(timelineChannelColor(0), TIMELINE_CHANNEL_COLORS[0]);
  assert.equal(timelineChannelColor(Number.NaN), TIMELINE_CHANNEL_COLORS[0]);
  assert.equal(timelineChannelColor(99), TIMELINE_CHANNEL_COLORS[15]);
});

test("timeline automation lanes are hidden by default", () => {
  const tracks = [
    { id: "tempo", target: "transport.tempoBpm", enabled: true },
    { id: "pitch", target: "score.pitch", enabled: true },
  ];

  assert.deepEqual(selectTimelineAutomationTracks(tracks, []), []);
});

test("timeline automation lane selector shows only selected enabled lanes", () => {
  const tracks = [
    { id: "tempo", target: "transport.tempoBpm", enabled: true },
    { id: "pitch", target: "score.pitch", enabled: true },
    { id: "velocity", target: "score.velocity", enabled: false },
  ];

  assert.deepEqual(
    selectTimelineAutomationTracks(tracks, [
      "score.velocity",
      "score.pitch",
      "transport.tempoBpm",
    ]),
    [tracks[0], tracks[1]]
  );
});

test("timeline automation lane selections drop stale disabled and duplicate targets", () => {
  const tracks = [
    { id: "tempo", target: "transport.tempoBpm", enabled: true },
    { id: "pitch", target: "score.pitch", enabled: false },
    { id: "velocity", target: "score.velocity", enabled: true },
  ];

  assert.deepEqual(
    pruneTimelineAutomationTargetIds(
      [
        "missing.target",
        "score.pitch",
        "score.velocity",
        "score.velocity",
        "transport.tempoBpm",
      ],
      tracks
    ),
    ["score.velocity", "transport.tempoBpm"]
  );
});

test("stopped timeline inspection hides stale transport render layers", () => {
  const emptyChannels = [];
  const selection = selectTimelineRenderLayers(
    {
      isPlaying: false,
      channelHocketEvents: [{ cycle: 3, id: "stale-channel" }],
    },
    9,
    emptyChannels
  );

  assert.equal(selection.showTransportRenderLayers, false);
  assert.equal(selection.cycleIndex, 9);
  assert.equal(selection.activeChannelHocketEvents, emptyChannels);
});

test("live timeline render layers follow the interpolated visual cycle", () => {
  const selection = selectTimelineRenderLayers(
    {
      isPlaying: true,
      channelHocketEvents: [
        { cycle: 1, id: "old-channel" },
        { cycle: 2, id: "current-channel" },
        { cycle: 3, id: "future-channel" },
      ],
    },
    2.75,
    []
  );

  assert.equal(selection.showTransportRenderLayers, true);
  assert.deepEqual(selection.activeChannelHocketEvents, [
    { cycle: 2, id: "current-channel" },
  ]);
});

test("live timeline render layers require matching preview and rhythm cycles", () => {
  assert.equal(
    timelineSourcesAreCoherent({
      isPlaying: true,
      cycleIndex: 4,
      previewCycle: 4,
      rhythmCycle: 4,
      rhythmEnabled: true,
    }),
    true
  );
  assert.equal(
    timelineSourcesAreCoherent({
      isPlaying: true,
      cycleIndex: 4,
      previewCycle: 3,
      rhythmCycle: 4,
      rhythmEnabled: true,
    }),
    false
  );
  assert.equal(
    timelineSourcesAreCoherent({
      isPlaying: true,
      cycleIndex: 4,
      previewCycle: 4,
      rhythmCycle: 3,
      rhythmEnabled: true,
    }),
    false
  );
  assert.equal(
    timelineSourcesAreCoherent({
      isPlaying: true,
      cycleIndex: 4,
      previewCycle: 4,
      rhythmCycle: null,
      rhythmEnabled: false,
    }),
    true
  );
  assert.equal(
    timelineSourcesAreCoherent({
      isPlaying: false,
      cycleIndex: 4,
      previewCycle: 2,
      rhythmCycle: 1,
      rhythmEnabled: true,
    }),
    true
  );
});

test("channel transport layer waits for full preview/rhythm coherence", () => {
  const visibility = selectTimelineTransportLayerVisibility({
    showTransportRenderLayers: true,
    previewCoherent: true,
    rhythmCoherent: false,
  });

  assert.equal(visibility.showChannelHocketTransportRenderLayers, false);
  assert.equal(visibility.showFullyCoherentTransportRenderLayers, false);
});

test("transport layers stay hidden until the matching preview layout exists", () => {
  const visibility = selectTimelineTransportLayerVisibility({
    showTransportRenderLayers: true,
    previewCoherent: false,
    rhythmCoherent: true,
  });

  assert.equal(visibility.showChannelHocketTransportRenderLayers, false);
  assert.equal(visibility.showFullyCoherentTransportRenderLayers, false);
});

test("seed recurrence rows mark history repeats and new seed learning", () => {
  const rows = selectSeedRecurrenceRows(
    [
      {
        cycle: 2,
        domain: "global",
        seed: "11",
        source: "new",
        historyBefore: [],
      },
      {
        cycle: 3,
        domain: "global",
        seed: "11",
        source: "history",
        historyBefore: ["11", "22"],
      },
      {
        cycle: 4,
        domain: "global",
        seed: "22",
        source: "history",
        historyBefore: ["11", "22"],
      },
    ],
    [{ domain: "global", label: "G", enabled: true }],
    4
  );

  assert.equal(rows.length, 1);
  assert.equal(rows[0].repeatCount, 2);
  assert.equal(rows[0].newCount, 1);
  assert.equal(rows[0].observedCount, 3);
  assert.equal(rows[0].paceLabel, "every 1.0c");
  assert.deepEqual(
    rows[0].cells.map((cell) => [cell.cycle, cell.state, cell.historyIndex]),
    [
      [1, "empty", null],
      [2, "new", null],
      [3, "repeat", 0],
      [4, "repeat", 1],
    ]
  );
});

test("seed recurrence keeps adjacent full-width u64 history values distinct", () => {
  const selected = "16602156551234156693";
  const adjacent = "16602156551234156692";
  const rows = selectSeedRecurrenceRows(
    [
      {
        cycle: 0,
        domain: "global",
        seed: selected,
        source: "history",
        historyBefore: [adjacent, selected],
      },
    ],
    [{ domain: "global", label: "G", enabled: true }],
    1
  );

  assert.equal(rows[0].cells[0].seed, selected);
  assert.equal(rows[0].cells[0].historyIndex, 1);
});

test("seed recurrence rows keep inactive streams visible without fabricating repeats", () => {
  const rows = selectSeedRecurrenceRows(
    [
      {
        cycle: 0,
        domain: "rhythm",
        seed: "44",
        source: "locked",
        historyBefore: [],
      },
    ],
    [{ domain: "rhythm", label: "R", enabled: false, inheritedFrom: "G" }],
    3
  );

  assert.equal(rows[0].enabled, false);
  assert.equal(rows[0].inheritedFrom, "G");
  assert.equal(rows[0].repeatCount, 0);
  assert.equal(rows[0].newCount, 0);
  assert.equal(rows[0].observedCount, 1);
  assert.equal(rows[0].paceLabel, "seeded");
});

test("formatBeatFraction reduces cell lengths to beat quantities", () => {
  assert.equal(formatBeatFraction(8, 20), "2/5");
  assert.equal(formatBeatFraction(5, 20), "1/4");
  assert.equal(formatBeatFraction(20, 20), "1");
  assert.equal(formatBeatFraction(30, 20), "3/2");
  assert.equal(formatBeatFraction(0, 20), "0");
});
