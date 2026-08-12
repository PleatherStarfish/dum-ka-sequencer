import { expect, test, type Locator, type Page } from "@playwright/test";

import {
  closeMainEditor,
  emitLiveCycle,
  emitNativeMenuAction,
  fillNumeric,
  getDriverState,
  getE2eState,
  openCaesura,
  openMainEditor,
  waitForIdle,
  waitForPlaying,
  waitForTimelineReady,
} from "./support/appHarness";

type PatchDocument = Record<string, unknown> & {
  schemaVersion?: number;
  project?: Record<string, any>;
  sequencer?: Record<string, unknown> & {
    name?: string;
    cycleBeats?: number;
    pitch?: number;
    velocity?: number;
  };
};

function numberInputByLabel(scope: Locator, label: string): Locator {
  return scope
    .locator("label")
    .filter({ hasText: label })
    .locator('[role="spinbutton"]')
    .first();
}

function textInputByLabel(scope: Locator, label: string): Locator {
  return scope
    .locator("label")
    .filter({ hasText: label })
    .locator('input[type="text"]')
    .first();
}

async function waitForCommandCount(
  page: Page,
  command: string,
  count: number
): Promise<void> {
  await page.waitForFunction(
    ({ commandName, expectedCount }) =>
      window.__CAESURA_E2E_DRIVER__
        ?.getState()
        ?.calls.filter((call: { command: string }) => call.command === commandName)
        .length === expectedCount,
    { commandName: command, expectedCount: count }
  );
}

async function waitForCommandAtLeast(
  page: Page,
  command: string,
  count: number
): Promise<void> {
  await page.waitForFunction(
    ({ commandName, expectedCount }) =>
      (window.__CAESURA_E2E_DRIVER__
        ?.getState()
        ?.calls.filter((call: { command: string }) => call.command === commandName)
        .length ?? 0) >= expectedCount,
    { commandName: command, expectedCount: count }
  );
}

async function waitForPreviewRequest(
  page: Page,
  predicate: (request: Record<string, unknown>) => boolean
): Promise<void> {
  await page.waitForFunction(
    (predicateSource) => {
      const request =
        window.__CAESURA_E2E_DRIVER__?.getState()?.lastPreviewRequest?.request;
      const check = new Function("request", `return (${predicateSource})(request);`);
      return Boolean(request && check(request));
    },
    predicate.toString()
  );
}

async function openChannelShaper(page: Page): Promise<Locator> {
  return openMainEditor(page, "channel");
}

async function configureChannelHocketForFallbackRule(page: Page): Promise<void> {
  const panel = await openChannelShaper(page);
  const hocketSwitch = panel.locator(
    'input[type="checkbox"][data-automation-target="channelHocket.enabled"]'
  );
  if (!(await hocketSwitch.isChecked())) {
    await panel.locator(".channel-power-card").click();
    await expect(hocketSwitch).toBeChecked();
  }
  await page.getByLabel("Channel axis count").selectOption("3");
  await panel.getByRole("button", { name: /Matrix/ }).click();
  for (const from of [1, 2, 3]) {
    for (const to of [1, 2, 3]) {
      await fillNumeric(
        panel.getByLabel(`channel weight ${from} to ${to}`),
        to === 1 ? "1" : "0"
      );
    }
  }
  await panel.getByRole("button", { name: /Entry & Fallback/ }).click();
  await fillNumeric(
    panel.locator(
      'input[data-automation-target="channelHocket.fallback.channel.3.weight"]'
    ),
    "5"
  );
  await closeMainEditor(page);
}

async function configureChannelHocketForLogicChannels(
  page: Page,
  count: number
): Promise<void> {
  const panel = await openChannelShaper(page);
  const hocketSwitch = panel.locator(
    'input[type="checkbox"][data-automation-target="channelHocket.enabled"]'
  );
  if (!(await hocketSwitch.isChecked())) {
    await panel.locator(".channel-power-card").click();
    await expect(hocketSwitch).toBeChecked();
  }
  await page.getByLabel("Channel axis count").selectOption(String(count));
  await panel.getByRole("button", { name: /Matrix/ }).click();
  for (let from = 1; from <= count; from += 1) {
    for (let to = 1; to <= count; to += 1) {
      await fillNumeric(panel.getByLabel(`channel weight ${from} to ${to}`), "1");
    }
  }
  await closeMainEditor(page);
}

function minimalPatch(
  sequencer: PatchDocument["sequencer"],
  savedAt = "2026-05-16T12:00:00.000Z"
): PatchDocument {
  return {
    app: "Dum-Ka",
    schemaVersion: 1,
    savedAt,
    transport: {
      tempoBpm: 92,
      synthEnabled: false,
      synthPrograms: [],
      rhythmPlaybackEnabled: true,
      currentScoreId: null,
      cycleTempoFlux: { enabled: false },
    },
    sequencer,
    rhythm: {},
    setup: {
      autosaveEnabled: true,
      autosaveIntervalMs: 3000,
      autoloadRecentSession: false,
    },
  };
}

