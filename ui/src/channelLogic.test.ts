import { describe, expect, it } from "vitest";

import type {
  ChannelConflictPolicy,
  ChannelLogicMatrixEntry,
  ParallelTrackPatch,
} from "./patchIo";
import {
  buildChannelLogicOverrideRows,
  buildEffectiveChannelSummaries,
  buildParallelPriorityRows,
  channelHocketPossibleMidiChannels,
  channelConflictPolicyLabel,
  channelLogicGlobalsForDefaultPolicy,
  channelLogicGroupKey,
  formatMidiChannelList,
  formatTrackOptionLabel,
  intersectMidiChannels,
  nextChannelLogicMatrixForAddedPair,
  nextChannelLogicMatrixForGroupPolicy,
  nextChannelLogicMatrixForGroupTrack,
  nextChannelLogicMatrixForRemovedGroup,
  nextChannelLogicMatrixForToggledChannel,
  nextChannelLogicRulePolicy,
  nextConflictPriorityForMove,
  POLICY_METADATA,
  resolveChannelLogicPolicy,
  unionMidiChannels,
  type ChannelLogicGroupRef,
  type ChannelLogicTrackTab,
} from "./channelLogic";
import {
  channelLogicMatrixRepairCount,
  defaultEuclidChannelState,
} from "./patchIo";

// Minimal tracks: reducers only read `id` (via normalizeChannelLogicMatrix) and
// `channelHocket` (via trackOutputMidiChannels, only in the add-pair reducer).
function pTrack(id: string, outputChannel = 1): ParallelTrackPatch {
  return {
    id,
    channelHocket: { enabled: false, outputChannel },
  } as unknown as ParallelTrackPatch;
}

const groupRef = (
  overrides: Partial<ChannelLogicGroupRef> & {
    trackAId: string;
    trackBId: string;
    policy: ChannelConflictPolicy;
  }
): ChannelLogicGroupRef => ({
  outputChannels: [],
  includesAllShared: false,
  ...overrides,
});

function tab(overrides: Partial<ChannelLogicTrackTab> & { id: string }): ChannelLogicTrackTab {
  return {
    name: "",
    midiChannels: [],
    inspectableMidiChannels: [],
    channelHocketEnabled: false,
    ...overrides,
  };
}

function entry(
  overrides: Partial<ChannelLogicMatrixEntry> & {
    trackAId: string;
    trackBId: string;
    policy: ChannelConflictPolicy;
  }
): ChannelLogicMatrixEntry {
  return { outputChannel: null, ...overrides };
}

describe("MIDI channel set math", () => {
  it("intersects, preserving left order", () => {
    expect(intersectMidiChannels([1, 2, 3], [2, 3, 4])).toEqual([2, 3]);
    expect(intersectMidiChannels([1, 2], [3, 4])).toEqual([]);
  });

  it("unions, dedupes, sorts, and drops out-of-range channels", () => {
    expect(unionMidiChannels([3, 1], [2, 3])).toEqual([1, 2, 3]);
    expect(unionMidiChannels([1, 100], [0])).toEqual([1]);
  });
});

describe("channelHocketPossibleMidiChannels", () => {
  it("includes accent and position-rule output channels", () => {
    expect(
      channelHocketPossibleMidiChannels({
        enabled: true,
        outputChannel: 1,
        order: "first",
        channels: [1, 2, 3, 4],
        weights: {},
        fallback: 1,
        fallbackWeights: { "2": 5 },
        entryWeights: {},
        accentRules: [
          {
            label: "Strong",
            enabled: true,
            minVelocity: 96,
            maxVelocity: 127,
            probabilityPercent: 100,
            mode: "renderOnly",
            weights: { "3": 7 },
          },
        ],
        positionRules: [
          {
            id: "beat-two",
            label: "Beat two",
            enabled: true,
            scope: "beat",
            nth: 2,
            actionWeights: {
              normalMarkov: 0,
              renderOnly: 1,
              resetMarkov: 1,
            },
            renderWeights: { "4": 9 },
            resetMode: "customWeighted",
            resetWeights: { "2": 11 },
          },
        ],
        assignMode: "markov",
        euclid: defaultEuclidChannelState(),
      })
    ).toEqual([1, 2, 3, 4]);
  });

  it("reports layer channels, fallback, and bypass anchor in euclid mode", () => {
    const base = {
      enabled: true,
      outputChannel: 1,
      order: "first" as const,
      channels: [1, 2, 3, 4],
      weights: { "first:2:3": 9 }, // dormant matrix must NOT leak in
      fallback: 1,
      fallbackWeights: { "4": 5 }, // dormant weighted pool must NOT leak in
      entryWeights: {},
      accentRules: [],
      positionRules: [],
      assignMode: "euclid" as const,
      euclid: {
        ...defaultEuclidChannelState(),
        steps: 8,
        layers: [
          { channel: 2, pulses: 3, rotation: 0, maxRun: 1, steps: 16, invert: false },
          { channel: 3, pulses: 0, rotation: 0, maxRun: 1, steps: 16, invert: false },
        ],
      },
    };
    // Layer with pulses + the static fallback; the pulse-less layer and the
    // dormant markov pools stay out.
    expect(channelHocketPossibleMidiChannels(base)).toEqual([1, 2]);
    expect(
      channelHocketPossibleMidiChannels({
        ...base,
        euclid: {
          ...base.euclid,
          spanAccentMode: "bypass",
          spanAccentChannel: 4,
        },
      })
    ).toEqual([1, 2, 4]);
  });
});

