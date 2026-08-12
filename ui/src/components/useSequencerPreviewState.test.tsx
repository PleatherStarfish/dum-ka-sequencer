import { describe, expect, it } from "vitest";

import type { GeneratorConfig } from "../bridge";
import {
  createNeutralPatchDocument,
  normalizePatchGeneratorConfig,
} from "../patchIo";
import { defaultTrackFlowChain } from "../trackFlowBoxes";
import { defaultTriggerConfig } from "../triggerUi";
import {
  buildGeneratorPreviewRequestKey,
  selectGeneratorPreviewTrackId,
} from "./useSequencerPreviewState";

const generator: GeneratorConfig = {
  kind: "example",
  densityPercent: 60,
  seedMode: { type: "locked", seed: 7 },
};

describe("buildGeneratorPreviewRequestKey", () => {
  it("invalidates a preview when only the active track identity changes", () => {
    const first = buildGeneratorPreviewRequestKey(
      "same-score",
      generator,
      true,
      "track-a"
    );
    const second = buildGeneratorPreviewRequestKey(
      "same-score",
      generator,
      true,
      "track-b"
    );

    expect(first).not.toBe(second);
    expect(JSON.parse(first)).toEqual({
      switchRequestKey: "same-score",
      generatorConfig: generator,
      enabled: true,
      trackId: "track-a",
    });
  });

  it("invalidates a preview when only the enabled state changes", () => {
    expect(buildGeneratorPreviewRequestKey("same-score", generator, true, null)).not.toBe(
      buildGeneratorPreviewRequestKey("same-score", generator, false, null)
    );
  });

  it("ignores the Dum-Ka canvas extent but includes musical pacing", () => {
    const dumka = normalizePatchGeneratorConfig({
      kind: "dumka",
      planLengthCycles: 12,
      plan: [
        {
          id: 1,
          order: 0,
          enabled: true,
          fromCycle: 1,
          toCycle: 4,
          family: "barlowRemove",
          intensity: 25,
          pacing: "linear",
          scope: null,
          options: {},
        },
      ],
    });
    if (dumka.kind !== "dumka") throw new Error("expected Dum-Ka config");
    const resizedCanvas = { ...dumka, planLengthCycles: 96 };
    const gentle = {
      ...dumka,
      plan: dumka.plan.map((directive) => ({
        ...directive,
        pacing: "easeInOut" as const,
      })),
    };

    expect(
      buildGeneratorPreviewRequestKey("same-score", dumka, true, null)
    ).toBe(
      buildGeneratorPreviewRequestKey("same-score", resizedCanvas, true, null)
    );
    expect(
      buildGeneratorPreviewRequestKey("same-score", dumka, true, null)
    ).not.toBe(
      buildGeneratorPreviewRequestKey("same-score", gentle, true, null)
    );
  });
});

describe("selectGeneratorPreviewTrackId", () => {
  it("uses no track identity on the single-track backend", () => {
    const project = createNeutralPatchDocument({ seed: 1 }).project;
    expect(selectGeneratorPreviewTrackId(project, false, false)).toBeNull();
  });

  it("uses the authored source id when an audible Track Flow box engages", () => {
    const project = createNeutralPatchDocument({ seed: 1 }).project;
    const active = project.tracks[0]!;
    project.global.trackFlowBoxes = [
      {
        id: "main",
        name: "Main",
        memberTrackIds: [active.id],
        chain: defaultTrackFlowChain(),
        seed: 0,
        collapsed: false,
      },
    ];
    expect(selectGeneratorPreviewTrackId(project, false, false)).toBe(active.id);
  });

  it("uses the active authored id for ordinary parallel playback", () => {
    const project = createNeutralPatchDocument({ seed: 1 }).project;
    const active = project.tracks[0]!;
    project.tracks.push({
      ...structuredClone(active),
      id: "track-2",
      name: "Track 2",
    });
    expect(selectGeneratorPreviewTrackId(project, false, false)).toBe(active.id);
  });

  it("uses the follower id when a hidden trigger source engages parallel", () => {
    const project = createNeutralPatchDocument({ seed: 1 }).project;
    const source = project.tracks[0]!;
    source.muted = true;
    const follower = {
      ...structuredClone(source),
      id: "follower",
      name: "Follower",
      muted: false,
      trigger: defaultTriggerConfig(source.id),
    };
    project.tracks.push(follower);
    project.activeTrackId = follower.id;
    expect(selectGeneratorPreviewTrackId(project, false, false)).toBe(follower.id);
  });

  it("keeps the authored id while the pinned parallel runtime is active", () => {
    const project = createNeutralPatchDocument({ seed: 1 }).project;
    expect(selectGeneratorPreviewTrackId(project, true, true)).toBe(
      project.activeTrackId
    );
  });

  it("keeps no identity when a running single backend's topology now engages", () => {
    const project = createNeutralPatchDocument({ seed: 1 }).project;
    const active = project.tracks[0]!;
    project.tracks.push({
      ...structuredClone(active),
      id: "unmuted-during-playback",
      name: "Unmuted during playback",
    });

    expect(selectGeneratorPreviewTrackId(project, false, false)).toBe(active.id);
    expect(selectGeneratorPreviewTrackId(project, false, true)).toBeNull();
  });
});