function richPatch(): PatchDocument {
  return {
    app: "Dum-Ka",
    schemaVersion: 1,
    savedAt: "2026-05-16T13:00:00.000Z",
    transport: {
      tempoBpm: 111,
      synthEnabled: true,
      synthPrograms: [],
      rhythmPlaybackEnabled: false,
      currentScoreId: "rich-score",
      cycleTempoFlux: {
        enabled: true,
        minBpm: 72,
        maxBpm: 132,
        seed: 424242,
        curve: {
          enabled: true,
          points: [
            { position: 0, value: 0.2 },
            { position: 1, value: 0.8 },
          ],
          variance: 0.15,
        },
      },
    },
    sequencer: {
      scoreSetupOpen: true,
      probabilityOpen: true,
      boundariesOpen: true,
      maxSectionsHelpOpen: true,
      name: "rich persistence",
      cycleBeats: 9,
      initialWeights: [
        { subdivision: 5, weight: 4 },
        { subdivision: 7, weight: 2 },
      ],
      initialJathiWeights: [
        { jathi: 3, weight: 2 },
        { jathi: 9, weight: 5 },
      ],
      boundaries: [
        {
          id: "rich-boundary-after-3",
          afterBeat: 3,
          changeProbability: 0.82,
          weights: [
            { subdivision: 4, weight: 1 },
            { subdivision: 7, weight: 3 },
          ],
          jathiWeights: [{ jathi: 3, weight: 6 }],
        },
      ],
      selectedBoundaryAfterBeat: 3,
      sectionCountWeights: [
        { count: 0, weight: 0.25 },
        { count: 1, weight: 3 },
      ],
      seedMode: "locked",
      seed: 98765,
      historySeeds: [10, "9007199254740993", "18446744073709551615"],
      historyWeight: 2,
      newSeedWeight: 4,
      maxHistory: 5,
      singleParameterRhythmicModulation: true,
      pitch: 73,
      velocity: 89,
      accent: {
        beatStart: { min: 6, max: 18 },
        sectionStartExtra: { min: 4, max: 10 },
        jathiStart: { min: 20, max: 34 },
        jathiMode: "layered",
      },
      userPreviewCycle: 2,
    },
    automation: {
      lengthCycles: 3,
      markers: [
        {
          id: "marker-middle",
          time: { numer: 1, denom: 3 },
          label: "middle",
        },
      ],
      tracks: [
        {
          id: "automation-velocity-rich",
          target: "sequencer.velocity",
          enabled: true,
          combine: "replace",
          graphRange: { min: 40, max: 120 },
          curves: [
            {
              id: "velocity-rich-curve",
              enabled: true,
              interpolation: "linear",
              points: [
                {
                  id: "velocity-rich-start",
                  time: { numer: 0, denom: 1 },
                  value: { type: "number", value: 64 },
                  anchorId: "automation-start",
                  outCurve: { kind: "easeInOut", amount: 0.4 },
                },
                {
                  id: "velocity-rich-end",
                  time: { numer: 2, denom: 3 },
                  value: { type: "number", value: 105 },
                  anchorId: null,
                  outCurve: null,
                },
              ],
            },
          ],
        },
      ],
    },
    rhythm: {
      rhythmOpen: true,
      rhythmTab: "ratchet",
      rhythmLength: 5,
      rhythmOrder: "second",
      rhythmExtrapolateFrom: 7,
      rhythmExtrapolationStrategy: "densityPreserving",
      rhythmMaterializeMode: "fillEmpty",
      copyTargetMode: "selected",
      copySelectedTargets: [3, 7],
      passageInput: "5 1 4 2",
      passageStrategy: "hybridVocabulary",
      passageOrder: "second",
      passageFitStrategy: "shapePreserving",
      passageTargetMode: "selected",
      passageSelectedTargets: [5, 7],
      passageHelpOpen: true,
      selectedKeysByLength: {
        5: ["5", "1-4", "2-3"],
      },
      speedEditorKind: "jathi",
      speedEditorValue: 7,
      rhythmSeed: 2468,
      rhythmSeedBehavior: "locked",
      historySeeds: [44, 55],
      historyWeight: 6,
      newSeedWeight: 7,
      maxHistory: 9,
      fallback: 3,
      fallbackMode: "weighted",
      fallbackWeightsByLength: { 5: { "5": 2, "1-4": 4 } },
      entryWeightsByLength: { 5: { "5:second:5>1-4": 8 } },
      weights: { "5:0": 7 },
      articulation: {
        open: true,
        cells: { "5:0": { restProbabilityPercent: 12, tieProbabilityPercent: 34 } },
        tieOverAccentProbabilityPercent: 9,
        restOverAccentProbabilityPercent: 7,
      },
      arbitrarySubdivision: {
        probabilityPercent: 22,
        targets: [{ spanLen: 5, weight: 3 }],
        clumpLengths: [{ count: 2, weight: 4 }],
        allowTrivialPattern: true,
        patternSource: "weightedPool",
        poolWeightsByLength: { 5: { "5": 6, "1-4": 2 } },
        poolEditorLength: 5,
      },
      speedSubdivisionWeights: { "gati:5:firstSpeed": 1, "gati:5:secondSpeed": 2 },
      ratchet: {
        enabled: true,
        spec: {
          seed: 333,
          probability: 0.72,
          speed: { strategy: "matraRate", min: 2, max: 8, distribution: "favorFast" },
          curve: "accelerando",
          curveWeights: {
            even: 0,
            accelerando: 3,
            retardando: 2,
            accelerandoRetardando: 1,
            retardandoAccelerando: 4,
          },
          cooldownMatras: 2,
          cooldownBasis: "beats",
          temporalEasing: 0.21,
          temporalEasingShape: "lilt",
          temporalEasingProbability: 0.82,
          temporalEasingWeights: {
            humanize: 1,
            humanizeTight: 2,
            humanizeLoose: 3,
            subtleAccelerando: 4,
            subtleRetardando: 5,
            sway: 6,
            lilt: 7,
          },
          timeCurve: {
            enabled: true,
            points: [
              { x: 0, y: 0.25 },
              { x: 1, y: 0.75 },
            ],
            variance: 0.12,
            interpolate: false,
            interpolationMin: 0.2,
            interpolationMax: 0.8,
            choices: [
              {
                id: "lineAccel",
                weight: 3,
                points: [
                  { x: 0, y: 0.8 },
                  { x: 1, y: 0.2 },
                ],
              },
            ],
          },
          allowMultiMatra: false,
          maxSpanMatras: 3,
          maxSpanMatrasBySubdivision: [
            { subdivision: 3, maxSpanMatras: 2 },
            { subdivision: 5, maxSpanMatras: 4 },
          ],
          velocity: {
            enabled: true,
            mode: "relative",
            min: -8,
            max: 12,
            center: 2,
            attraction: 0.35,
            sameProbability: 0.2,
          },
          modifiers: {
            slowNote: {
              enabled: true,
              threshold: 2,
              basis: "matras",
              multiplier: 0.5,
              operation: "multiply",
            },
            fastNote: {
              enabled: true,
              threshold: 0.2,
              basis: "percentOfBeat",
              multiplier: 0.15,
              operation: "add",
            },
            accentSpanStart: 1.2,
            accentSpanEnd: 0.8,
            sectionStart: 1.5,
            sectionEnd: 0.7,
            cycleStart: 1.3,
            cycleEnd: 0.6,
            operations: {
              accentSpanStart: "multiply",
              accentSpanEnd: "multiply",
              sectionStart: "multiply",
              sectionEnd: "multiply",
              cycleStart: "multiply",
              cycleEnd: "multiply",
            },
            position: {
              enabled: true,
              points: [
                { position: 0, probability: 1.1, speed: 0.9 },
                { position: 0.5, probability: 0.7, speed: 1.4 },
                { position: 1, probability: 1.3, speed: 0.8 },
              ],
            },
          },
          internalRhythm: { enabled: true, minCount: 2, maxCount: 5 },
        },
      },
      ornament: {
        enabled: true,
        tab: "delay",
        spec: {
          seed: 444,
          grace: {
            enabled: true,
            placement: "beforeBeat",
            placementWeights: { beforeBeat: 40, onBeat: 60 },
            probability: 0.44,
            countWeights: { single: 2, double: 3, triple: 1 },
            duration: 7,
            durationBasis: "milliseconds",
            cooldown: 1,
            cooldownBasis: "beats",
            allowRests: true,
            velocity: {
              enabled: true,
              mode: "absolute",
              min: 55,
              max: 99,
              center: 80,
              attraction: 0.25,
              sameProbability: 0.4,
            },
          },
          delay: {
            enabled: true,
            probability: 0.31,
            quantization: "unquantized",
            distribution: "edges",
            basis: "milliseconds",
            min: 2,
            max: 11,
            tuplets: [
              { tuplet: 3, weight: 5 },
              { tuplet: 5, weight: 0 },
              { tuplet: 7, weight: 2 },
            ],
          },
        },
      },
    },
    pitchShaper: {
      open: true,
      enabled: true,
      tab: "matrix",
      order: "second",
      collectionId: "messiaen3",
      collectionTransposition: 2,
      rangeLow: 50,
      rangeHigh: 76,
      states: [
        { id: 0, label: "root", pitch: 60 },
        { id: 1, label: "upper", pitch: 67 },
      ],
      weights: { "0>1": 5 },
      fallback: 1,
      fallbackMode: "weighted",
      fallbackWeights: { "0": 2, "1": 4 },
      entryWeights: { "second:0>1": 9 },
      seed: 1357,
      seedBehavior: "locked",
      historySeeds: [21, 34],
      historyWeight: 5,
      newSeedWeight: 6,
      maxHistory: 7,
      boundary: { low: 52, high: 74, modulo: 12, policy: "reflect" },
      ratchetMode: "wholeRatchet",
      wholeProbabilityPercent: 66,
      perHitProbabilityPercent: 67,
      preserveFirstHit: false,
      ornamentMode: "wholeOrnament",
      ornamentWholeProbabilityPercent: 77,
      ornamentPerGraceProbabilityPercent: 78,
      gracePitchEnabled: true,
      gracePitchProbabilityPercent: 55,
      gracePitchScope: "perGraceNote",
      gracePitchPitches: [
        { pitch: 62, weight: 3 },
        { pitch: 69, weight: 5 },
      ],
      graceTransposeEnabled: true,
      graceTransposeProbabilityPercent: 45,
      graceTransposeScope: "perGraceNote",
      graceTransposeUpWeight: 4,
      graceTransposeDownWeight: 5,
      graceTransposeIntervals: [
        { semitones: 3, weight: 2 },
        { semitones: 9, weight: 1 },
      ],
      transposeEnabled: true,
      transposeProbabilityPercent: 35,
      transposeMode: "stairStep",
      transposeIntervals: "+7 -5",
      transposeDriveChain: true,
    },
    channelHocket: {
      open: true,
      enabled: true,
      outputChannel: 3,
      order: "second",
      channels: [2, 4, 6],
      weights: { "2>4": 5 },
      fallback: 4,
      fallbackWeights: { "2": 1, "4": 3, "6": 5 },
      entryWeights: { "second:2>4": 7 },
      seed: 97531,
      seedBehavior: "locked",
      historySeeds: [1, 3, 5],
      historyWeight: 2,
      newSeedWeight: 3,
      maxHistory: 4,
      ratchetMode: "wholeRatchet",
      wholeProbabilityPercent: 61,
      perHitProbabilityPercent: 63,
      preserveFirstHit: false,
      ornamentMode: "wholeOrnament",
      ornamentWholeProbabilityPercent: 62,
      ornamentPerGraceProbabilityPercent: 64,
      accentRules: [
        {
          enabled: true,
          label: "Rich accents",
          minVelocity: 90,
          maxVelocity: 127,
          probabilityPercent: 88,
          mode: "driveChain",
          weights: { "2": 1, "4": 4 },
        },
      ],
    },
    setup: {
      open: true,
      tab: "files",
      autosaveEnabled: false,
      autosaveIntervalMs: 1000,
      autoloadRecentSession: false,
    },
    ui: {
      synthPropertiesOpen: true,
      midiDebugOpen: true,
      midiDebugLimit: 40,
      automationDebugOpen: true,
      automationDebugLimit: 20,
      seedSetupOpen: true,
      seedSetupTab: "global",
      seedLogScope: "paths",
      automationOpen: true,
      timelineAutomationTargetIds: ["sequencer.velocity"],
      channelLogicHelpOpen: true,
    },
    seedPaths: [
      {
        id: "rich-seed-path",
        name: "Rich path",
        createdAt: "2026-05-16T13:00:00.000Z",
        sourcePathId: null,
        wildcardRules: [{ domain: "global", cycle: null }],
        trace: [
          {
            cycle: 0,
            domain: "subdivision",
            label: "Subdivision switch",
            seed: 123,
            baseSeed: "18446744073709551615",
            source: "locked",
            historyBefore: [7],
            historyAfter: [123, "18446744073709551615"],
            recordedAt: "2026-05-16T13:01:00.000Z",
          },
        ],
      },
    ],
    scoreSnapshot: { id: "rich-score-snapshot" },
  };
}

function parallelProjectPatch(): PatchDocument {
  const alpha = minimalPatch({
    name: "alpha preserved",
    cycleBeats: 12,
    pitch: 61,
    velocity: 82,
    boundaries: [],
  });
  const beta = minimalPatch({
    name: "beta active",
    cycleBeats: 5,
    pitch: 76,
    velocity: 99,
    boundaries: [],
  });
  return {
    app: "Dum-Ka",
    schemaVersion: 1,
    savedAt: "2026-05-17T07:30:00.000Z",
    project: {
      activeTrackId: "track-beta",
      global: {
        tempoBpm: 88,
        cycleBeats: 12,
        channelConflictPolicy: "xor",
        conflictPriority: ["track-beta", "track-alpha"],
        synthEnabled: false,
        synthPrograms: [],
        rhythmPlaybackEnabled: true,
        cycleTempoFlux: { enabled: false },
      },
      tracks: [
        {
          id: "track-alpha",
          name: "Alpha",
          color: "#7db8bf",
          muted: true,
          soloed: false,
          tempoMode: "global",
          customTempoBpm: 88,
          cycleLengthMode: "global",
          customCycleBeats: 12,
          sequencer: alpha.sequencer,
          automation: { lengthCycles: 2, markers: [], tracks: [] },
          rhythm: alpha.rhythm,
          pitchShaper: {},
          channelHocket: {},
          seedPaths: [],
          scoreSnapshot: { id: "alpha-score" },
        },
        {
          id: "track-beta",
          name: "Beta",
          color: "#d38b3d",
          muted: false,
          soloed: true,
          tempoMode: "custom",
          customTempoBpm: 123,
          cycleLengthMode: "custom",
          customCycleBeats: 5,
          sequencer: beta.sequencer,
          automation: { lengthCycles: 4, markers: [], tracks: [] },
          rhythm: beta.rhythm,
          pitchShaper: {},
          channelHocket: {},
          seedPaths: [
            {
              id: "beta-seed-path",
              name: "Beta path",
              createdAt: "2026-05-17T07:31:00.000Z",
              sourcePathId: null,
              immutable: true,
              wildcardRules: [],
              trace: [],
            },
          ],
          scoreSnapshot: { id: "beta-score" },
        },
      ],
    },
  };
}