describe("formatMidiChannelList", () => {
  it("collapses runs into ranges", () => {
    expect(formatMidiChannelList([])).toBe("No MIDI Ch");
    expect(formatMidiChannelList([1, 2, 3])).toBe("Ch 1-3");
    expect(formatMidiChannelList([1, 3, 5])).toBe("Ch 1, 3, 5");
    expect(formatMidiChannelList([1, 2, 4, 5])).toBe("Ch 1-2, 4-5");
    expect(formatMidiChannelList([3, 1, 2])).toBe("Ch 1-3");
    expect(formatMidiChannelList([100])).toBe("No MIDI Ch");
  });
});

describe("formatTrackOptionLabel", () => {
  it("appends a custom name only when it differs from the default", () => {
    expect(formatTrackOptionLabel({ name: "" }, 0)).toBe("Track 1");
    expect(formatTrackOptionLabel({ name: "Lead" }, 0)).toBe("Track 1 · Lead");
    expect(formatTrackOptionLabel({ name: "Track 2" }, 1)).toBe("Track 2");
  });
});

describe("channelConflictPolicyLabel", () => {
  it("returns the one user-facing label for every policy (B0.2)", () => {
    // The single vocabulary: no more "XOR" / "Allow all / OR" technical names.
    expect(channelConflictPolicyLabel("xor")).toBe("One only");
    expect(channelConflictPolicyLabel("priorityOrder")).toBe("Priority");
    expect(channelConflictPolicyLabel("allowAll")).toBe("Layer all");
    // Legacy policies project onto their musical mode's label.
    expect(channelConflictPolicyLabel("forceOn")).toBe("Layer all");
  });
});

describe("channelLogicGroupKey", () => {
  it("is deterministic and varies by policy", () => {
    expect(channelLogicGroupKey("a", "b", "xor")).toBe(
      channelLogicGroupKey("a", "b", "xor")
    );
    expect(channelLogicGroupKey("a", "b", "xor")).not.toBe(
      channelLogicGroupKey("a", "b", "and")
    );
  });
});

describe("POLICY_METADATA", () => {
  it("gives every policy exactly one label and availability", () => {
    const policies = Object.keys(POLICY_METADATA) as ChannelConflictPolicy[];
    for (const policy of policies) {
      const meta = POLICY_METADATA[policy];
      expect(meta.label).toBeTruthy();
      expect(["default", "rule", "both", "legacy"]).toContain(meta.availableAs);
    }
  });
});

describe("resolveChannelLogicPolicy", () => {
  const entries: ChannelLogicMatrixEntry[] = [
    { trackAId: "a", trackBId: "b", outputChannel: null, policy: "forceOff" },
    { trackAId: "a", trackBId: "b", outputChannel: 2, policy: "randomOne" },
  ];

  it("prefers an exact channel rule over the legacy pair rule over the default", () => {
    // Channel 2 has an exact rule.
    expect(resolveChannelLogicPolicy(entries, "allowAll", "a", "b", 2)).toEqual({
      policy: "randomOne",
      source: "channel-rule",
    });
    // Channel 5 falls back to the legacy all-channel pair rule.
    expect(resolveChannelLogicPolicy(entries, "allowAll", "a", "b", 5)).toEqual({
      policy: "forceOff",
      source: "pair-rule",
    });
    // A pair with no rule uses the project default.
    expect(resolveChannelLogicPolicy(entries, "xor", "a", "c", 2)).toEqual({
      policy: "xor",
      source: "default",
    });
  });
});

