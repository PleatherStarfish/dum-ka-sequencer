/**
 * Frontend performance harness. These micro-benchmarks track the hot *pure*
 * paths that run inside App / useChannelShaperState memos
 * on (re)render — the work most likely to show up as a CPU spike in the webview.
 *
 * Run with `npm run bench` (vitest bench). It measures (hz / mean / p99); it is
 * not a pass/fail gate. Pair it with the Rust harness `npm run bench:backend`
 * (the `cseq-bench` crate) for the generative core. See
 * docs/DEVELOPMENT_WORKFLOW.md.
 */
import { bench, describe } from "vitest";

import { automationTargetBuildInput } from "./__fixtures__/automationTargetBuildInput";
import { buildAutomationTargetDefs } from "./automationTargets";
import type { ChannelLogicMatrixEntry } from "./bridge";
import { buildChannelLogicOverrideRows, type ChannelLogicTrackTab } from "./channelLogic";
import { createNeutralPatchDocument } from "./patchIo";
import { channelHocketSpecFromPatch } from "./playbackRequests";

// ---- Shared fixtures (built once, reused across iterations) ----------------

const doc = createNeutralPatchDocument({ seed: 1234, tempoBpm: 90, cycleBeats: 8 });
const channelPatch = {
  ...doc.channelHocket,
  enabled: true,
  channels: [1, 2, 3, 4, 5, 6, 7, 8],
};

const channelEntries: ChannelLogicMatrixEntry[] = [
  { trackAId: "a", trackBId: "b", outputChannel: 1, policy: "priorityOrder" },
  { trackAId: "a", trackBId: "b", outputChannel: 2, policy: "priorityOrder" },
  { trackAId: "a", trackBId: "c", outputChannel: 3, policy: "forceOff" },
  { trackAId: "b", trackBId: "c", outputChannel: null, policy: "priorityOrder" },
];
const channelTabs: ChannelLogicTrackTab[] = ["a", "b", "c"].map((id) => ({
  id,
  name: "",
  midiChannels: [1, 2, 3, 4],
  inspectableMidiChannels: [1, 2, 3, 4, 5, 6],
  channelHocketEnabled: true,
}));

// ---- Benchmarks ------------------------------------------------------------

describe("spec builders", () => {
  bench("channelHocketSpecFromPatch (8 channels)", () => {
    channelHocketSpecFromPatch(channelPatch, doc.sequencer);
  });
});

describe("overlay derivations", () => {
  bench("buildChannelLogicOverrideRows", () => {
    buildChannelLogicOverrideRows(channelEntries, channelTabs);
  });
});

describe("automation targets", () => {
  bench("buildAutomationTargetDefs (full target enumeration)", () => {
    buildAutomationTargetDefs(automationTargetBuildInput);
  });
});
