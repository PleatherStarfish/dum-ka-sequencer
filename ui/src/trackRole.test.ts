import { describe, expect, it } from "vitest";

import type { TriggerConfig } from "./bridge";
import { type TrackFlowBox, defaultTrackFlowChain } from "./trackFlowBoxes";
import {
  type RoleTrack,
  applyRoleIntent,
  assignTrackToBoxes,
  eligibleTriggerSources,
  roleOptions,
  roleTransition,
  trackRole,
} from "./trackRole";

const TRIGGER = {} as TriggerConfig; // role helpers only test truthiness

function track(id: string, trigger: TriggerConfig | null = null): RoleTrack {
  return { id, name: id, trigger };
}

function box(id: string, members: string[]): TrackFlowBox {
  return {
    id,
    name: id,
    memberTrackIds: members,
    chain: defaultTrackFlowChain(),
    seed: 0,
    collapsed: false,
  };
}

describe("trackRole", () => {
  it("is continuous with no trigger and no box", () => {
    expect(trackRole(track("a"), [])).toBe("continuous");
  });

  it("is triggered when a trigger is set and the track is unboxed", () => {
    expect(trackRole(track("a", TRIGGER), [])).toBe("triggered");
  });

  it("is trackFlow when the track is boxed (membership wins over any trigger)", () => {
    expect(trackRole(track("a", TRIGGER), [box("box-1", ["a"])])).toBe("trackFlow");
  });
});

describe("eligibleTriggerSources", () => {
  it("keeps only other, continuous, unboxed tracks", () => {
    const tracks = [
      track("active"),
      track("free"), // eligible
      track("follower", TRIGGER), // excluded: already triggered
      track("boxed"), // excluded: boxed below
    ];
    const boxes = [box("box-1", ["boxed"])];
    expect(
      eligibleTriggerSources("active", tracks, boxes).map((t) => t.id)
    ).toEqual(["free"]);
  });
});

describe("roleOptions", () => {
  it("offers only continuous in a single-track project", () => {
    const tracks = [track("solo")];
    const options = roleOptions(tracks[0]!, tracks, []);
    expect(options.map((o) => [o.role, o.enabled])).toEqual([
      ["continuous", true],
      ["triggered", false],
      ["trackFlow", false],
    ]);
    expect(options[1]!.reason).toMatch(/source/);
    expect(options[2]!.reason).toMatch(/group/);
  });

  it("enables every role once a second continuous track exists", () => {
    const tracks = [track("a"), track("b")];
    const options = roleOptions(tracks[0]!, tracks, []);
    expect(options.every((o) => o.enabled)).toBe(true);
  });

  it("keeps the current role selectable even when its precondition is gone", () => {
    // `a` is triggered by `b`, but `b` has since been boxed — so there is no
    // eligible source. The triggered radio stays enabled because it is current.
    const tracks = [track("a", TRIGGER), track("b")];
    const boxes = [box("box-1", ["b"])];
    const options = roleOptions(tracks[0]!, tracks, boxes);
    const triggered = options.find((o) => o.role === "triggered")!;
    expect(triggered.current).toBe(true);
    expect(triggered.enabled).toBe(true);
  });
});

describe("roleTransition", () => {
  it("is a no-op when already in the target role", () => {
    expect(roleTransition("continuous", track("a"), [track("a")], [])).toBeNull();
  });

  it("routes continuous → triggered to the first eligible source", () => {
    const tracks = [track("a"), track("b"), track("c")];
    expect(roleTransition("triggered", tracks[0]!, tracks, [])).toEqual({
      kind: "triggered",
      sourceId: "b",
    });
  });

  it("refuses triggered when there is no eligible source", () => {
    const tracks = [track("a"), track("b", TRIGGER)];
    expect(roleTransition("triggered", tracks[0]!, tracks, [])).toBeNull();
  });

  it("routes → trackFlow into the first existing box", () => {
    const tracks = [track("a"), track("b")];
    const boxes = [box("box-1", ["b"])];
    expect(roleTransition("trackFlow", tracks[0]!, tracks, boxes)).toEqual({
      kind: "trackFlow",
      boxTarget: "box-1",
    });
  });

  it("routes → trackFlow to a new box when none exist", () => {
    const tracks = [track("a"), track("b")];
    expect(roleTransition("trackFlow", tracks[0]!, tracks, [])).toEqual({
      kind: "trackFlow",
      boxTarget: "__new__",
    });
  });

  it("refuses trackFlow with no other track to group with", () => {
    const tracks = [track("a")];
    expect(roleTransition("trackFlow", tracks[0]!, tracks, [])).toBeNull();
  });

  it("clears state on the way back to continuous", () => {
    const tracks = [track("a", TRIGGER), track("b")];
    expect(roleTransition("continuous", tracks[0]!, tracks, [])).toEqual({
      kind: "continuous",
    });
  });
});

describe("assignTrackToBoxes", () => {
  it("un-boxes a track and drops the emptied source box", () => {
    expect(assignTrackToBoxes([box("box-1", ["a"])], "a", "")).toEqual([]);
  });

  it("keeps the source box when it still has members", () => {
    const next = assignTrackToBoxes([box("box-1", ["a", "b"])], "a", "");
    expect(next).toHaveLength(1);
    expect(next[0]!.memberTrackIds).toEqual(["b"]);
  });

  it("adds a track to an existing target box", () => {
    const next = assignTrackToBoxes([box("box-1", ["a"])], "b", "box-1");
    expect(next[0]!.memberTrackIds).toEqual(["a", "b"]);
  });

  it("mints a new box for __new__ without colliding ids", () => {
    const next = assignTrackToBoxes([box("box-1", ["a"])], "b", "__new__");
    expect(next.find((bx) => bx.memberTrackIds.includes("b"))!.id).toBe("box-2");
  });

  it("is a no-op when the track is already in the target box", () => {
    const boxes = [box("box-1", ["a"])];
    expect(assignTrackToBoxes(boxes, "a", "box-1")).toBe(boxes);
  });

  it("preserves other empty draft boxes when emptying the source box", () => {
    const next = assignTrackToBoxes([box("box-1", ["a"]), box("box-2", [])], "a", "");
    expect(next.map((bx) => bx.id)).toEqual(["box-2"]);
  });
});

describe("applyRoleIntent", () => {
  it("continuous un-boxes and clears the trigger", () => {
    const result = applyRoleIntent({ kind: "continuous" }, "a", [box("box-1", ["a"])]);
    expect(result.boxes).toEqual([]);
    expect(result.trigger).toBeNull();
  });

  it("triggered un-boxes and sets a default trigger against the source", () => {
    const result = applyRoleIntent({ kind: "triggered", sourceId: "b" }, "a", [
      box("box-1", ["a"]),
    ]);
    expect(result.boxes).toEqual([]);
    expect(result.trigger?.sourceTrackId).toBe("b");
  });

  it("trackFlow assigns the box and clears the trigger atomically", () => {
    const result = applyRoleIntent({ kind: "trackFlow", boxTarget: "box-1" }, "a", [
      box("box-1", ["b"]),
    ]);
    expect(result.boxes[0]!.memberTrackIds).toEqual(["b", "a"]);
    expect(result.trigger).toBeNull();
  });
});