describe("buildEffectiveChannelSummaries", () => {
  it("lists explicit rules per shared channel and the default", () => {
    const trackTabs = [
      tab({ id: "a", midiChannels: [1, 2] }),
      tab({ id: "b", midiChannels: [1, 2] }),
    ];
    const summaries = buildEffectiveChannelSummaries(
      [{ trackAId: "a", trackBId: "b", outputChannel: 2, policy: "forceOff" }],
      "randomOne",
      trackTabs
    );
    expect(summaries).toEqual([
      { channel: 1, ruleParts: [], defaultPolicy: "randomOne" },
      {
        channel: 2,
        ruleParts: [{ label: "Track 1↔Track 2", policy: "forceOff" }],
        defaultPolicy: "randomOne",
      },
    ]);
  });
});

describe("channelLogicMatrixRepairCount", () => {
  const tracks = [pTrack("a"), pTrack("b")];
  it("counts duplicate (pair, channel) entries the load-time dedup drops (D4)", () => {
    const raw = [
      { trackAId: "a", trackBId: "b", outputChannel: 3, policy: "forceOff" },
      { trackAId: "a", trackBId: "b", outputChannel: 3, policy: "randomOne" },
    ];
    expect(channelLogicMatrixRepairCount(raw, tracks, "allowAll")).toBe(1);
    expect(channelLogicMatrixRepairCount(raw.slice(0, 1), tracks, "allowAll")).toBe(0);
  });
});

describe("nextChannelLogicRulePolicy", () => {
  it("picks a policy other than the default", () => {
    const used = new Set<ChannelConflictPolicy>();
    const next = nextChannelLogicRulePolicy("allowAll", used);
    expect(next).not.toBe("allowAll");
  });
});

describe("buildChannelLogicOverrideRows", () => {
  const trackTabs = [
    tab({
      id: "a",
      name: "Lead",
      midiChannels: [1, 2],
      inspectableMidiChannels: [1, 2, 3],
      channelHocketEnabled: true,
    }),
    tab({
      id: "b",
      midiChannels: [2, 3],
      inspectableMidiChannels: [2, 3],
      channelHocketEnabled: false,
    }),
  ];

  it("groups output channels and annotates each channel option", () => {
    const rows = buildChannelLogicOverrideRows(
      [
        entry({ trackAId: "a", trackBId: "b", policy: "xor", outputChannel: 2 }),
        entry({ trackAId: "a", trackBId: "b", policy: "xor", outputChannel: 3 }),
      ],
      trackTabs
    );
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.outputChannels).toEqual([2, 3]);
    expect(row.includesAllShared).toBe(false);
    expect(row.sharedChannels).toEqual([2]);
    expect(row.selectedLabel).toBe("Ch 2-3");
    expect(row.titleA).toBe("Track 1 · Lead");
    expect(row.titleB).toBe("Track 2");
    expect(row.channelTitle).toBe("Track 1 and Track 2 can overlap on Ch 2");
    expect(row.channelOptions).toEqual([
      {
        channel: 2,
        active: true,
        selected: true,
        disabled: false,
        reason: "",
        label: "Ch 2",
      },
      {
        channel: 3,
        active: false,
        selected: true,
        disabled: false,
        reason: "Track 1 not routed now",
        label: "Ch 3 (Track 1 not routed now)",
      },
    ]);
  });

  it("marks a null output channel as 'all shared channels'", () => {
    const rows = buildChannelLogicOverrideRows(
      [entry({ trackAId: "a", trackBId: "b", policy: "xor", outputChannel: null })],
      trackTabs
    );
    expect(rows[0]!.includesAllShared).toBe(true);
    expect(rows[0]!.outputChannels).toEqual([]);
    expect(rows[0]!.selectedLabel).toBe("all shared channels");
  });

  it("keeps distinct policies as separate rows", () => {
    const rows = buildChannelLogicOverrideRows(
      [
        entry({ trackAId: "a", trackBId: "b", policy: "xor", outputChannel: 2 }),
        entry({ trackAId: "a", trackBId: "b", policy: "allowAll", outputChannel: 2 }),
      ],
      trackTabs
    );
    expect(rows.map((row) => row.policy).sort()).toEqual(["allowAll", "xor"]);
  });

  it("drops groups whose tracks are no longer present", () => {
    const rows = buildChannelLogicOverrideRows(
      [entry({ trackAId: "a", trackBId: "missing", policy: "xor", outputChannel: 2 })],
      trackTabs
    );
    expect(rows).toEqual([]);
  });
});