function tempoAutomationSet(): Record<string, unknown> {
  return {
    lengthCycles: 1,
    markers: [],
    tracks: [
      {
        id: "automation-transport-tempoBpm",
        target: "transport.tempoBpm",
        enabled: true,
        combine: "replace",
        graphRange: null,
        curves: [
          {
            id: "automation-transport-tempoBpm-curve",
            enabled: true,
            interpolation: "linear",
            points: [
              {
                id: "automation-transport-tempoBpm-start",
                time: { numer: 0, denom: 1 },
                value: { type: "number", value: 80 },
                anchorId: "automation-start",
                outCurve: null,
              },
              {
                id: "automation-transport-tempoBpm-end",
                time: { numer: 1, denom: 1 },
                value: { type: "number", value: 112 },
                anchorId: "automation-end",
                outCurve: null,
              },
            ],
          },
        ],
      },
    ],
  };
}

function parallelAudibleProjectPatch(): PatchDocument {
  const patch = parallelProjectPatch();
  const tracks = patch.project?.tracks as Array<Record<string, unknown>>;
  tracks[0] = {
    ...tracks[0],
    muted: false,
    soloed: false,
    automation: tempoAutomationSet(),
  };
  tracks[1] = { ...tracks[1], soloed: false };
  patch.project = {
    ...patch.project,
    global: {
      ...patch.project?.global,
      channelConflictPolicy: "priorityOrder",
      conflictPriority: ["track-beta", "track-alpha"],
    },
    tracks,
  };
  return patch;
}

function jathiBhedamFixture(seed: number): Record<string, unknown> {
  return {
    enabled: true,
    baseWeight: 1,
    gatiWeights: [],
    lengthBias: null,
    cyclePositionBias: null,
    spec: {
      gati: 4,
      beatsPerCycle: 8,
      cycles: 1,
      seedNumbers: [7, 4, 5, 3, 3, 1, 5],
      fragments: [],
      phrasing: { type: "accent" },
      schedule: { opsPerGeneration: 1, menu: [{ op: "split", weight: 1 }] },
      mukthayPolicy: "padToSam",
      seed,
    },
  };
}

function parallelBhedamPlaybackPatch(): PatchDocument {
  const patch = parallelAudibleProjectPatch();
  const tracks = patch.project?.tracks as Array<Record<string, any>>;
  const beta = tracks.find((track) => track.id === "track-beta");
  if (!beta) throw new Error("missing beta track in parallel fixture");
  beta.sequencer = {
    ...beta.sequencer,
    initialJathiBhedam: jathiBhedamFixture(101),
    boundaries: [
      {
        id: "beta-bhedam-boundary",
        afterBeat: 2,
        changeProbability: 1,
        weights: [{ subdivision: 4, weight: 1 }],
        jathiWeights: [],
        customSubdivision: null,
        jathiBhedam: jathiBhedamFixture(202),
      },
    ],
  };
  return patch;
}