describe("buildParallelPriorityRows", () => {
  const trackTabs = [
    { id: "a", name: "Lead", color: "#f00" },
    { id: "b", name: "", color: "#0f0" },
    { id: "c", name: "Track 3", color: "#00f" },
  ];

  it("returns nothing for a single track", () => {
    expect(buildParallelPriorityRows(["a"], [{ id: "a", name: "", color: "#000" }])).toEqual(
      []
    );
  });

  it("orders rows by the supplied priority and carries position + custom name", () => {
    const rows = buildParallelPriorityRows(["b", "a", "c"], trackTabs);
    // labels reflect each track's tab position, while priorityIndex follows the order
    expect(rows).toEqual([
      { id: "b", label: "Track 2", customName: "", color: "#0f0", priorityIndex: 0 },
      { id: "a", label: "Track 1", customName: "Lead", color: "#f00", priorityIndex: 1 },
      // "Track 3" equals the default label for tab index 2, so customName stays blank
      { id: "c", label: "Track 3", customName: "", color: "#00f", priorityIndex: 2 },
    ]);
  });

  it("drops priority ids without a matching tab", () => {
    const rows = buildParallelPriorityRows(["a", "ghost", "b"], trackTabs);
    expect(rows.map((row) => row.id)).toEqual(["a", "b"]);
    expect(rows.map((row) => row.priorityIndex)).toEqual([0, 2]);
  });
});