test.describe("patch persistence", () => {
  test("saves to a new patch path, reuses it, and supports Save As", async ({
    page,
  }) => {
    const firstPath = "/tmp/caesura/e2e-first.dumka";
    const secondPath = "/tmp/caesura/e2e-second.dumka";

    await openCaesura(page, {
      autosaveEnabledPreference: false,
      setupPreferences: { autosaveEnabled: false, autoloadRecentSession: false },
      saveDialogResponses: [firstPath, secondPath],
    });

    await page.getByRole("button", { name: "Save" }).click();
    await waitForCommandCount(page, "patch_save_to_path", 1);

    let driver = await getDriverState(page);
    expect(driver.dialogHistory.filter((entry) => entry.kind === "save")).toHaveLength(
      1
    );
    expect(driver.lastPatchSave?.path).toBe(firstPath);
    const firstSave = driver.patchFiles[firstPath] as PatchDocument;
    expect(firstSave.app).toBe("Dum-Ka");
    expect(firstSave.schemaVersion).toBe(1);
    expect(firstSave.project?.tracks).toHaveLength(1);
    expect(firstSave.project?.tracks[0]).toMatchObject({
      id: "track-1",
      muted: false,
      soloed: false,
      tempoMode: "global",
      cycleLengthMode: "global",
    });
    await expect(page.locator(".patch-file-readout")).toContainText("saved");
    await expect(page.locator(".patch-file-readout")).toContainText("e2e-first");

    await page.getByRole("button", { name: "Save" }).click();
    await waitForCommandCount(page, "patch_save_to_path", 2);

    driver = await getDriverState(page);
    expect(driver.dialogHistory.filter((entry) => entry.kind === "save")).toHaveLength(
      1
    );
    expect(driver.lastPatchSave?.path).toBe(firstPath);

    await emitNativeMenuAction(page, "savePatchAs");
    await waitForCommandCount(page, "patch_save_to_path", 3);

    driver = await getDriverState(page);
    expect(driver.dialogHistory.filter((entry) => entry.kind === "save")).toHaveLength(
      2
    );
    expect(driver.lastPatchSave?.path).toBe(secondPath);
    await expect(page.locator(".patch-file-readout")).toContainText("e2e-second");
  });

  test("autoloaded saved patch seed wins over the locked new-session seed", async ({
    page,
  }) => {
    const patchPath = "/tmp/caesura/saved-seed.dumka";
    await openCaesura(page, {
      globalSeedStartupLock: { locked: true, seed: 314159 },
      setupPreferences: { autosaveEnabled: false, autoloadRecentSession: true },
      lastPatchPath: patchPath,
      recentPatches: [{ path: patchPath, name: "saved seed patch" }],
      patchFiles: {
        [patchPath]: minimalPatch({
          name: "saved seed patch",
          seedMode: "locked",
          seed: 424242,
        }),
      },
    });

    await waitForPreviewRequest(
      page,
      (request) => request.name === "saved seed patch" && request.seed === 424242
    );

    const storedPreference = await page.evaluate(() =>
      JSON.parse(
        window.localStorage.getItem("caesura.globalSeedStartupLock.v1") ?? "{}"
      )
    );
    expect(storedPreference).toMatchObject({ locked: true, seed: 314159 });
  });

  test("assigns a fresh top-level seed when creating a new track", async ({
    page,
  }) => {
    const savePath = "/tmp/caesura/e2e-fresh-track-seed.dumka";
    await openCaesura(page, {
      autosaveEnabledPreference: false,
      setupPreferences: { autosaveEnabled: false, autoloadRecentSession: false },
      globalSeedStartupLock: { locked: true, seed: 314159 },
      saveDialogResponses: [savePath],
    });

    await page
      .locator(".parallel-track-actions")
      .getByRole("button", { name: "New track", exact: true })
      .click();
    await expect(page.locator(".success-banner")).toContainText("Added track");
    await expect(page.getByTestId("parallel-track-tab-track-2")).toBeVisible();

    await emitNativeMenuAction(page, "savePatchAs");
    await waitForCommandCount(page, "patch_save_to_path", 1);

    const driver = await getDriverState(page);
    const saved = driver.lastPatchSave?.patch as PatchDocument;
    const tracks = saved.project?.tracks as Array<{
      id?: string;
      sequencer?: { seed?: number; historySeeds?: string[] };
    }>;
    const tracksById = new Map((tracks ?? []).map((track) => [track.id, track]));
    const sourceTrack = tracksById.get("track-1");
    const newTrack = tracksById.get("track-2");

    expect(driver.lastPatchSave?.path).toBe(savePath);
    expect(sourceTrack?.sequencer?.seed).toBe(314159);
    expect(newTrack?.sequencer?.seed).toEqual(expect.any(Number));
    expect(newTrack?.sequencer?.seed).not.toBe(314159);
    expect(newTrack?.sequencer?.historySeeds).toEqual([]);
  });

  test("rejects a new-track snapshot when authored state changes during its build", async ({
    page,
  }) => {
    await openCaesura(page, {
      autosaveEnabledPreference: false,
      setupPreferences: { autosaveEnabled: false, autoloadRecentSession: false },
      commandDelayMs: { score_get_current: 500 },
    });

    const beforeScoreReads = (await getDriverState(page)).calls.filter(
      (call) => call.command === "score_get_current"
    ).length;
    await page
      .locator(".parallel-track-actions")
      .getByRole("button", { name: "New track", exact: true })
      .click();
    await waitForCommandAtLeast(page, "score_get_current", beforeScoreReads + 1);

    // The delayed build already captured its coherent patch. This input event
    // advances the authoring generation, so the older structure action must
    // not overwrite the edit when score_get_current resolves.
    await fillNumeric(page.getByLabel("Tempo"), "97");

    await expect(page.locator(".success-banner")).toContainText(
      "Track changed while adding the track; try again"
    );
    await expect(page.locator(".parallel-track-cell")).toHaveCount(1);
    await expect(page.getByLabel("Tempo")).toHaveValue(/^97(?:\.0)?$/);
  });

  test("allows a coherent new-track snapshot across a transport-derived rerender", async ({
    page,
  }) => {
    await openCaesura(page, {
      autosaveEnabledPreference: false,
      setupPreferences: { autosaveEnabled: false, autoloadRecentSession: false },
      commandDelayMs: { score_get_current: 500 },
    });

    const beforeScoreReads = (await getDriverState(page)).calls.filter(
      (call) => call.command === "score_get_current"
    ).length;
    await page
      .locator(".parallel-track-actions")
      .getByRole("button", { name: "New track", exact: true })
      .click();
    await waitForCommandAtLeast(page, "score_get_current", beforeScoreReads + 1);

    // This backend event changes the live authored-tempo projection without a
    // user gesture. The build remains the coherent snapshot captured before
    // its await. Re-capturing the fingerprint here would falsely reject it;
    // comparing with the fingerprint captured beside the build must allow it.
    await page.evaluate(async () => {
      await window.__CAESURA_E2E_DRIVER__?.invoke("transport_set_tempo", {
        bpm: 97,
      });
    });
    await expect(page.getByLabel("Tempo")).toHaveValue(/^97(?:\.0)?$/);

    await expect(page.locator(".success-banner")).toContainText("Added track");
    await expect(page.locator(".parallel-track-cell")).toHaveCount(2);
    await expect(page.getByTestId("parallel-track-tab-track-2")).toBeVisible();
  });

  test("keeps a custom track BPM when playback starts", async ({ page }) => {
    const savePath = "/tmp/caesura/e2e-track-custom-bpm.dumka";
    await openCaesura(page, {
      autosaveEnabledPreference: false,
      setupPreferences: { autosaveEnabled: false, autoloadRecentSession: false },
      saveDialogResponses: [savePath],
    });

    await page
      .locator(".parallel-track-actions")
      .getByRole("button", { name: "New track", exact: true })
      .click();
    await expect(page.locator(".success-banner")).toContainText("Added track");
    await page.getByLabel("Track BPM mode").selectOption("custom");
    await expect(page.locator(".success-banner")).toContainText("custom");

    const tempoSetCountBeforeCustomEdit = (
      await getDriverState(page)
    ).calls.filter((call) => call.command === "transport_set_tempo").length;
    const trackBpmInput = page.getByLabel("Track custom BPM");
    await trackBpmInput.fill("123");
    await trackBpmInput.blur();
    await expect(page.locator(".success-banner")).toContainText("Updated track BPM");
    await expect(trackBpmInput).toHaveValue("123");
    await expect(page.getByLabel("Tempo")).toHaveValue("80");

    let driver = await getDriverState(page);
    const tempoSetCallsAfterCustomEdit = driver.calls.filter(
      (call) => call.command === "transport_set_tempo"
    );
    expect(tempoSetCallsAfterCustomEdit).toHaveLength(
      tempoSetCountBeforeCustomEdit
    );
    expect(driver.snapshot.tempoBpm).toBe(80);

    await emitNativeMenuAction(page, "savePatchAs");
    await waitForCommandCount(page, "patch_save_to_path", 1);
    driver = await getDriverState(page);
    const saved = driver.lastPatchSave?.patch as PatchDocument & {
      transport?: { tempoBpm?: number };
      project?: {
        global?: { tempoBpm?: number };
        tracks?: Array<{
          id?: string;
          customTempoBpm?: number;
          tempoMode?: string;
        }>;
      };
    };
    const savedTrack = saved.project?.tracks?.find(
      (track) => track.id === "track-2"
    );
    expect(driver.lastPatchSave?.path).toBe(savePath);
    expect(saved.project?.global?.tempoBpm).toBe(80);
    expect(saved.transport?.tempoBpm).toBe(123);
    expect(savedTrack).toMatchObject({
      tempoMode: "custom",
      customTempoBpm: 123,
    });

    await waitForTimelineReady(page);
    await page.getByTestId("transport-play").click();
    await waitForPlaying(page);
    await expect(trackBpmInput).toHaveValue("123");
    await expect(page.getByLabel("Tempo")).toHaveValue("80");

    driver = await getDriverState(page);
    const request = driver.lastParallelPlaybackRequest as
      | {
          referenceTempoBpm?: number;
          tracks?: Array<{ id?: string; tempoBpm?: number }>;
        }
      | null;
    const activeTrackRequest = request?.tracks?.find((track) => track.id === "track-2");
    expect(request?.referenceTempoBpm).toBe(80);
    expect(activeTrackRequest?.tempoBpm).toBe(123);
  });

  test("custom track BPM survives reference-tempo snapshots and active-track switches", async ({
    page,
  }) => {
    // Regression for the BPM/clock leak class. The transport snapshot reports
    // the global/reference tempo (80) in multi-track mode, and that snapshot
    // arrives on an async event that can land mid-transition. This test pushes
    // reference-tempo snapshots through the exact windows where a track-local
    // custom BPM (123) used to be clobbered, and asserts none of the four
    // failure conditions occur:
    //   1. transport_set_tempo(123) is never called from a track-BPM edit.
    //   2. project.global.tempoBpm never becomes 123.
    //   3. the visible Global BPM field never shows 123.
    //   4. Track 2 never loses its custom BPM (on snapshot, tab switch, or play).
    const savePath = "/tmp/caesura/e2e-track-custom-bpm-race.dumka";
    await openCaesura(page, {
      autosaveEnabledPreference: false,
      setupPreferences: { autosaveEnabled: false, autoloadRecentSession: false },
      saveDialogResponses: [savePath],
    });

    const globalTempoField = page.getByLabel("Tempo");
    const trackBpmInput = page.getByLabel("Track custom BPM");

    await page
      .locator(".parallel-track-actions")
      .getByRole("button", { name: "New track", exact: true })
      .click();
    await expect(page.locator(".success-banner")).toContainText("Added track");
    await page.getByLabel("Track BPM mode").selectOption("custom");
    await expect(page.locator(".success-banner")).toContainText("custom");

    const tempoSetCallArgs = (driver: { calls: Array<{ command: string; args?: unknown }> }) =>
      driver.calls
        .filter((call) => call.command === "transport_set_tempo")
        .map((call) => Number((call.args as { bpm?: unknown } | undefined)?.bpm));
    const tempoSetCountBefore = tempoSetCallArgs(await getDriverState(page)).length;

    await trackBpmInput.fill("123");
    await trackBpmInput.blur();
    await expect(page.locator(".success-banner")).toContainText("Updated track BPM");
    await expect(trackBpmInput).toHaveValue("123");
    await expect(globalTempoField).toHaveValue("80");

    // A reference-tempo (80) snapshot arriving while Track 2 is the active
    // custom track must not overwrite the track-local field with 80.
    await emitLiveCycle(page, 0);
    await emitLiveCycle(page, 1);
    await expect(trackBpmInput).toHaveValue("123");
    await expect(globalTempoField).toHaveValue("80");
    await page.getByTestId("transport-stop").click();
    await waitForIdle(page);

    // Switch away to a global-follow track and back while stopped. The custom
    // value must be preserved across the round trip and across snapshots.
    await page.getByTestId("parallel-track-tab-track-1").click();
    await emitLiveCycle(page, 0);
    await expect(globalTempoField).toHaveValue("80");
    await page.getByTestId("parallel-track-tab-track-2").click();
    await emitLiveCycle(page, 0);
    await expect(trackBpmInput).toHaveValue("123");
    await expect(globalTempoField).toHaveValue("80");
    await page.getByTestId("transport-stop").click();
    await waitForIdle(page);

    let driver = await getDriverState(page);
    const tempoSetArgs = tempoSetCallArgs(driver);
    expect(tempoSetArgs.every((bpm) => bpm === 80)).toBe(true);
    expect(tempoSetArgs.length).toBeGreaterThanOrEqual(tempoSetCountBefore);
    expect(tempoSetArgs).not.toContain(123);
    expect(driver.snapshot.tempoBpm).toBe(80);

    // Persisted project keeps the reference/global tempo at 80 while the flat
    // active-editor tempo may be 123 (active-editor flattening only).
    await emitNativeMenuAction(page, "savePatchAs");
    await waitForCommandCount(page, "patch_save_to_path", 1);
    driver = await getDriverState(page);
    const saved = driver.lastPatchSave?.patch as PatchDocument & {
      transport?: { tempoBpm?: number };
      project?: {
        global?: { tempoBpm?: number };
        tracks?: Array<{ id?: string; customTempoBpm?: number; tempoMode?: string }>;
      };
    };
    expect(saved.project?.global?.tempoBpm).toBe(80);
    expect(saved.transport?.tempoBpm).toBe(123);
    expect(
      saved.project?.tracks?.find((track) => track.id === "track-2")
    ).toMatchObject({ tempoMode: "custom", customTempoBpm: 123 });

    // Start playback, then push a reference-tempo snapshot while playing and
    // confirm the custom track field still holds 123 and the request carries
    // reference 80 plus track 123.
    await waitForTimelineReady(page);
    await page.getByTestId("transport-play").click();
    await waitForPlaying(page);
    await emitLiveCycle(page, 1);
    await expect(trackBpmInput).toHaveValue("123");
    await expect(globalTempoField).toHaveValue("80");

    await page.waitForFunction(
      () =>
        window.__CAESURA_E2E_DRIVER__?.getState()?.lastParallelPlaybackRequest
          ?.referenceTempoBpm === 80
    );
    driver = await getDriverState(page);
    const request = driver.lastParallelPlaybackRequest as
      | {
          referenceTempoBpm?: number;
          tracks?: Array<{ id?: string; tempoBpm?: number }>;
        }
      | null;
    expect(request?.referenceTempoBpm).toBe(80);
    expect(request?.tracks?.find((track) => track.id === "track-2")?.tempoBpm).toBe(123);

    // Final guard across the whole interaction: the global/reference tempo was
    // never mutated to the custom value through any path.
    expect(tempoSetCallArgs(driver)).not.toContain(123);
    expect(driver.snapshot.tempoBpm).toBe(80);
  });

  test("editing the global BPM while the active track is custom never touches the track BPM", async ({
    page,
  }) => {
    // Symmetric direction of the coupling bug: editing the top Global BPM field
    // must move only the reference/global tempo. The active custom track's BPM
    // (123) must not change, and because the active track is custom, the global
    // edit must not sync the transport (no transport_set_tempo) while stopped.
    const loadPath = "/tmp/caesura/e2e-global-edit-custom-active.dumka";
    const savePath = "/tmp/caesura/e2e-global-edit-custom-active-saved.dumka";

    await openCaesura(page, {
      autosaveEnabledPreference: false,
      setupPreferences: { autosaveEnabled: false, autoloadRecentSession: false },
      openDialogResponses: [loadPath],
      saveDialogResponses: [savePath],
      patchFiles: { [loadPath]: parallelProjectPatch() },
    });

    await page.getByRole("button", { name: "Recall" }).click();
    await waitForPreviewRequest(
      page,
      (request) => request.name === "beta active" && request.pitch === 76
    );
    await waitForTimelineReady(page);

    const globalTempoField = page.getByLabel("Tempo");
    const trackBpmInput = page.getByLabel("Track custom BPM");
    await expect(globalTempoField).toHaveValue("88");
    await expect(trackBpmInput).toHaveValue("123");

    const tempoSetCallArgs = (driver: { calls: Array<{ command: string; args?: unknown }> }) =>
      driver.calls
        .filter((call) => call.command === "transport_set_tempo")
        .map((call) => Number((call.args as { bpm?: unknown } | undefined)?.bpm));
    const tempoSetCountBefore = tempoSetCallArgs(await getDriverState(page)).length;

    await globalTempoField.fill("96");
    await globalTempoField.blur();
    await expect(page.locator(".success-banner")).toContainText("Updated global BPM");

    // The active custom track is untouched; the global field reflects 96.
    await expect(trackBpmInput).toHaveValue("123");
    await expect(globalTempoField).toHaveValue("96");

    // Stopped + active track custom => global edit must not sync the transport.
    let driver = await getDriverState(page);
    expect(tempoSetCallArgs(driver)).toHaveLength(tempoSetCountBefore);

    await emitNativeMenuAction(page, "savePatchAs");
    await waitForCommandCount(page, "patch_save_to_path", 1);
    driver = await getDriverState(page);
    const saved = driver.lastPatchSave?.patch as PatchDocument & {
      transport?: { tempoBpm?: number };
      project?: {
        global?: { tempoBpm?: number };
        tracks?: Array<{ id?: string; customTempoBpm?: number; tempoMode?: string }>;
      };
    };
    expect(saved.project?.global?.tempoBpm).toBe(96);
    // Flat editor tempo still flattens the active custom track (123), not 96.
    expect(saved.transport?.tempoBpm).toBe(123);
    expect(
      saved.project?.tracks?.find((track) => track.id === "track-beta")
    ).toMatchObject({ tempoMode: "custom", customTempoBpm: 123 });

    // Start playback: the edited global value remains visible and the track stays 123.
    await page.getByTestId("transport-play").click();
    await waitForPlaying(page);
    await expect(trackBpmInput).toHaveValue("123");
    await expect(globalTempoField).toHaveValue("96");

    driver = await getDriverState(page);
    expect(tempoSetCallArgs(driver)).not.toContain(123);
  });

  test("recalls a saved patch and leaves state untouched when Recall is canceled", async ({
    page,
  }) => {
    const patchPath = "/tmp/caesura/e2e-roundtrip.dumka";

    await openCaesura(page, {
      autosaveEnabledPreference: false,
      setupPreferences: { autosaveEnabled: false, autoloadRecentSession: false },
      saveDialogResponses: [patchPath],
      openDialogResponses: [null, patchPath],
    });

    const setup = await openMainEditor(page, "boundaries");
    await textInputByLabel(setup, "Cycle name").fill("saved roundtrip");
    await fillNumeric(numberInputByLabel(setup, "Beats/cycle"), "7");
    await fillNumeric(numberInputByLabel(setup, "Pitch"), "74");
    await fillNumeric(numberInputByLabel(setup, "Velocity"), "91");
    await waitForPreviewRequest(
      page,
      (request) => request.name === "saved roundtrip" && request.cycleBeats === 7
    );

    await closeMainEditor(page);
    await page.getByRole("button", { name: "Save" }).click();
    await waitForCommandCount(page, "patch_save_to_path", 1);

    const mutatedSetup = await openMainEditor(page, "boundaries");
    await textInputByLabel(mutatedSetup, "Cycle name").fill("mutated after save");
    await fillNumeric(numberInputByLabel(mutatedSetup, "Pitch"), "52");
    await waitForPreviewRequest(
      page,
      (request) => request.name === "mutated after save" && request.pitch === 52
    );

    await closeMainEditor(page);
    await page.getByRole("button", { name: "Recall" }).click();
    await page.waitForFunction(
      () =>
        window.__CAESURA_E2E_DRIVER__
          ?.getState()
          ?.dialogHistory.filter((entry: { kind: string }) => entry.kind === "open")
          .length === 1
    );

    let driver = await getDriverState(page);
    expect(driver.lastPatchLoadPath).toBeNull();
    expect(driver.lastPreviewRequest?.request).toMatchObject({
      name: "mutated after save",
      pitch: 52,
    });

    await page.getByRole("button", { name: "Recall" }).click();
    await page.waitForFunction(
      (path) =>
        window.__CAESURA_E2E_DRIVER__?.getState()?.lastPatchLoadPath === path,
      patchPath
    );
    await waitForPreviewRequest(
      page,
      (request) =>
        request.name === "saved roundtrip" &&
        request.cycleBeats === 7 &&
        request.pitch === 74 &&
        request.velocity === 91
    );
    await waitForTimelineReady(page);

    driver = await getDriverState(page);
    expect(driver.lastPreviewRequest?.request).toMatchObject({
      name: "saved roundtrip",
      cycleBeats: 7,
      pitch: 74,
      velocity: 91,
    });
    await expect(page.locator(".success-banner")).toContainText("Recalled patch");
  });

  test("keeps edits typed during Save build and recovery cleanup marked unsaved", async ({
    page,
  }) => {
    const patchPath = "/tmp/caesura/e2e-save-draft-race.dumka";
    await openCaesura(page, {
      autosaveEnabledPreference: false,
      setupPreferences: { autosaveEnabled: false, autoloadRecentSession: false },
      saveDialogResponses: [patchPath],
      commandDelayMs: {
        score_get_current: 350,
        patch_clear_autosave: 500,
      },
    });

    // Let the startup recovery cleanup finish so the next clear belongs to
    // this manual save and can be held deterministically.
    await waitForCommandAtLeast(page, "patch_clear_autosave", 1);
    await page.waitForTimeout(550);

    const sections = await openMainEditor(page, "boundaries");
    const nameInput = textInputByLabel(sections, "Cycle name");
    await nameInput.fill("save snapshot");

    const beforeScoreReads = (await getDriverState(page)).calls.filter(
      (call) => call.command === "score_get_current"
    ).length;
    const beforeRecoveryClears = (await getDriverState(page)).calls.filter(
      (call) => call.command === "patch_clear_autosave"
    ).length;
    await emitNativeMenuAction(page, "savePatch");
    await waitForCommandAtLeast(page, "score_get_current", beforeScoreReads + 1);

    // This remains a focused component-local draft while score_get_current is
    // delayed, so the authored React fingerprint alone cannot observe it.
    await nameInput.fill("typed while save waited");
    await waitForCommandCount(page, "patch_save_to_path", 1);
    await waitForCommandAtLeast(
      page,
      "patch_clear_autosave",
      beforeRecoveryClears + 1
    );
    await nameInput.fill("typed while recovery clear waited");
    await expect(page.locator(".success-banner")).toContainText(
      "Newer edits remain unsaved"
    );

    const driver = await getDriverState(page);
    const saved = driver.lastPatchSave?.patch as PatchDocument;
    expect(saved.sequencer?.name).toBe("save snapshot");
    await expect(nameInput).toHaveValue("typed while recovery clear waited");
    await expect(page.locator(".patch-file-readout")).toHaveClass(/is-unsaved/);
  });

  test("does not claim an autosave is current when typing continues during its write", async ({
    page,
  }) => {
    await openCaesura(page, {
      autosaveEnabledPreference: true,
      setupPreferences: {
        autosaveEnabled: true,
        autosaveIntervalMs: 3000,
        autoloadRecentSession: false,
      },
      commandDelayMs: { patch_autosave: 500 },
    });

    const sections = await openMainEditor(page, "boundaries");
    const nameInput = textInputByLabel(sections, "Cycle name");
    await nameInput.fill("autosave snapshot");
    await nameInput.press("Enter");

    await waitForCommandAtLeast(page, "patch_autosave", 1);
    await nameInput.fill("typed while autosave waited");
    await page.waitForFunction(
      () =>
        (
          window.__CAESURA_E2E_DRIVER__?.getState()?.lastAutosavePatch as
            | { sequencer?: { name?: string } }
            | null
        )?.sequencer?.name === "autosave snapshot"
    );

    await expect(nameInput).toHaveValue("typed while autosave waited");
    await expect(page.locator(".patch-file-readout")).toHaveClass(/is-unsaved/);
  });

  test("keeps a local edit made during Recall cleanup visibly unsaved", async ({
    page,
  }) => {
    const patchPath = "/tmp/caesura/e2e-recall-draft-race.dumka";
    await openCaesura(page, {
      autosaveEnabledPreference: false,
      setupPreferences: { autosaveEnabled: false, autoloadRecentSession: false },
      saveDialogResponses: [patchPath],
      openDialogResponses: [patchPath],
      commandDelayMs: { patch_clear_autosave: 500 },
    });

    await waitForCommandAtLeast(page, "patch_clear_autosave", 1);
    await page.waitForTimeout(550);
    const sections = await openMainEditor(page, "boundaries");
    const nameInput = textInputByLabel(sections, "Cycle name");
    await nameInput.fill("recalled snapshot");
    await emitNativeMenuAction(page, "savePatch");
    await waitForCommandCount(page, "patch_save_to_path", 1);
    await waitForCommandAtLeast(page, "patch_clear_autosave", 2);
    await expect(page.locator(".success-banner")).toContainText("Saved patch");

    await nameInput.fill("outgoing mutation");
    await nameInput.press("Enter");
    await waitForPreviewRequest(
      page,
      (request) => request.name === "outgoing mutation"
    );
    const clearsBeforeRecall = (await getDriverState(page)).calls.filter(
      (call) => call.command === "patch_clear_autosave"
    ).length;

    await emitNativeMenuAction(page, "recallPatch");
    await waitForCommandAtLeast(page, "patch_load_from_path", 1);
    await waitForCommandAtLeast(
      page,
      "patch_clear_autosave",
      clearsBeforeRecall + 1
    );
    await expect(nameInput).toHaveValue("recalled snapshot");
    await nameInput.fill("typed while recall cleanup waited");

    await expect(page.locator(".success-banner")).toContainText(
      "Newer edits remain unsaved"
    );
    await expect(page.locator(".patch-file-readout")).toHaveClass(/is-unsaved/);
    await expect(nameInput).toHaveValue("typed while recall cleanup waited");
  });

  test("loads a v1 project active track and preserves inactive tracks when saving", async ({
    page,
  }) => {
    const loadPath = "/tmp/caesura/e2e-parallel.dumka";
    const savePath = "/tmp/caesura/e2e-parallel-saved.dumka";

    await openCaesura(page, {
      autosaveEnabledPreference: false,
      setupPreferences: { autosaveEnabled: false, autoloadRecentSession: false },
      openDialogResponses: [loadPath],
      saveDialogResponses: [savePath],
      patchFiles: { [loadPath]: parallelProjectPatch() },
    });

    await page.getByRole("button", { name: "Recall" }).click();
    await page.waitForFunction(
      (path) =>
        window.__CAESURA_E2E_DRIVER__?.getState()?.lastPatchLoadPath === path,
      loadPath
    );
    await waitForPreviewRequest(
      page,
      (request) =>
        request.name === "beta active" &&
        request.cycleBeats === 5 &&
        request.pitch === 76 &&
        request.velocity === 99
    );

    const setup = await openMainEditor(page, "boundaries");
    await textInputByLabel(setup, "Cycle name").fill("beta edited");
    await fillNumeric(numberInputByLabel(setup, "Pitch"), "79");
    await waitForPreviewRequest(
      page,
      (request) => request.name === "beta edited" && request.pitch === 79
    );

    await closeMainEditor(page);
    await emitNativeMenuAction(page, "savePatchAs");
    await waitForCommandCount(page, "patch_save_to_path", 1);

    const driver = await getDriverState(page);
    const saved = driver.lastPatchSave?.patch as PatchDocument;
    expect(saved.schemaVersion).toBe(1);
    expect(saved.project?.activeTrackId).toBe("track-beta");
    expect(saved.project?.global).toMatchObject({
      tempoBpm: 88,
      cycleBeats: 12,
      channelConflictPolicy: "xor",
      conflictPriority: ["track-beta", "track-alpha"],
    });
    expect(saved.project?.tracks).toHaveLength(2);
    expect(saved.project?.tracks[0]).toMatchObject({
      id: "track-alpha",
      name: "Alpha",
      muted: true,
      sequencer: { name: "alpha preserved", cycleBeats: 12, basePitch: 61 },
    });
    expect(saved.project?.tracks[1]).toMatchObject({
      id: "track-beta",
      name: "Beta",
      soloed: true,
      tempoMode: "custom",
      customTempoBpm: 123,
      cycleLengthMode: "custom",
      customCycleBeats: 5,
      sequencer: { name: "beta edited", cycleBeats: 5, basePitch: 79 },
      seedPaths: [{ id: "beta-seed-path" }],
    });
    expect(saved.project?.tracks[0]).not.toHaveProperty("scoreSnapshot");
  });

  test("switches v1 project tabs and saves edits to the active track", async ({
    page,
  }) => {
    const loadPath = "/tmp/caesura/e2e-parallel-tabs.dumka";
    const savePath = "/tmp/caesura/e2e-parallel-tabs-saved.dumka";

    await openCaesura(page, {
      autosaveEnabledPreference: false,
      setupPreferences: { autosaveEnabled: false, autoloadRecentSession: false },
      openDialogResponses: [loadPath],
      saveDialogResponses: [savePath],
      patchFiles: { [loadPath]: parallelProjectPatch() },
    });

    await page.getByRole("button", { name: "Recall" }).click();
    await waitForPreviewRequest(
      page,
      (request) => request.name === "beta active" && request.pitch === 76
    );

    await expect(page.getByTestId("parallel-track-tab-track-alpha")).toBeVisible();
    await expect(page.getByTestId("parallel-track-tab-track-beta")).toBeVisible();

    await page.getByTestId("parallel-track-tab-track-alpha").click();
    await waitForPreviewRequest(
      page,
      (request) =>
        request.name === "alpha preserved" &&
        request.cycleBeats === 12 &&
        request.pitch === 61
    );

    const setup = await openMainEditor(page, "boundaries");
    await textInputByLabel(setup, "Cycle name").fill("alpha edited");
    await fillNumeric(numberInputByLabel(setup, "Pitch"), "64");
    await waitForPreviewRequest(
      page,
      (request) => request.name === "alpha edited" && request.pitch === 64
    );

    await closeMainEditor(page);
    await page.getByTestId("parallel-track-tab-track-beta").click();
    await waitForPreviewRequest(
      page,
      (request) =>
        request.name === "beta active" &&
        request.cycleBeats === 5 &&
        request.pitch === 76
    );

    await emitNativeMenuAction(page, "savePatchAs");
    await waitForCommandCount(page, "patch_save_to_path", 1);

    const driver = await getDriverState(page);
    const saved = driver.lastPatchSave?.patch as PatchDocument;
    expect(saved.project?.activeTrackId).toBe("track-beta");
    expect(saved.project?.tracks).toHaveLength(2);
    expect(saved.project?.tracks[0]).toMatchObject({
      id: "track-alpha",
      sequencer: { name: "alpha edited", cycleBeats: 12, basePitch: 64 },
    });
    expect(saved.project?.tracks[1]).toMatchObject({
      id: "track-beta",
      sequencer: { name: "beta active", cycleBeats: 5, basePitch: 76 },
    });
  });

  test("starts v1 project playback with all audible parallel tracks", async ({
    page,
  }) => {
    const loadPath = "/tmp/caesura/e2e-parallel-playback.dumka";

    await openCaesura(page, {
      autosaveEnabledPreference: false,
      setupPreferences: { autosaveEnabled: false, autoloadRecentSession: false },
      openDialogResponses: [loadPath],
      patchFiles: { [loadPath]: parallelAudibleProjectPatch() },
    });

    await page.getByRole("button", { name: "Recall" }).click();
    await waitForPreviewRequest(
      page,
      (request) => request.name === "beta active" && request.pitch === 76
    );
    await waitForTimelineReady(page);
    await expect(page.getByLabel("Tempo")).toHaveValue("88");
    await expect(page.getByLabel("Project cycle")).toHaveValue("12");
    await expect(page.getByLabel("Track custom BPM")).toHaveValue("123");
    await expect(page.getByLabel("Track custom cycle")).toHaveValue("5");
    await expect(page.getByLabel("Track automation cycles")).toHaveValue("4");
    await expect(page.getByTestId("parallel-track-tab-track-alpha")).not.toContainText(
      "80-112 BPM auto"
    );
    await expect(page.getByTestId("parallel-track-tab-track-beta")).toContainText(
      "123 BPM"
    );
    await expect(
      page.getByTestId("parallel-priority-track-beta").locator("b")
    ).toHaveText("1");
    await page.getByTestId("parallel-priority-track-beta-down").click();
    await expect(page.locator(".success-banner")).toContainText(
      "Updated priority order"
    );
    await expect(
      page.getByTestId("parallel-priority-track-alpha").locator("b")
    ).toHaveText("1");
    await expect(
      page.getByTestId("parallel-priority-track-beta").locator("b")
    ).toHaveText("2");

    await page.getByTestId("transport-play").click();
    await waitForCommandAtLeast(page, "parallel_set_playback", 1);
    await waitForCommandAtLeast(page, "transport_play", 1);

    const driver = await getDriverState(page);
    const request = driver.lastParallelPlaybackRequest as {
      referenceTempoBpm: number;
      referenceCycleBeats: number;
      tracks: Array<{
        id: string;
        name: string;
        tempoBpm: number;
        score: { name: string; cycleBeats: number; pitch: number };
        playback: { midiOutputChannel: number; automation: { tracks: unknown[] } | null };
      }>;
      channelConflictPolicy: string;
      conflictPriority: string[];
    };
    expect(request.referenceTempoBpm).toBe(88);
    expect(request.referenceCycleBeats).toBe(12);
    expect(request.channelConflictPolicy).toBe("priorityOrder");
    expect(request.conflictPriority).toEqual(["track-alpha", "track-beta"]);
    expect(request.tracks.map((track) => track.id)).toEqual([
      "track-beta",
      "track-alpha",
    ]);
    expect(request.tracks[0]).toMatchObject({
      id: "track-beta",
      name: "Beta",
      tempoBpm: 123,
      score: { name: "beta active", cycleBeats: 5, pitch: 76 },
      playback: { midiOutputChannel: 1 },
    });
    expect(request.tracks[1]).toMatchObject({
      id: "track-alpha",
      name: "Alpha",
      tempoBpm: 88,
      score: { name: "alpha preserved", cycleBeats: 12, pitch: 61 },
    });
    expect(request.tracks[1].playback.automation).toBeNull();
    await page.locator(".parallel-conflict-debug-panel summary").click();
    const conflictTable = page.locator(".parallel-conflict-debug-table");
    await expect(conflictTable).toContainText("track-beta");
    await expect(conflictTable).toContainText("Beta");
    await expect(conflictTable).toContainText("priorityOrder");
    await expect(conflictTable).toContainText("priority-winner");
    await expect(conflictTable).toContainText(":1");
    const commandNames = driver.calls.map((call) => call.command);
    expect(commandNames.indexOf("parallel_set_playback")).toBeLessThan(
      commandNames.indexOf("transport_play")
    );
  });

  test("keeps custom track tempo automation track-local in parallel playback", async ({
    page,
  }) => {
    const loadPath = "/tmp/caesura/e2e-parallel-custom-tempo-auto.dumka";
    const patch = parallelAudibleProjectPatch();
    const tracks = patch.project?.tracks as Array<Record<string, unknown>>;
    tracks[1] = {
      ...tracks[1],
      automation: tempoAutomationSet(),
    };

    await openCaesura(page, {
      autosaveEnabledPreference: false,
      setupPreferences: { autosaveEnabled: false, autoloadRecentSession: false },
      openDialogResponses: [loadPath],
      patchFiles: { [loadPath]: patch },
    });

    await page.getByRole("button", { name: "Recall" }).click();
    await waitForPreviewRequest(
      page,
      (request) => request.name === "beta active" && request.pitch === 76
    );
    await waitForTimelineReady(page);

    await expect(page.getByTestId("parallel-track-tab-track-beta")).toContainText(
      "80-112 BPM auto"
    );

    await page.getByTestId("transport-play").click();
    await waitForCommandAtLeast(page, "parallel_set_playback", 1);

    const driver = await getDriverState(page);
    const request = driver.lastParallelPlaybackRequest as {
      referenceTempoBpm: number;
      tracks: Array<{
        id: string;
        tempoBpm: number;
        playback: { automation: { tracks: Array<{ target: string }> } | null };
      }>;
    };
    const beta = request.tracks.find((track) => track.id === "track-beta");
    const alpha = request.tracks.find((track) => track.id === "track-alpha");

    expect(request.referenceTempoBpm).toBe(88);
    expect(beta?.tempoBpm).toBe(123);
    expect(beta?.playback.automation?.tracks.map((track) => track.target)).toContain(
      "transport.tempoBpm"
    );
    expect(alpha?.playback.automation).toBeNull();
  });

  test("switches shown project timeline during parallel playback without rewriting transport", async ({
    page,
  }) => {
    const loadPath = "/tmp/caesura/e2e-parallel-live-switch.dumka";

    await openCaesura(page, {
      autosaveEnabledPreference: false,
      setupPreferences: { autosaveEnabled: false, autoloadRecentSession: false },
      openDialogResponses: [loadPath],
      patchFiles: { [loadPath]: parallelAudibleProjectPatch() },
    });

    await page.getByRole("button", { name: "Recall" }).click();
    await waitForPreviewRequest(
      page,
      (request) => request.name === "beta active" && request.pitch === 76
    );
    await waitForTimelineReady(page);

    await page.getByTestId("transport-play").click();
    await waitForCommandAtLeast(page, "parallel_set_playback", 1);
    await waitForCommandAtLeast(page, "transport_play", 1);

    await page.waitForFunction(
      () => Boolean(window.__CAESURA_E2E_STATE__?.activeSeedPathId)
    );
    await emitLiveCycle(page, 1);
    await page.waitForFunction(
      () => (window.__CAESURA_E2E_STATE__?.activeSeedTraceCount ?? 0) > 0
    );
    const recordingBeforeViewSwitch = await getE2eState(page);
    expect(recordingBeforeViewSwitch.activeSeedPathId).not.toBeNull();
    expect(recordingBeforeViewSwitch.latestSeedTraceCycle).toBe(1);

    const before = await getDriverState(page);
    const commandCount = (command: string) =>
      before.calls.filter((call) => call.command === command).length;
    const scoreCreateBefore = commandCount("score_create_subdivision_switch");
    const rhythmSetBefore = commandCount("track_set_playback");
    const parallelSetBefore = commandCount("parallel_set_playback");
    const tempoSetBefore = commandCount("transport_set_tempo");

    await page.getByTestId("parallel-track-tab-track-alpha").click();
    const liveSectionsPanel = await openMainEditor(page, "boundaries");
    const liveNameInput = textInputByLabel(liveSectionsPanel, "Cycle name");
    await expect(liveNameInput).toHaveValue("alpha preserved");
    expect(
      (await getDriverState(page)).calls.filter(
        (call) => call.command === "parallel_set_playback"
      )
    ).toHaveLength(parallelSetBefore);

    // The first edit after view hydration must not be swallowed by the former
    // timer-based suppression window.
    await liveNameInput.fill("alpha live edit");
    await liveNameInput.press("Enter");
    await waitForCommandAtLeast(
      page,
      "parallel_set_playback",
      parallelSetBefore + 1
    );
    await waitForPreviewRequest(
      page,
      (request) =>
        request.name === "alpha live edit" &&
        request.cycleBeats === 12 &&
        request.pitch === 61
    );
    await expect(page.getByTestId("timeline-track-readout")).toContainText(
      "Track 1"
    );
    await expect(page.getByTestId("timeline-track-readout")).toContainText(
      "Alpha"
    );
    await closeMainEditor(page);

    const traceCountBeforeNextCycle = (await getE2eState(page))
      .activeSeedTraceCount;
    await emitLiveCycle(page, 2);
    await page.waitForFunction(
      () => window.__CAESURA_E2E_STATE__?.latestSeedTraceCycle === 2
    );

    // Saving while another track is shown must persist the active recording in
    // its launch track, never in the selected editor track.
    await emitNativeMenuAction(page, "savePatch");
    await waitForCommandCount(page, "patch_save_to_path", 1);
    const savedWhileViewingAlpha = (await getDriverState(page)).lastPatchSave
      ?.patch as PatchDocument;
    const savedTracks = savedWhileViewingAlpha.project?.tracks as Array<{
      id: string;
      seedPaths: Array<{ id: string; trace: Array<{ cycle: number }> }>;
    }>;
    const activeRecordingId = recordingBeforeViewSwitch.activeSeedPathId!;
    expect(
      savedTracks
        .find((track) => track.id === "track-alpha")
        ?.seedPaths.some((path) => path.id === activeRecordingId)
    ).toBe(false);
    expect(
      savedTracks
        .find((track) => track.id === "track-beta")
        ?.seedPaths.find((path) => path.id === activeRecordingId)
        ?.trace.map((point) => point.cycle)
    ).toContain(2);

    await page.getByTestId("parallel-track-tab-track-beta").click();
    await waitForPreviewRequest(
      page,
      (request) =>
        request.name === "beta active" &&
        request.cycleBeats === 5 &&
        request.pitch === 76
    );
    await page.waitForFunction(
      (previousCount) =>
        (window.__CAESURA_E2E_STATE__?.activeSeedTraceCount ?? 0) >
        previousCount,
      traceCountBeforeNextCycle
    );
    const recordingAfterViewSwitch = await getE2eState(page);
    expect(recordingAfterViewSwitch.activeSeedPathId).toBe(
      recordingBeforeViewSwitch.activeSeedPathId
    );
    expect(recordingAfterViewSwitch.activeSeedTraceCount).toBeGreaterThan(
      traceCountBeforeNextCycle
    );

    const after = await getDriverState(page);
    const afterCount = (command: string) =>
      after.calls.filter((call) => call.command === command).length;
    expect(afterCount("score_create_subdivision_switch")).toBe(scoreCreateBefore);
    expect(afterCount("track_set_playback")).toBe(rhythmSetBefore);
    expect(afterCount("parallel_set_playback")).toBe(parallelSetBefore + 1);
    expect(afterCount("transport_set_tempo")).toBe(tempoSetBefore);
    const liveApply = after.calls
      .filter((call) => call.command === "parallel_set_playback")
      .at(-1)?.args as {
      nextCycle?: boolean;
      request?: { tracks?: Array<{ id?: string; score?: { name?: string } }> };
    };
    expect(liveApply.nextCycle).toBe(true);
    expect(
      liveApply.request?.tracks?.find((track) => track.id === "track-alpha")?.score
        ?.name
    ).toBe("alpha live edit");
  });

  test("channel logic rules never block playback (D4)", async ({ page }) => {
    // ~30 sequential UI steps across two tracks + the logic matrix; brushes
    // the default 30s budget under load, so give it the slow-test allowance.
    test.slow();
    await openCaesura(page, {
      autosaveEnabledPreference: false,
      setupPreferences: { autosaveEnabled: false, autoloadRecentSession: false },
    });

    await page
      .locator(".parallel-track-actions")
      .getByRole("button", { name: "New track", exact: true })
      .click();

    // The panel is an app-shell section above the track strip (B1 placement).
    await expect(page.locator(".app-shell > .global-channel-logic-panel")).toHaveCount(1);
    await expect(
      page.locator("#active-track-workspace .parallel-logic-panel")
    ).toHaveCount(0);
    const logicBox = await page.locator(".global-channel-logic-panel").boundingBox();
    const trackStripBox = await page.locator(".parallel-track-strip").boundingBox();
    if (!logicBox || !trackStripBox) {
      throw new Error("Expected Channel Logic and track strip to be visible");
    }
    expect(logicBox.y + logicBox.height).toBeLessThanOrEqual(trackStripBox.y);

    // B0/B1 help + sentence framing (one vocabulary).
    await expect(
      page.getByText("When notes overlap on the same MIDI channel:")
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Show channel logic mode reference" })
      .click();
    await expect(
      page.getByRole("region", { name: "Channel logic mode reference" })
    ).toContainText("How channel logic is evaluated");
    await expect(
      page.getByRole("region", { name: "Channel logic mode reference" })
    ).toContainText("Random one");
    await page
      .getByRole("button", { name: "Hide channel logic mode reference" })
      .click();

    await configureChannelHocketForLogicChannels(page, 4);
    await page.getByTestId("parallel-track-tab-track-1").click();
    await configureChannelHocketForLogicChannels(page, 4);

    // Author two pair rules and a set of channel toggles that, before D4, would
    // have created a contradictory (pair, channel) set and blocked Play. Now the
    // editor makes that unrepresentable — the warning banner never exists and
    // Play stays enabled throughout.
    await page.getByRole("button", { name: "+ Add rule" }).click();
    await page.getByRole("button", { name: "Channel logic rule 1 Ch 2" }).click();
    await page.getByLabel("Channel logic rule 1 operator").selectOption("forceOff");
    await expect(page.getByTestId("transport-channel-logic-warning")).toHaveCount(0);

    await page.getByRole("button", { name: "+ Add rule" }).click();
    await expect(page.getByTestId("transport-channel-logic-warning")).toHaveCount(0);
    await expect(page.locator(".parallel-logic-errors")).toHaveCount(0);
    await expect(page.getByRole("alert")).toHaveCount(0);

    // The effective-policy footer summarizes the outcome per channel.
    await expect(
      page.getByLabel("Effective channel logic by MIDI channel")
    ).toBeVisible();

    await waitForTimelineReady(page);
    await expect(page.getByTestId("transport-play")).toBeEnabled();
  });

  test("creates a project tab and saves track-level mode metadata", async ({
    page,
  }) => {
    const savePath = "/tmp/caesura/e2e-parallel-created.dumka";

    await openCaesura(page, {
      autosaveEnabledPreference: false,
      setupPreferences: { autosaveEnabled: false, autoloadRecentSession: false },
      saveDialogResponses: [savePath],
    });

    await page
      .locator(".parallel-track-actions")
      .getByRole("button", { name: "New track", exact: true })
      .click();
    await expect(page.locator(".success-banner")).toContainText("Added track");
    await expect(page.getByTestId("parallel-track-tab-track-2")).toBeVisible();

    await page.getByRole("button", { name: "Rename Track 2" }).click();
    await page.getByLabel("Active track name").fill("Layer B");
    await page.keyboard.press("Enter");
    await expect(page.locator(".success-banner")).toContainText("Renamed track");

    await page.getByLabel("Track BPM mode").selectOption("custom");
    await expect(page.locator(".success-banner")).toContainText("custom");
    await page.getByLabel("Track cycle mode").selectOption("custom");
    await expect(page.locator(".success-banner")).toContainText("custom");
    await page.getByLabel("Default channel logic").selectOption("xnor");
    await expect(page.locator(".success-banner")).toContainText("channel logic");
    await configureChannelHocketForFallbackRule(page);
    await page.getByTestId("parallel-track-tab-track-1").click();
    await configureChannelHocketForFallbackRule(page);
    await page.getByRole("button", { name: "+ Add rule" }).click();
    await expect(page.locator(".success-banner")).toContainText("Added channel logic");
    await expect(
      page.getByText("When notes overlap on the same MIDI channel:")
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Channel logic rule 1 Ch 1 selected" })
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      page.getByRole("button", { name: /Channel logic rule 1 Ch 2 inactive/ })
    ).toBeDisabled();
    await page.getByRole("button", { name: "Channel logic rule 1 Ch 3" }).click();
    await expect(
      page.getByRole("button", { name: "Channel logic rule 1 Ch 3 selected" })
    ).toHaveAttribute("aria-pressed", "true");
    await page.getByLabel("Channel logic rule 1 operator").selectOption("forceOff");
    await expect(page.locator(".success-banner")).toContainText("logic override");
    await page.getByTestId("parallel-track-tab-track-2").click();

    const setup = await openMainEditor(page, "boundaries");
    await textInputByLabel(setup, "Cycle name").fill("layer b score");
    await fillNumeric(numberInputByLabel(setup, "Pitch"), "81");
    await waitForPreviewRequest(
      page,
      (request) => request.name === "layer b score" && request.pitch === 81
    );

    await closeMainEditor(page);
    await emitNativeMenuAction(page, "savePatchAs");
    await waitForCommandCount(page, "patch_save_to_path", 1);

    const driver = await getDriverState(page);
    const saved = driver.lastPatchSave?.patch as PatchDocument;
    expect(saved.schemaVersion).toBe(1);
    expect(saved.project?.activeTrackId).toBe("track-2");
    expect(saved.project?.global).toMatchObject({
      channelConflictPolicy: "xnor",
      conflictPriority: ["track-1", "track-2"],
    });
    expect(saved.project?.global.channelLogicMatrix).toEqual([
      { trackAId: "track-1", trackBId: "track-2", outputChannel: 1, policy: "forceOff" },
      { trackAId: "track-1", trackBId: "track-2", outputChannel: 3, policy: "forceOff" },
    ]);
    expect(saved.project?.tracks).toHaveLength(2);
    expect(saved.project?.tracks[1]).toMatchObject({
      id: "track-2",
      name: "Layer B",
      tempoMode: "custom",
      cycleLengthMode: "custom",
      sequencer: { name: "layer b score", basePitch: 81 },
      muted: false,
      soloed: false,
    });

    // D4: a second rule never blocks playback — an ambiguous (pair, channel)
    // set is unrepresentable, so there is no conflict alert and Play stays live.
    await page.getByRole("button", { name: "+ Add rule" }).click();
    await expect(page.getByTestId("transport-channel-logic-warning")).toHaveCount(0);
    await expect(page.getByRole("alert")).toHaveCount(0);
    await waitForTimelineReady(page);
    await expect(page.getByTestId("transport-play")).toBeEnabled();
  });

  test("exports cycle JSON and toggles autosave recovery from local controls", async ({
    page,
  }) => {
    const scorePath = "/tmp/caesura/e2e-score.cseq.json";

    await openCaesura(page, {
      autosaveEnabledPreference: false,
      setupPreferences: { autosaveEnabled: false, autoloadRecentSession: false },
      saveDialogResponses: [scorePath],
    });

    await emitNativeMenuAction(page, "exportScore");
    await page.waitForFunction(
      (path) => window.__CAESURA_E2E_DRIVER__?.getState()?.lastScoreSavePath === path,
      scorePath
    );

    let driver = await getDriverState(page);
    expect(driver.dialogHistory.filter((entry) => entry.kind === "save")).toHaveLength(
      1
    );
    expect(driver.lastScoreSavePath).toBe(scorePath);
    await expect(page.locator(".success-banner")).toContainText("Exported cycle JSON");

    await waitForCommandAtLeast(page, "patch_clear_autosave", 1);
    driver = await getDriverState(page);
    const clearCountBefore = driver.calls.filter(
      (call) => call.command === "patch_clear_autosave"
    ).length;

    await page.getByRole("button", { name: /Auto off/ }).click();
    await expect(page.getByRole("button", { name: /Auto on/ })).toBeVisible();
    await expect(page.locator(".success-banner")).toContainText("Autosave on");

    await page.getByRole("button", { name: /Auto on/ }).click();
    await waitForCommandAtLeast(page, "patch_clear_autosave", clearCountBefore + 1);
    await expect(page.getByRole("button", { name: /Auto off/ })).toBeVisible();
    await expect(page.locator(".success-banner")).toContainText("Autosave off");
  });

  test("restores autosaved recovery when accepted", async ({ page }) => {
    const recovered = minimalPatch({
      name: "autosave recovered",
      cycleBeats: 6,
      pitch: 67,
      velocity: 93,
      boundaries: [],
    });

    await openCaesura(page, {
      autosavePatch: recovered,
      previousSessionInterrupted: true,
      autosaveEnabledPreference: true,
      setupPreferences: { autosaveEnabled: true, autoloadRecentSession: false },
      askDialogResponses: [true],
    });

    await page.waitForFunction(
      () =>
        window.__CAESURA_E2E_DRIVER__
          ?.getState()
          ?.dialogHistory.some(
            (entry: { kind: string; result: unknown }) =>
              entry.kind === "ask" && entry.result === true
          )
    );
    await waitForPreviewRequest(
      page,
      (request) =>
        request.name === "autosave recovered" &&
        request.cycleBeats === 6 &&
        request.pitch === 67 &&
        request.velocity === 93
    );

    const driver = await getDriverState(page);
    expect(driver.calls.some((call) => call.command === "patch_load_autosave")).toBe(
      true
    );
    expect(driver.autosavePatch).not.toBeNull();
    await expect(page.locator(".success-banner")).toContainText(
      "Restored autosaved recovery"
    );
  });

  test("clears autosaved recovery when declined", async ({ page }) => {
    const recovered = minimalPatch({
      name: "declined autosave",
      cycleBeats: 6,
      pitch: 67,
      velocity: 93,
      boundaries: [],
    });

    await openCaesura(page, {
      autosavePatch: recovered,
      previousSessionInterrupted: true,
      autosaveEnabledPreference: true,
      setupPreferences: { autosaveEnabled: true, autoloadRecentSession: false },
      askDialogResponses: [false],
    });

    await page.waitForFunction(
      () =>
        window.__CAESURA_E2E_DRIVER__
          ?.getState()
          ?.dialogHistory.some(
            (entry: { kind: string; result: unknown }) =>
              entry.kind === "ask" && entry.result === false
          )
    );
    await waitForCommandAtLeast(page, "patch_clear_autosave", 1);

    const driver = await getDriverState(page);
    expect(driver.autosavePatch).toBeNull();
    expect(driver.lastPreviewRequest?.request.name).toBe("untitled");
    await expect(page.locator(".success-banner")).toContainText(
      "Discarded autosaved recovery"
    );
  });
});