describe("channel-logic write-side reducers", () => {
  const tracks = [pTrack("a"), pTrack("b"), pTrack("c")];

  describe("channelLogicGlobalsForDefaultPolicy", () => {
    it("returns the musical default and keeps rules equal to it (D3)", () => {
      // "forceOn" -> default "allowAll". An existing "allowAll" rule now equals
      // the default but is KEPT (shown "= default"), not silently erased.
      const result = channelLogicGlobalsForDefaultPolicy(
        [{ trackAId: "a", trackBId: "b", outputChannel: 3, policy: "allowAll" }],
        tracks,
        "forceOn"
      );
      expect(result.channelConflictPolicy).toBe("allowAll");
      expect(result.channelLogicMatrix).toEqual([
        { trackAId: "a", trackBId: "b", outputChannel: 3, policy: "allowAll" },
      ]);
    });
  });

  describe("nextChannelLogicMatrixForGroupPolicy", () => {
    const start: ChannelLogicMatrixEntry[] = [
      { trackAId: "a", trackBId: "b", outputChannel: 3, policy: "priorityOrder" },
    ];

    it("repoints a group to a new policy", () => {
      const next = nextChannelLogicMatrixForGroupPolicy(
        start,
        tracks,
        "allowAll",
        groupRef({ trackAId: "a", trackBId: "b", outputChannels: [3], policy: "priorityOrder" }),
        "forceOff"
      );
      expect(next).toEqual([
        { trackAId: "a", trackBId: "b", outputChannel: 3, policy: "forceOff" },
      ]);
    });

    it("keeps the rule when the new policy equals the default (D3)", () => {
      const next = nextChannelLogicMatrixForGroupPolicy(
        start,
        tracks,
        "allowAll",
        groupRef({ trackAId: "a", trackBId: "b", outputChannels: [3], policy: "priorityOrder" }),
        "allowAll"
      );
      expect(next).toEqual([
        { trackAId: "a", trackBId: "b", outputChannel: 3, policy: "allowAll" },
      ]);
    });
  });

  describe("nextChannelLogicMatrixForToggledChannel", () => {
    it("adds a rule when toggling a channel on", () => {
      const next = nextChannelLogicMatrixForToggledChannel(
        [],
        tracks,
        "allowAll",
        "a",
        "b",
        "priorityOrder",
        3,
        false
      );
      expect(next).toEqual([
        { trackAId: "a", trackBId: "b", outputChannel: 3, policy: "priorityOrder" },
      ]);
    });

    it("removes the rule when toggling the channel off", () => {
      const next = nextChannelLogicMatrixForToggledChannel(
        [{ trackAId: "a", trackBId: "b", outputChannel: 3, policy: "priorityOrder" }],
        tracks,
        "allowAll",
        "a",
        "b",
        "priorityOrder",
        3,
        true
      );
      expect(next).toEqual([]);
    });

    it("adds a rule equal to the default (D3, shown '= default')", () => {
      const next = nextChannelLogicMatrixForToggledChannel(
        [],
        tracks,
        "allowAll",
        "a",
        "b",
        "allowAll",
        3,
        false
      );
      expect(next).toEqual([
        { trackAId: "a", trackBId: "b", outputChannel: 3, policy: "allowAll" },
      ]);
    });

    it("moves channel ownership: toggling on drops any other rule owning it (D4)", () => {
      const next = nextChannelLogicMatrixForToggledChannel(
        [{ trackAId: "a", trackBId: "b", outputChannel: 3, policy: "forceOff" }],
        tracks,
        "allowAll",
        "a",
        "b",
        "randomOne",
        3,
        false
      );
      // The forceOff rule on (a,b,3) is replaced, never co-owned.
      expect(next).toEqual([
        { trackAId: "a", trackBId: "b", outputChannel: 3, policy: "randomOne" },
      ]);
    });
  });

  describe("nextChannelLogicMatrixForRemovedGroup", () => {
    it("removes every rule belonging to the group", () => {
      const next = nextChannelLogicMatrixForRemovedGroup(
        [{ trackAId: "a", trackBId: "b", outputChannel: 3, policy: "priorityOrder" }],
        tracks,
        "allowAll",
        groupRef({ trackAId: "a", trackBId: "b", outputChannels: [3], policy: "priorityOrder" })
      );
      expect(next).toEqual([]);
    });
  });

  describe("nextChannelLogicMatrixForAddedPair", () => {
    it("adds a rule for the first track pair that shares a channel", () => {
      const shared = [pTrack("a", 3), pTrack("b", 3)];
      const next = nextChannelLogicMatrixForAddedPair([], shared, "allowAll");
      expect(next).not.toBeNull();
      expect(next).toHaveLength(1);
      expect(next![0]).toMatchObject({ trackAId: "a", trackBId: "b", outputChannel: 3 });
      expect(next![0]!.policy).not.toBe("allowAll");
    });

    it("returns null when no track pair shares a channel", () => {
      const disjoint = [pTrack("a", 3), pTrack("b", 5)];
      expect(nextChannelLogicMatrixForAddedPair([], disjoint, "allowAll")).toBeNull();
    });
  });

  describe("nextChannelLogicMatrixForGroupTrack", () => {
    it("re-pairs a group's rules to the new (ordered) track", () => {
      const next = nextChannelLogicMatrixForGroupTrack(
        [{ trackAId: "a", trackBId: "b", outputChannel: 3, policy: "priorityOrder" }],
        tracks,
        "allowAll",
        groupRef({ trackAId: "a", trackBId: "b", outputChannels: [3], policy: "priorityOrder" }),
        "b",
        "c"
      );
      expect(next).toEqual([
        { trackAId: "a", trackBId: "c", outputChannel: 3, policy: "priorityOrder" },
      ]);
    });

    it("returns null when the edit would pair a track with itself", () => {
      const next = nextChannelLogicMatrixForGroupTrack(
        [],
        tracks,
        "allowAll",
        groupRef({ trackAId: "a", trackBId: "b", outputChannels: [3], policy: "priorityOrder" }),
        "b",
        "a"
      );
      expect(next).toBeNull();
    });
  });

  describe("nextConflictPriorityForMove", () => {
    it("swaps a track one step in the requested direction", () => {
      expect(nextConflictPriorityForMove(["a", "b", "c"], tracks, "a", 1)).toEqual([
        "b",
        "a",
        "c",
      ]);
      expect(nextConflictPriorityForMove(["a", "b", "c"], tracks, "c", -1)).toEqual([
        "a",
        "c",
        "b",
      ]);
    });

    it("returns null at the ends or for an absent track", () => {
      expect(nextConflictPriorityForMove(["a", "b", "c"], tracks, "a", -1)).toBeNull();
      expect(nextConflictPriorityForMove(["a", "b", "c"], tracks, "c", 1)).toBeNull();
      expect(nextConflictPriorityForMove(["a", "b", "c"], tracks, "ghost", 1)).toBeNull();
    });

    it("preserves box-lane endpoint entries when reordering authored tracks", () => {
      // The endpoint set includes a box lane id; moving an authored track must
      // not drop the lane entry (it stays a runtime conflict participant).
      const endpoints = [...tracks, { id: "track-flow-main" }];
      const next = nextConflictPriorityForMove(
        ["a", "track-flow-main", "b", "c"],
        endpoints,
        "a",
        1
      );
      expect(next).toContain("track-flow-main");
    });
  });
});
