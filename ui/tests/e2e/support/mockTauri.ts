import type { Page } from "@playwright/test";

// Rust-generated golden backend DTOs (see `dto_fixtures` in
// src-tauri/src/main.rs). The mock fabricates *values* dynamically but
// inherits every response's *shape* from these templates, so additive Rust DTO
// changes reach mock-driven specs without hand-mirroring.
import {
  DEFAULT_DUMKA_PATTERN,
  compileDumkaPattern,
  formatDumkaParseError,
  type DumkaCompiled,
} from "../../../src/dumkaPattern";
import {
  type DumkaStateProfile,
  stateComplexityMilli,
  stateDepthDiversityMilli,
  stateProperties,
  stratification,
} from "../../../src/dumkaMetrics";
import { transportSnapshotFixture } from "../../../src/__fixtures__/dto/transportSnapshot.fixture";

/**
 * Dum-Ka mock preview data. The init script runs inside the page and cannot
 * import the src mirror, so every pattern a mock-lane spec authors is
 * precompiled here on the Node side (with the same mirror the editor uses)
 * and shipped to the page as data; the page keeps only the small integer
 * span projector. A pattern outside this list fails the spec loudly.
 */
const DUMKA_MOCK_PATTERNS: string[] = [
  DEFAULT_DUMKA_PATTERN,
  // The reference rhythm, plus its optional detached stylistic variant.
  "[dum@3 ka] [. ka] [dum ka dum ka dum]@2",
  "[dum@3 ka] [. ka] [[dum .] [ka .] [dum .] [ka .] [dum .]]@2",
  "x . x .",
  "x _ x .",
  "[x x x x x]@2",
  "[x", // pinned parse-error case
  // Authored by the visual rhythm builder in rhythm-builder.spec.ts:
  // rest→note toggle, then a 5:1 split of the first beat.
  "x x x .",
  "[x x x x x] x x .",
  // Authored by the explicit 5:2 articulation flow. Keep each intermediate
  // commit sanctioned so the mock fails closed on any unexpected rewrite.
  "x x x x",
  "x [x x]@2 x",
  "x [[x x]@2]@2 x",
  "x [[x x x x x]@2]@2 x",
  "x [[[x .] [x .] [x .] [x .] [x .]]@2]@2 x",
  // Nested 5:2 under an S15 / Grouping-3 projection: the optional detached
  // style needs four cells per slot, rather than the per-beat `[x .]` form.
  "[[x x x x x]@2 .]@2",
  "[[[x .@3] [x .@3] [x .@3] [x .@3] [x .@3]]@2 .]@2",
  // Reported five-beat mixed tuplet and its optional detached-note rewrite.
  "[dum . . ka] [. . ka . x] [dum . ka .] [x x . x]",
  "[dum . . ka] [. . ka . x]@2 [x x . x]",
  "[dum . . ka] [. . ka . x]@3",
  "[dum . . ka] [. . ka . x]@2 [dum . ka .] [x x . x]",
  "[dum . . ka] [. . [ka .] . [x .]]@2 [dum . ka .] [x x . x]",
];

type DumkaMockEntry =
  | { error: string }
  | {
      compiled: DumkaCompiled;
      gridSupported: boolean;
      depthMetrics: Record<
        string,
        {
          complexityMilli: number;
          diversityMilli: number;
          // The full six-functional profile on this working grid, or null when
          // the grid's primes exceed the published Ψ tables (the engine then
          // emits no propertyProfile either). When present, its complexity and
          // diversity equal the two fields above by construction.
          profile: DumkaStateProfile | null;
        }
      >;
    };

const DUMKA_MOCK_PALETTES = [2, 3, 5, 7]
  .flatMap((first, index, levels) => [
    [first],
    ...levels.slice(index + 1).map((second) => [first, second]),
  ])
  .concat([[]]);

function dumkaMockWorkingSubdivisions(requiredSubdivision: number): number[] {
  return [
    ...new Set(
      DUMKA_MOCK_PALETTES.map((palette) =>
        palette.reduce(
          (working, level) => working * level,
          requiredSubdivision
        )
      )
    ),
  ];
}

function buildDumkaMockTable(): Record<string, DumkaMockEntry> {
  const table: Record<string, DumkaMockEntry> = {};
  for (const pattern of DUMKA_MOCK_PATTERNS) {
    const result = compileDumkaPattern(pattern);
    table[pattern] = result.ok
      ? {
          compiled: result.compiled,
          // Precomputed at build time: the injected page script cannot
          // reach module imports, and the cycleDistance contract needs the
          // engine's published-Barlow-tables check.
          gridSupported:
            stratification(
              result.compiled.totalBeats,
              result.compiled.requiredSubdivision
            ) !== null,
          depthMetrics: Object.fromEntries(
            dumkaMockWorkingSubdivisions(
              result.compiled.requiredSubdivision
            ).map((workingSubdivision) => {
              const onsetSlots = result.compiled.events.map(
                (event) =>
                  (event.start.num * workingSubdivision) / event.start.den
              );
              // Realized attack/occupancy masks on this working grid, exactly
              // as the engine's RhythmView builds them (the mock resolves only
              // verbatim repeats, so the seed IS the realized state, rotation
              // zero). Sustains raise occupancy above density.
              const slots = result.compiled.totalBeats * workingSubdivision;
              const attacks = new Array<boolean>(slots).fill(false);
              const occupancy = new Array<boolean>(slots).fill(false);
              for (const event of result.compiled.events) {
                const start =
                  (event.start.num * workingSubdivision) / event.start.den;
                const duration = Math.min(
                  (event.dur.num * workingSubdivision) / event.dur.den,
                  slots
                );
                attacks[start] = true;
                for (let offset = 0; offset < duration; offset += 1) {
                  occupancy[(start + offset) % slots] = true;
                }
              }
              const complexityMilli = stateComplexityMilli(
                onsetSlots,
                workingSubdivision
              );
              const diversityMilli = stateDepthDiversityMilli(
                onsetSlots,
                workingSubdivision
              );
              const profile = stateProperties(
                result.compiled.totalBeats,
                workingSubdivision,
                attacks,
                occupancy
              );
              // Fail closed on the engine's pinned invariant: when a profile
              // exists, its complexity and diversity are the very fields the
              // preview also publishes standalone. A divergence here means the
              // attack/occupancy construction drifted from the onset-slot list.
              if (
                profile &&
                (profile.complexityMilli !== complexityMilli ||
                  profile.diversityMilli !== diversityMilli)
              ) {
                throw new Error(
                  `mock dumka profile diverged from depth metrics at Subdivision ${workingSubdivision} for pattern ${pattern}`
                );
              }
              return [
                String(workingSubdivision),
                { complexityMilli, diversityMilli, profile },
              ];
            })
          ),
        }
      : { error: formatDumkaParseError(result.issue) };
  }
  return table;
}
import { subdivisionSwitchPreviewFixture } from "../../../src/__fixtures__/dto/subdivisionSwitchPreview.fixture";

export interface MockTauriOptions {
  previewDelayMs?: number;
  holdPreviewCycles?: number[];
  commandFailures?: Record<string, string>;
  commandDelayMs?: Record<string, number>;
  forceSameGatiSections?: boolean;
  saveDialogResponses?: Array<string | null>;
  openDialogResponses?: Array<string | null>;
  askDialogResponses?: boolean[];
  patchFiles?: Record<string, unknown>;
  autosavePatch?: unknown | null;
  autosaveEnabledPreference?: boolean;
  previousSessionInterrupted?: boolean;
  setupPreferences?: Record<string, unknown>;
  globalSeedStartupLock?: { locked: boolean; seed: number };
  lastPatchPath?: string | null;
  recentPatches?: Array<{ path: string; name?: string; savedAt?: string }>;
  /** MIDI destinations the mock backend reports as present. */
  midiDestinations?: Array<{ id: string; name: string }>;
  /** When set, `midi_set_destination` connect attempts fail with this error
   * (destination reported present but unconnectable). */
  midiConnectFailure?: string;
  /** Machine-prefs snapshot the backend returns; `null` ⇒ source "defaults"
   * (the frontend may then run its one-shot localStorage migration). */
  machinePrefs?: {
    prefsVersion?: number;
    midiDestination?: { id: string; name: string } | null;
    autosaveEnabled?: boolean;
    autosaveIntervalMs?: number;
    autoloadRecentSession?: boolean;
  } | null;
  /**
   * Make the transport-realized rhythm snapshot diverge from the stopped
   * preview (a play cell + a rest cell instead of one full play cell), the way
   * a history-seed cycle realizes a different pattern than the preview seed.
   * Used by the timeline/playback rhythm-row parity spec to prove the live row
   * is sourced from the realized snapshot, not re-previewed. Off by default so
   * every other mock-driven spec keeps realized === preview (no visual drift).
   */
  divergentRealizedRhythm?: boolean;
}

type MockTauriInit = MockTauriOptions & {
  snapshotTemplate: typeof transportSnapshotFixture;
  subdivisionPreviewTemplate: typeof subdivisionSwitchPreviewFixture;
  dumkaMockTable: Record<string, DumkaMockEntry>;
};

export async function installMockTauri(
  page: Page,
  options: MockTauriOptions = {}
): Promise<void> {
  const init: MockTauriInit = {
    ...options,
    snapshotTemplate: transportSnapshotFixture,
    subdivisionPreviewTemplate: subdivisionSwitchPreviewFixture,
    dumkaMockTable: buildDumkaMockTable(),
  };
  await page.addInitScript((driverOptions: MockTauriInit) => {
    window.__CAESURA_E2E__ = true;

    if (driverOptions.autosaveEnabledPreference !== undefined) {
      window.localStorage.setItem(
        "caesura.autosaveEnabled.v1",
        driverOptions.autosaveEnabledPreference ? "true" : "false"
      );
    }
    if (driverOptions.previousSessionInterrupted !== undefined) {
      window.localStorage.setItem(
        "caesura.sessionState.v1",
        driverOptions.previousSessionInterrupted ? "active" : "clean"
      );
    }
    if (driverOptions.setupPreferences) {
      window.localStorage.setItem(
        "caesura.setupPreferences.v1",
        JSON.stringify(driverOptions.setupPreferences)
      );
    }
    if (driverOptions.globalSeedStartupLock) {
      window.localStorage.setItem(
        "caesura.globalSeedStartupLock.v1",
        JSON.stringify(driverOptions.globalSeedStartupLock)
      );
    }
    if (driverOptions.lastPatchPath) {
      window.localStorage.setItem(
        "caesura.lastPatchPath.v1",
        driverOptions.lastPatchPath
      );
    }
    if (driverOptions.recentPatches) {
      window.localStorage.setItem(
        "caesura.recentPatches.v1",
        JSON.stringify(driverOptions.recentPatches)
      );
    }

    const clone = <T,>(value: T): T =>
      value === undefined ? value : JSON.parse(JSON.stringify(value));
    // Merge a fabricated event over the first template event of the same
    // playback layer: mock values win, unknown (new) real-DTO fields flow in.
    const template = driverOptions.snapshotTemplate;
    const subdivisionPreviewTemplate = driverOptions.subdivisionPreviewTemplate;
    const templateRecord = template as unknown as Record<string, unknown[]>;
    const assertMatchesFixtureShape = (
      fixture: unknown,
      value: unknown,
      path: string
    ): void => {
      if (fixture === null) {
        if (value === undefined) {
          throw new Error(`Mock backend contract drift at ${path}: missing nullable field`);
        }
        return;
      }
      if (value === null) return;

      if (Array.isArray(fixture)) {
        if (!Array.isArray(value)) {
          throw new Error(`Mock backend contract drift at ${path}: expected array`);
        }
        if (fixture.length === 0 || value.length === 0) return;
        for (let index = 0; index < value.length; index += 1) {
          assertMatchesFixtureShape(fixture[0], value[index], `${path}[${index}]`);
        }
        return;
      }

      if (typeof fixture === "object") {
        if (!value || typeof value !== "object" || Array.isArray(value)) {
          throw new Error(`Mock backend contract drift at ${path}: expected object`);
        }
        const fixtureKeys = Object.keys(fixture as Record<string, unknown>).sort();
        const valueKeys = Object.keys(value as Record<string, unknown>).sort();
        const missing = fixtureKeys.filter((key) => !valueKeys.includes(key));
        const extra = valueKeys.filter((key) => !fixtureKeys.includes(key));
        if (missing.length || extra.length) {
          throw new Error(
            `Mock backend contract drift at ${path}: ` +
              `missing [${missing.join(", ")}], extra [${extra.join(", ")}]`
          );
        }
        for (const key of fixtureKeys) {
          assertMatchesFixtureShape(
            (fixture as Record<string, unknown>)[key],
            (value as Record<string, unknown>)[key],
            `${path}.${key}`
          );
        }
        return;
      }

      if (typeof value !== typeof fixture) {
        throw new Error(
          `Mock backend contract drift at ${path}: expected ${typeof fixture}, ` +
            `received ${typeof value}`
        );
      }
    };

    const assertBackendContractShape = (command: string, value: unknown): void => {
      if (command === "transport_get_snapshot" || command === "transport_snapshot") {
        assertMatchesFixtureShape(template, value, command);
      } else if (command === "score_preview_subdivision_switch") {
        assertMatchesFixtureShape(
          subdivisionPreviewTemplate,
          value,
          "score_preview_subdivision_switch"
        );
      }
    };

    const overTemplate = <T extends Record<string, unknown>>(
      list: keyof typeof template & string,
      overrides: T
    ): T => {
      const base = (templateRecord[list]?.[0] ?? {}) as Record<string, unknown>;
      return { ...base, ...overrides };
    };
    const listeners = new Map<string, Set<(event: { payload: unknown }) => void>>();
    const heldPreviewCycles = new Set(driverOptions.holdPreviewCycles ?? []);
    const pendingPreviews: Array<{
      cycle: number;
      resolve: (preview: unknown) => void;
      request: Record<string, unknown>;
    }> = [];
    const commandFailures = new Map(
      Object.entries(driverOptions.commandFailures ?? {})
    );
    const commandDelays = new Map(
      Object.entries(driverOptions.commandDelayMs ?? {})
    );
    const calls: Array<{ sequence: number; command: string; args: unknown }> = [];
    const dialogHistory: Array<{
      sequence: number;
      kind: "ask" | "open" | "save";
      options: unknown;
      result: unknown;
    }> = [];
    const saveDialogResponses = [...(driverOptions.saveDialogResponses ?? [])];
    const openDialogResponses = [...(driverOptions.openDialogResponses ?? [])];
    const askDialogResponses = [...(driverOptions.askDialogResponses ?? [])];
    const patchFiles = new Map<string, unknown>(
      Object.entries(driverOptions.patchFiles ?? {}).map(([path, patch]) => [
        path,
        clone(patch),
      ])
    );
    let sequence = 0;
    let latestCycleBeats = 8;
    let previewDelayMs = driverOptions.previewDelayMs ?? 0;
    let lastPreviewRequest: unknown = null;
    let lastPreview: unknown = null;
    let lastScoreCreateRequest: unknown = null;
    let lastPatchSave: unknown = null;
    let lastPatchLoadPath: string | null = null;
    let autosavePatch = clone(driverOptions.autosavePatch ?? null);
    let lastAutosavePatch: unknown = null;
    let lastScoreSavePath: string | null = null;
    let lastGeneratorPreviewRequest: unknown = null;
    let lastGeneratorPreview: unknown = null;
    let lastTrackPlaybackRequest: unknown = null;
    let lastParallelPlaybackRequest: unknown = null;

    // Machine-local state the mock backend owns (mirrors AppState).
    const midiDestinations = [...(driverOptions.midiDestinations ?? [])];
    const defaultMachinePrefs = () => ({
      prefsVersion: 1,
      midiDestination: null as { id: string; name: string } | null,
      autosaveEnabled: true,
      autosaveIntervalMs: 3000,
      autoloadRecentSession: true,
    });
    const hasMachinePrefsFile = driverOptions.machinePrefs != null;
    const machinePrefs = driverOptions.machinePrefs
      ? { ...defaultMachinePrefs(), ...driverOptions.machinePrefs }
      : defaultMachinePrefs();
    let midiRoute: {
      desired: { id: string; name: string } | null;
      connected: boolean;
      lastError: string | null;
    } = {
      desired: machinePrefs.midiDestination,
      connected: false,
      lastError: null,
    };
    const reconcileMidiRoute = () => {
      const desired = midiRoute.desired;
      if (!desired) {
        midiRoute = { desired: null, connected: false, lastError: null };
        return;
      }
      const present = midiDestinations.some((dest) => dest.id === desired.id);
      if (!present) {
        midiRoute = {
          desired,
          connected: false,
          lastError: "destination not present",
        };
      } else if (driverOptions.midiConnectFailure) {
        midiRoute = {
          desired,
          connected: false,
          lastError: driverOptions.midiConnectFailure,
        };
      } else {
        midiRoute = { desired, connected: true, lastError: null };
      }
    };

    const makeSnapshot = (
      currentCycle: number,
      isPlaying: boolean,
      currentTick = 0
    ) => {
      const ticksPerCycle = latestCycleBeats * 960;
      const parallelRequest = lastParallelPlaybackRequest as
        | {
            channelConflictPolicy?: string;
            tracks?: Array<{ id?: string; name?: string; score?: { pitch?: number } }>;
          }
        | null;
      const parallelTracks = parallelRequest?.tracks ?? [];
      const parallelConflictEvents =
        parallelTracks.length > 1
          ? parallelTracks.map((track, index) =>
              overTemplate("parallelConflictEvents", {
              sequence: currentCycle * 10 + index,
              absoluteTick: currentCycle * ticksPerCycle + currentTick,
              cycle: currentCycle,
              tickInCycle: currentTick,
              outputChannel: 1,
              pitch: track.score?.pitch ?? 60,
              startTick: currentCycle * ticksPerCycle + currentTick,
              endTick: currentCycle * ticksPerCycle + currentTick + 120,
              trackId: track.id ?? `track-${index + 1}`,
              trackName: track.name ?? "",
              trackIndex: index,
              conflictPolicy: parallelRequest?.channelConflictPolicy ?? "allowAll",
              conflictAction: index === 0 ? "priority-winner" : "priority-suppress",
              conflictGroupId: `${currentCycle * ticksPerCycle + currentTick}:1`,
              collidingTrackIds: parallelTracks.map(
                (item, peerIndex) => item.id ?? `track-${peerIndex + 1}`
              ),
              activeTrackCount: parallelTracks.length,
              passed: index === 0,
            })
            )
          : [];
      const nextSnapshot = {
        ...template,
        tempoBpm: 80,
        isPlaying,
        currentTick,
        currentCycle,
        ticksPerCycle,
        currentScoreId: "e2e-score",
        parallelTrackPositions:
          parallelTracks.length > 1
            ? parallelTracks.map((track, index) =>
                overTemplate("parallelTrackPositions", {
                trackIndex: index,
                trackId: track.id ?? `track-${index + 1}`,
                trackName: track.name ?? `Track ${index + 1}`,
                cycle: currentCycle,
                tickInCycle: currentTick,
                ticksPerCycle,
                referenceStartTick: currentCycle * ticksPerCycle,
                referenceEndTick: (currentCycle + 1) * ticksPerCycle,
              })
              )
            : [],
        midiDebugEvents: [
          overTemplate("midiDebugEvents", {
            sequence: currentCycle + 1,
            absoluteTick: currentCycle * ticksPerCycle + currentTick,
            cycle: currentCycle,
            tickInCycle: currentTick,
            channel: 1,
            // Must match the real DTO string (`describe_midi_message` in
            // cseq-transport emits camelCase) — verified by the
            // real-backend-parity suite.
            messageType: "noteOn",
            data1: 60,
            data2: 96,
            bytes: [144, 60, 96],
            debugSource: "e2e",
            monitorBus: null,
            monitorUserChannel: null,
            monitorMode: null,
            monitorProgram: null,
            monitorDrumNote: null,
            monitorBytes: null,
            parallelTrackId: null,
            parallelTrackName: null,
            parallelConflictPolicy: null,
            parallelConflictAction: null,
            parallelConflictGroupId: null,
          }),
        ],
        automationEvents: [],
        channelHocketEvents: makeChannelHocketEvents(currentCycle, ticksPerCycle),
        realizedRhythmEvents: makeRealizedRhythmEvents(currentCycle),
        seedTraceEvents: [
          overTemplate("seedTraceEvents", {
            cycle: currentCycle,
            domain: "subdivision",
            label: "Subdivision switch",
            seed: String(10_000 + currentCycle),
            baseSeed: "7",
            source: currentCycle === 0 ? "locked" : "perCycle",
            historyBefore: [],
            historyAfter: [String(10_000 + currentCycle)],
            parallelTrackIndex:
              parallelTracks.length > 1 ? 0 : null,
            trackId:
              parallelTracks.length > 1
                ? parallelTracks[0]?.id ?? null
                : null,
          }),
        ],
        parallelConflictEvents,
        // Synthesize a launched decision per cycle for each triggered track so
        // the Phase-E timeline overlay + log have a trace to render.
        triggerDecisionEvents: parallelTracks
          .map((track, index) => ({ track, index }))
          .filter(({ track }) => track.trigger)
          .map(({ track, index }) => {
            const beatTick = Math.floor((ticksPerCycle * 3) / latestCycleBeats);
            const tick = currentCycle * ticksPerCycle + beatTick;
            return overTemplate("triggerDecisionEvents", {
              trackIndex: index,
              trackId: track.id ?? `track-${index + 1}`,
              trackName: track.name ?? `Track ${index + 1}`,
              sourceCycleIndex: currentCycle,
              matchedBeat: 3,
              eventTick: tick,
              candidateTick: tick,
              startKind: "atEvent",
              outcome: "launched",
              suppressReason: null,
              launchTick: tick,
              runIndex: currentCycle,
              rollValue: null,
              rollThreshold: null,
              rollPassed: null,
              consecutiveMisses: 0,
              lastAcceptSourceCycle: currentCycle,
            });
          }),
      };
      assertBackendContractShape("transport_snapshot", nextSnapshot);
      return nextSnapshot;
    };


    const makeChannelHocketEvents = (cycle: number, ticksPerCycle: number) => {
      const tick = ticksPerCycle / latestCycleBeats;
      return [
        overTemplate("channelHocketEvents", {
          cycle,
          startTick: 0,
          endTick: tick,
          channel: 2,
          source: "accent",
          fallback: false,
          parallelTrackIndex: null,
          parallelTrackId: null,
          parallelTrackName: null,
          suppressed: false,
        }),
      ];
    };

    // The transport-realized generator snapshot for a cycle.
    const makeRealizedRhythmEvents = (currentCycle: number) => {
      const preview = lastGeneratorPreview as
        | { spans?: unknown[]; resolution?: { spans?: unknown[] } }
        | null;
      const spans = Array.isArray(preview?.spans)
        ? (preview.spans as unknown[])
        : Array.isArray(preview?.resolution?.spans)
          ? (preview!.resolution!.spans as unknown[])
          : [];
      // Fabricated realized cells carry the mock's base velocity so their
      // shape matches the real snapshot DTO (whose cells are stamped by the
      // transport overlay). Cells copied from a preview keep their own stamp.
      const cell = (
        index: number,
        start: number,
        len: number,
        rest: boolean
      ) => ({
        index,
        start,
        len,
        rest,
        tiedFromPrevious: false,
        tiedToNext: false,
        velocity: 96,
      });
      return spans.map((span, index) => {
        const item = span as Record<string, unknown>;
        const spanLen = Math.max(1, Math.round(Number(item.spanLen) || 1));
        const canSplit = driverOptions.divergentRealizedRhythm && spanLen >= 2;
        const head = Math.max(1, Math.floor(spanLen / 2));
        const realizedCells = canSplit
          ? [cell(0, 0, head, false), cell(1, head, spanLen - head, true)]
          : Array.isArray(item.cells) && item.cells.length
            ? (item.cells as unknown[])
            : [cell(0, 0, spanLen, false)];
        return overTemplate("realizedRhythmEvents", {
          cycle: currentCycle,
          parallelTrackIndex: null,
          parallelTrackId: null,
          span: {
            spanId: Number(item.spanId) || index + 1,
            spanLen,
            cells: realizedCells,
          },
        });
      });
    };

    let snapshot = makeSnapshot(0, false);
    let telemetryEpoch = 0;
    type TelemetryLogInterest =
      | "none"
      | "seedTrace"
      | "trigger"
      | "seedTraceAndTrigger"
      | "full";
    let telemetryLogInterest: TelemetryLogInterest = "none";

    const emit = (eventName: string, payload: unknown) => {
      for (const handler of listeners.get(eventName) ?? []) {
        handler({ payload: clone(payload) });
      }
    };

    const scopedTransportLog = (stamped: typeof snapshot & {
      sampleEpoch: number;
      timelineEpoch: number;
      logEpoch: number;
    }) => {
      const full = telemetryLogInterest === "full";
      const seedTrace =
        full ||
        telemetryLogInterest === "seedTrace" ||
        telemetryLogInterest === "seedTraceAndTrigger";
      const trigger =
        full ||
        telemetryLogInterest === "trigger" ||
        telemetryLogInterest === "seedTraceAndTrigger";
      return {
        ...stamped,
        logInterest: telemetryLogInterest,
        midiDebugEvents: full ? stamped.midiDebugEvents : [],
        automationEvents: full ? stamped.automationEvents : [],
        seedTraceEvents: seedTrace ? stamped.seedTraceEvents : [],
        parallelConflictEvents: full ? stamped.parallelConflictEvents : [],
        triggerDecisionEvents: trigger ? stamped.triggerDecisionEvents : [],
      };
    };

    // Emit one full snapshot as the three split telemetry events the app now
    // listens to (timeline + log + position), all sharing one epoch. Timeline
    // is emitted first so it promotes before the matching position applies.
    const emitTransport = (snap: typeof snapshot) => {
      telemetryEpoch += 1;
      const stamped = {
        ...snap,
        sampleEpoch: telemetryEpoch,
        timelineEpoch: telemetryEpoch,
        logEpoch: telemetryEpoch,
      };
      emit("transport_timeline_snapshot", stamped);
      if (telemetryLogInterest !== "none") {
        emit("transport_log_snapshot", scopedTransportLog(stamped));
      }
      emit("transport_position", stamped);
    };

    const hydrateTransportLog = () => {
      if (telemetryLogInterest === "none") return;
      telemetryEpoch += 1;
      const stamped = {
        ...snapshot,
        sampleEpoch: telemetryEpoch,
        timelineEpoch: telemetryEpoch,
        logEpoch: telemetryEpoch,
      };
      emit("transport_log_snapshot", scopedTransportLog(stamped));
    };

    const chooseWeighted = (
      weights: unknown,
      key: "subdivision" | "jathi",
      fallback: number | null
    ) => {
      if (!Array.isArray(weights)) return fallback;
      let best = fallback;
      let bestWeight = -Infinity;
      for (const weight of weights) {
        if (!weight || typeof weight !== "object") continue;
        const item = weight as Record<string, unknown>;
        const candidate = Number(item[key]);
        const value = Number(item.weight);
        if (Number.isFinite(candidate) && Number.isFinite(value) && value > bestWeight) {
          best = candidate;
          bestWeight = value;
        }
      }
      return best;
    };

    const automationTimeUnit = (time: unknown): number | null => {
      if (!time || typeof time !== "object") return null;
      const item = time as { numer?: unknown; denom?: unknown };
      const numer = Number(item.numer);
      const denom = Number(item.denom);
      if (!Number.isFinite(numer) || !Number.isFinite(denom) || denom <= 0) {
        return null;
      }
      return Math.max(0, Math.min(1, numer / denom));
    };

    const automationPointValue = (point: Record<string, unknown>): number | null => {
      const value = point.value;
      if (!value || typeof value !== "object") return null;
      const numericValue = Number((value as { value?: unknown }).value);
      return Number.isFinite(numericValue) ? numericValue : null;
    };

    const warpAutomationAmount = (
      amount: number,
      kind: string,
      strength: number
    ): number => {
      const t = Math.max(0, Math.min(1, amount));
      const clampedStrength = Math.max(0, Math.min(1, strength));
      switch (kind) {
        case "hold":
          return 0;
        case "smooth":
          return t + (t * t * (3 - 2 * t) - t) * clampedStrength;
        case "easeIn": {
          const exponent = 1 + clampedStrength * 5;
          return t ** exponent;
        }
        case "easeOut": {
          const exponent = 1 + clampedStrength * 5;
          return 1 - (1 - t) ** exponent;
        }
        case "easeInOut": {
          const exponent = 1 + clampedStrength * 5;
          return t < 0.5
            ? 0.5 * (2 * t) ** exponent
            : 1 - 0.5 * (2 * (1 - t)) ** exponent;
        }
        case "exponential": {
          if (clampedStrength === 0) return t;
          const bend = 1 + clampedStrength * 8;
          return (bend ** t - 1) / (bend - 1);
        }
        default:
          return t;
      }
    };

    const sampleAutomationCurve = (
      curve: Record<string, unknown>,
      phase: number,
      markers: Array<Record<string, unknown>>
    ): number | null => {
      const markerTime = (anchorId: unknown): unknown => {
        if (typeof anchorId !== "string") return undefined;
        return markers.find((marker) => marker.id === anchorId)?.time;
      };
      const points = (Array.isArray(curve.points) ? curve.points : [])
        .map((point) => ({
          point,
          unit: automationTimeUnit(markerTime(point.anchorId) ?? point.time),
          value: automationPointValue(point),
        }))
        .filter(
          (point): point is { point: Record<string, unknown>; unit: number; value: number } =>
            point.unit !== null && point.value !== null
        )
        .sort((a, b) => a.unit - b.unit);
      if (!points.length) return null;

      if (phase <= points[0]!.unit) return points[0]!.value;
      const last = points[points.length - 1]!;
      if (phase >= last.unit) return last.value;

      for (let index = 0; index < points.length - 1; index += 1) {
        const left = points[index]!;
        const right = points[index + 1]!;
        if (phase < left.unit || phase > right.unit) continue;
        const span = Math.max(1e-9, right.unit - left.unit);
        const rawAmount = (phase - left.unit) / span;
        const outCurve = left.point.outCurve as
          | { kind?: unknown; amount?: unknown }
          | null
          | undefined;
        const fallbackKind =
          curve.interpolation === "hold"
            ? "hold"
            : curve.interpolation === "smooth"
              ? "smooth"
              : "linear";
        const kind = typeof outCurve?.kind === "string" ? outCurve.kind : fallbackKind;
        const strength = outCurve
          ? Math.max(0, Math.min(1, Number(outCurve.amount) || 0))
          : 1;
        const amount = warpAutomationAmount(rawAmount, kind, strength);
        return left.value + (right.value - left.value) * amount;
      }

      return last.value;
    };

    const sampleAutomationTarget = (
      request: Record<string, unknown>,
      target: string,
      beat: number,
      cycle: number,
      base: number
    ): number | null => {
      const automation = request.automation as
        | {
            lengthCycles?: unknown;
            markers?: Array<Record<string, unknown>>;
            tracks?: Array<Record<string, unknown>>;
          }
        | null
        | undefined;
      const lengthCycles = Math.max(1, Math.round(Number(automation?.lengthCycles) || 1));
      const cycleBeats = Math.max(1, Math.round(Number(request.cycleBeats) || latestCycleBeats));
      const phase = ((cycle % lengthCycles) + (beat - 1) / cycleBeats) / lengthCycles;
      const markers = Array.isArray(automation?.markers) ? automation.markers : [];
      const replaceSamples: number[] = [];
      let addSum = 0;
      let multiplyProduct = 1;
      let changed = false;

      for (const track of automation?.tracks ?? []) {
        if (
          track.enabled === false ||
          track.target !== target ||
          !Array.isArray(track.curves)
        ) {
          continue;
        }
        const samples = track.curves
          .filter(
            (curve): curve is Record<string, unknown> =>
              Boolean(curve && typeof curve === "object" && curve.enabled !== false)
          )
          .map((curve) => sampleAutomationCurve(curve, phase, markers))
          .filter((value): value is number => value !== null);
        if (samples.length === 0) continue;

        if (track.combine === "add") {
          addSum += samples.reduce((sum, value) => sum + value, 0);
        } else if (track.combine === "multiply") {
          multiplyProduct *= samples.reduce((product, value) => product * value, 1);
        } else {
          replaceSamples.push(...samples);
        }
        changed = true;
      }

      if (!changed) return null;
      const replaced = replaceSamples.length
        ? replaceSamples.reduce((sum, value) => sum + value, 0) / replaceSamples.length
        : base;
      const value = (replaced + addSum) * multiplyProduct;
      return Number.isFinite(value) ? value : null;
    };

    const hasEnabledAutomationSource = (
      request: Record<string, unknown>,
      target: string
    ): boolean => {
      const automation = request.automation as
        | { tracks?: Array<Record<string, unknown>> }
        | null
        | undefined;
      return (automation?.tracks ?? []).some(
        (track) =>
          track.enabled !== false &&
          track.target === target &&
          Array.isArray(track.curves) &&
          track.curves.some(
            (curve) =>
              Boolean(curve && typeof curve === "object") &&
              (curve as Record<string, unknown>).enabled !== false &&
              Array.isArray((curve as Record<string, unknown>).points) &&
              ((curve as Record<string, unknown>).points as unknown[]).length > 0
          )
      );
    };

    const automationBaseValue = (
      request: Record<string, unknown>,
      target: string
    ): number => {
      if (target === "sequencer.pitch") return Number(request.pitch) || 60;
      if (target === "sequencer.velocity") return Number(request.velocity) || 96;
      if (target === "generator.example.density") {
        const generator = (request.generator ?? {}) as Record<string, unknown>;
        return Number(generator.densityPercent) || 0;
      }
      return 0;
    };

    const automationValues = (
      request: Record<string, unknown>,
      beat: number,
      cycle: number
    ) => {
      const automation = request.automation as
        | { tracks?: Array<Record<string, unknown>> }
        | null
        | undefined;
      const targets = Array.from(
        new Set(
          (automation?.tracks ?? [])
            .filter((track) => track.enabled !== false)
            .map((track) => track.target)
            .filter((target): target is string => typeof target === "string")
        )
      );
      return targets.flatMap((target) => {
        const samplesPerBeat =
          target.startsWith("sequencer.") ||
          target === "transport.tempoBpm" ||
          target.startsWith("channelHocket.fallback.") ||
          target.startsWith("channelHocket.matrix.") ||
          target.startsWith("channelHocket.accentRule.") ||
          target.startsWith("channelHocket.positionRule.");
        const sampledValue = sampleAutomationTarget(
          request,
          target,
          samplesPerBeat ? beat : 1,
          cycle,
          automationBaseValue(request, target)
        );
        return sampledValue === null ? [] : [{ target, value: sampledValue }];
      });
    };

    const buildPreview = (
      request: Record<string, unknown>,
      cycle: number
    ): Record<string, unknown> => {
      const cycleBeats = Math.max(1, Math.min(64, Math.round(Number(request.cycleBeats) || 8)));
      latestCycleBeats = cycleBeats;
      snapshot = {
        ...snapshot,
        ticksPerCycle: latestCycleBeats * 960,
      };
      const inflections = Array.isArray(request.inflections)
        ? request.inflections
            .map((item) => item as Record<string, unknown>)
            .map((inflection) => ({
              afterBeat: Math.round(Number(inflection.position) * cycleBeats),
              changeProbability: Number(inflection.changeProbability) || 0,
              subdivisionWeights: inflection.subdivisionWeights,
              jathiWeights: inflection.jathiWeights,
            }))
            .filter(
              (inflection) =>
                inflection.afterBeat > 0 &&
                inflection.afterBeat < cycleBeats &&
                inflection.changeProbability > 0
            )
            .sort((a, b) => a.afterBeat - b.afterBeat)
        : [];

      let sectionIndex = 1;
      let gati = chooseWeighted(request.initialWeights, "subdivision", 4) ?? 4;
      let jathi = chooseWeighted(request.initialJathiWeights, "jathi", null);
      let inflectionIndex = 0;
      const velocity = Math.max(1, Math.min(127, Math.round(Number(request.velocity) || 96)));
      const pitch = Math.max(0, Math.min(127, Math.round(Number(request.pitch) || 60)));
      const beats = [];

      for (let beat = 1; beat <= cycleBeats; beat += 1) {
        let sectionStart = beat === 1;
        while (
          inflectionIndex < inflections.length &&
          inflections[inflectionIndex]?.afterBeat === beat - 1
        ) {
          const inflection = inflections[inflectionIndex]!;
          sectionIndex += 1;
          sectionStart = true;
          gati = driverOptions.forceSameGatiSections
            ? gati
            : chooseWeighted(inflection.subdivisionWeights, "subdivision", gati) ?? gati;
          jathi = chooseWeighted(inflection.jathiWeights, "jathi", jathi);
          inflectionIndex += 1;
        }

        beats.push({
          beat,
          start: beat - 1,
          end: beat,
          gati,
          effectiveGati: gati,
          sectionIndex,
          jathi,
          sectionStart,
          accentVelocity: sectionStart ? Math.min(127, velocity + 12) : velocity,
          pitch,
          baseVelocity: velocity,
          automationPhase: {
            numer: cycle * cycleBeats + (beat - 1),
            denom: cycleBeats,
          },
          automationValues: automationValues(request, beat, cycle),
        });
      }

      const sections = [];
      for (const beat of beats) {
        const current = sections.at(-1);
        if (!current || current.sectionIndex !== beat.sectionIndex) {
          sections.push({
            sectionIndex: beat.sectionIndex,
            startBeat: beat.beat,
            endBeat: beat.beat,
            gati: beat.gati,
            jathi: beat.jathi,
          });
        } else {
          current.endBeat = beat.beat;
        }
      }

      let spanId = 1;
      const pulseSpans = [];
      // Authored-leaf velocity at one section-relative matra, consistent with
      // the fabricated beats above: a beat's first matra carries that beat's
      // accentVelocity, interior matras its baseVelocity. This is the mock's
      // stand-in for the backend's per-matra leaf grid (`matraVelocities`).
      const matraVelocityAt = (section: { startBeat: number; gati: number }, sectionMatra: number) => {
        const beatIndex = section.startBeat - 1 + Math.floor(sectionMatra / section.gati);
        const beat = beats[Math.min(beatIndex, beats.length - 1)]!;
        return sectionMatra % section.gati === 0 ? beat.accentVelocity : beat.baseVelocity;
      };
      for (const section of sections) {
        const duration = section.endBeat - section.startBeat + 1;
        pulseSpans.push({
          id: spanId,
          kind: "section",
          sectionIndex: section.sectionIndex,
          beat: null,
          gati: section.gati,
          jathi: section.jathi,
          index: null,
          start: section.startBeat - 1,
          duration,
          startMatra: 0,
          matraLen: duration * section.gati,
          subdivision: section.gati,
          protectedCuts: [],
          tags: ["e2e", "section"],
          // Section spans never feed the generator seam; the backend leaves
          // them empty and so does the mock.
          matraVelocities: [] as number[],
        });
        spanId += 1;
        for (let beat = section.startBeat; beat <= section.endBeat; beat += 1) {
          const startMatra = (beat - section.startBeat) * section.gati;
          pulseSpans.push({
            id: spanId,
            kind: "gatiBeat",
            sectionIndex: section.sectionIndex,
            beat,
            gati: section.gati,
            jathi: null,
            index: beat - section.startBeat,
            start: beat - 1,
            duration: 1,
            startMatra,
            matraLen: section.gati,
            subdivision: section.gati,
            protectedCuts: [],
            tags: ["e2e", "gatiBeat"],
            matraVelocities: Array.from({ length: section.gati }, (_, matra) =>
              matraVelocityAt(section, startMatra + matra)
            ),
          });
          spanId += 1;
        }

        if (section.jathi && section.jathi > 0) {
          const totalMatras = duration * section.gati;
          if (totalMatras % section.jathi === 0) {
            const pulseCount = totalMatras / section.jathi;
            for (let index = 0; index < pulseCount; index += 1) {
              const startMatra = index * section.jathi;
              pulseSpans.push({
                id: spanId,
                kind: "jathiPulse",
                sectionIndex: section.sectionIndex,
                beat: null,
                gati: null,
                jathi: section.jathi,
                index: index + 1,
                start: section.startBeat - 1 + startMatra / section.gati,
                duration: section.jathi / section.gati,
                startMatra,
                matraLen: section.jathi,
                subdivision: section.gati,
                protectedCuts: [],
                tags: ["e2e", "jathiPulse"],
                matraVelocities: Array.from({ length: section.jathi }, (_, matra) =>
                  matraVelocityAt(section, startMatra + matra)
                ),
              });
              spanId += 1;
            }
          }
        }
      }

      return {
        cycle,
        beats,
        pulseSpans,
        historySeeds: Array.isArray(request.historySeeds)
          ? request.historySeeds.slice(0, Number(request.maxHistory) || 8)
          : [],
      };
    };

    const U64_MASK = (1n << 64n) - 1n;
    const u64 = (value: bigint): bigint => value & U64_MASK;
    const losslessU64 = (value: unknown): bigint => {
      try {
        return u64(BigInt(typeof value === "string" || typeof value === "number" ? value : 0));
      } catch {
        return 0n;
      }
    };
    const splitMix64Next = (state: bigint): { state: bigint; value: bigint } => {
      const nextState = u64(state + 0x9e37_79b9_7f4a_7c15n);
      let value = nextState;
      value = u64((value ^ (value >> 30n)) * 0xbf58_476d_1ce4_e5b9n);
      value = u64((value ^ (value >> 27n)) * 0x94d0_49bb_1331_11ebn);
      return { state: nextState, value: u64(value ^ (value >> 31n)) };
    };
    const mixSeed = (seed: bigint, cycle: bigint): bigint =>
      splitMix64Next(u64((seed ^ 0xa81f_3d2c_91b4_ee77n) + cycle)).value;
    const fnv1a64U64Le = (input: bigint): bigint => {
      let hash = 0xcbf2_9ce4_8422_2325n;
      let value = input;
      for (let index = 0; index < 8; index += 1) {
        hash = u64((hash ^ (value & 0xffn)) * 0x100_0000_01b3n);
        value >>= 8n;
      }
      return hash;
    };
    const resolveGeneratorSeedOnce = (
      seedMode: Record<string, unknown>,
      cycle: bigint
    ): { seed: bigint; source: string; history: string[] } => {
      if (
        seedMode.type !== "locked" &&
        seedMode.type !== "perCycle" &&
        seedMode.type !== "history"
      ) {
        throw new Error(`unknown generator seed mode: ${String(seedMode.type)}`);
      }
      const baseSeed = losslessU64(seedMode.seed);
      if (seedMode.type === "perCycle") {
        return { seed: mixSeed(baseSeed, cycle), source: "perCycle", history: [] };
      }
      if (seedMode.type !== "history") {
        return { seed: baseSeed, source: "locked", history: [] };
      }

      const maxHistory = Math.max(0, Math.floor(Number(seedMode.maxHistory) || 0));
      const history =
        maxHistory === 0
          ? []
          : (Array.isArray(seedMode.history) ? seedMode.history : [])
              .map(losslessU64)
              .slice(-maxHistory);
      const historyWeight = Math.max(0, Math.floor(Number(seedMode.historyWeight) || 0));
      const newSeedWeight = Math.max(0, Math.floor(Number(seedMode.newSeedWeight) || 0));
      const canUseHistory = maxHistory > 0 && history.length > 0 && historyWeight > 0;
      const canMakeNew = newSeedWeight > 0;
      if (!canUseHistory && !canMakeNew) {
        throw new Error("generator history mode needs a positive history or new-seed weight");
      }

      let rngState = mixSeed(baseSeed, cycle);
      const historyBand = canUseHistory ? BigInt(historyWeight) : 0n;
      const total = historyBand + (canMakeNew ? BigInt(newSeedWeight) : 0n);
      let draw = splitMix64Next(rngState);
      rngState = draw.state;
      if (canUseHistory && draw.value % total < historyBand) {
        draw = splitMix64Next(rngState);
        const selected = history[Number(draw.value % BigInt(history.length))]!;
        return {
          seed: selected,
          source: "history",
          history: history.map(String),
        };
      }

      draw = splitMix64Next(rngState);
      const learned = maxHistory > 0 ? [...history, draw.value].slice(-maxHistory) : [];
      return { seed: draw.value, source: "new", history: learned.map(String) };
    };
    const resolveGeneratorSeed = (
      seedMode: Record<string, unknown>,
      cycle: bigint
    ): { seed: bigint; source: string; history: string[] } => {
      if (seedMode.type !== "history") {
        return resolveGeneratorSeedOnce(seedMode, cycle);
      }
      const replayMode = {
        ...seedMode,
        history: Array.isArray(seedMode.history) ? [...seedMode.history] : [],
      };
      let resolved = resolveGeneratorSeedOnce(replayMode, 0n);
      for (let replayCycle = 1n; replayCycle <= cycle; replayCycle += 1n) {
        replayMode.history = resolved.history;
        resolved = resolveGeneratorSeedOnce(replayMode, replayCycle);
      }
      return resolved;
    };

    const MAX_STOPPED_GENERATOR_PREVIEW_CYCLE = 10_000;
    const LIVE_GENERATOR_PREVIEW_CYCLE_RADIUS = 2;

    const validateGeneratorPreviewCycle = (request: Record<string, unknown>): void => {
      const cycle = Math.max(0, Math.floor(Number(request.cycle) || 0));
      if (cycle <= MAX_STOPPED_GENERATOR_PREVIEW_CYCLE) return;

      const requestedTrackId =
        typeof request.trackId === "string" ? request.trackId : null;
      const liveCycles = snapshot.isPlaying
        ? [
            snapshot.currentCycle,
            ...snapshot.parallelTrackPositions
              .filter(
                (position) =>
                  requestedTrackId === null || position.trackId === requestedTrackId
              )
              .map((position) => position.cycle),
          ]
        : [];
      if (
        liveCycles.some(
          (liveCycle) =>
            Math.abs(cycle - liveCycle) <= LIVE_GENERATOR_PREVIEW_CYCLE_RADIUS
        )
      ) {
        return;
      }

      throw new Error(
        `generator preview cycle ${cycle} exceeds the stopped preview limit of ${MAX_STOPPED_GENERATOR_PREVIEW_CYCLE} and is not within ${LIVE_GENERATOR_PREVIEW_CYCLE_RADIUS} cycles of live playback`
      );
    };

    const dumkaPercent = (
      name:
        | "evolutionRate"
        | "driftLeash"
        | "densityFloor"
        | "densityCeiling"
        | "barlowTemperature"
        | "weightBarlowRemove"
        | "weightBarlowAdd"
        | "weightRotate"
        | "weightSyncopate"
        | "weightDesyncopate"
        | "weightFragment"
        | "weightConsolidate"
        | "fillComplexity"
        | "weightEuclid"
        | "euclidInvert"
        | "placementBias",
      raw: unknown,
      defaultValue: number,
      directiveId?: unknown
    ): number => {
      const value = raw === undefined ? defaultValue : raw;
      // Two distinct rejection layers, mirroring the real backend: a
      // non-u32 value (fractional, negative, non-numeric) never reaches the
      // generator — Tauri's serde boundary refuses it first — so the mock
      // must not fake the engine's DumkaRange Display for those. Only
      // in-range-typed but over-limit values reach validate() and earn the
      // engine's pinned message.
      if (
        typeof value !== "number" ||
        !Number.isFinite(value) ||
        !Number.isInteger(value) ||
        value < 0
      ) {
        throw new Error(
          `mock dumka preview rejected ${name} ${String(
            value
          )}: the engine's serde boundary refuses non-u32 values before generator validation`
        );
      }
      if (value > 100) {
        if (directiveId !== undefined) {
          throw new Error(
            `dumka plan invalid: directive ${String(directiveId)} ${name} must be 0-100, got ${value}`
          );
        }
        throw new Error(`dumka ${name} must be 0-100, got ${value}`);
      }
      return value;
    };

    const dumkaComplexity = (
      name: "complexityFloor" | "complexityCeiling",
      raw: unknown,
      defaultValue: number,
      directiveId?: unknown
    ): number => {
      const value = raw === undefined ? defaultValue : raw;
      if (
        typeof value !== "number" ||
        !Number.isFinite(value) ||
        !Number.isInteger(value) ||
        value < 0
      ) {
        throw new Error(
          `mock dumka preview rejected ${name} ${String(value)}: the engine's serde boundary refuses non-u32 values before generator validation`
        );
      }
      if (value > 100_000) {
        const scope =
          directiveId === undefined ? "" : `directive ${String(directiveId)} `;
        throw new Error(
          `dumka plan invalid: ${scope}${name} must be 0-100000, got ${value}`
        );
      }
      return value;
    };

    // Bit-exact mirror of the backend's `stamp_preview_cell_velocities`
    // (src-tauri/src/main.rs): a span with a non-empty `spanVelocities` entry
    // stamps each cell with the last authored entry at/before its start (the
    // dense-grid `note_leaf_for_offset` rule); other spans stay untouched, so
    // legacy requests keep velocity-less cells.
    const stampSpanVelocities = (
      request: Record<string, unknown>,
      spans: Array<{
        spanId: number;
        spanLen: number;
        cells: Array<Record<string, unknown>>;
      }>
    ) => {
      const entries = Array.isArray(request.spanVelocities) ? request.spanVelocities : [];
      const bySpan = new Map<number, number[]>();
      for (const entry of entries) {
        const item = entry as Record<string, unknown>;
        const velocities = Array.isArray(item.velocities)
          ? item.velocities.map((value) => Number(value))
          : [];
        bySpan.set(Number(item.spanId), velocities);
      }
      return spans.map((span) => {
        const velocities = bySpan.get(span.spanId);
        if (!velocities || velocities.length === 0) {
          return span;
        }
        return {
          ...span,
          cells: span.cells.map((cell) => ({
            ...cell,
            velocity:
              velocities[Math.min(Number(cell.start), velocities.length - 1)],
          })),
        };
      });
    };

    const buildGeneratorPreview = (request: Record<string, unknown>) => {
      const cycle = Math.max(0, Math.floor(Number(request.cycle) || 0));
      const spans = Array.isArray(request.spans) ? request.spans : [];
      const generator = (request.generator ?? {}) as Record<string, unknown>;
      if (generator.kind === "dumka") {
        // Mirrors the Rust preview: the config (pattern) validates even
        // while disabled; the structure check runs only when enabled. The
        // notation engine lives Node-side; the page receives precompiled
        // patterns (dumkaMockTable) and keeps only this integer projector.
        //
        // Evolution note: the mock does not port the evolution fold. Cycle 0
        // is always the seed verbatim, and a later cycle is seed-equivalent
        // only when evolution is provably inactive. Fail closed for an
        // evolving later cycle so a mock assertion cannot bless seed cells
        // that disagree with the real backend.
        const evolutionRate = dumkaPercent(
          "evolutionRate",
          generator.evolutionRate,
          0
        );
        const densityFloor = dumkaPercent(
          "densityFloor",
          generator.densityFloor,
          0
        );
        const densityCeiling = dumkaPercent(
          "densityCeiling",
          generator.densityCeiling,
          100
        );
        if (densityFloor > densityCeiling) {
          throw new Error(
            `dumka plan invalid: densityFloor must be at most densityCeiling, got ${densityFloor} > ${densityCeiling}`
          );
        }
        const complexityFloor = dumkaComplexity(
          "complexityFloor",
          generator.complexityFloor,
          0
        );
        const complexityCeiling = dumkaComplexity(
          "complexityCeiling",
          generator.complexityCeiling,
          100_000
        );
        if (complexityFloor > complexityCeiling) {
          throw new Error(
            `dumka plan invalid: complexityFloor must be at most complexityCeiling, got ${complexityFloor} > ${complexityCeiling}`
          );
        }
        dumkaPercent("driftLeash", generator.driftLeash, 25);
        dumkaPercent("barlowTemperature", generator.barlowTemperature, 0);
        dumkaPercent("weightBarlowRemove", generator.weightBarlowRemove, 3);
        dumkaPercent("weightBarlowAdd", generator.weightBarlowAdd, 3);
        dumkaPercent("weightRotate", generator.weightRotate, 2);
        dumkaPercent("weightSyncopate", generator.weightSyncopate, 0);
        dumkaPercent("weightDesyncopate", generator.weightDesyncopate, 0);
        dumkaPercent("weightFragment", generator.weightFragment, 0);
        dumkaPercent("weightConsolidate", generator.weightConsolidate, 0);
        dumkaPercent("fillComplexity", generator.fillComplexity, 0);
        dumkaPercent("weightEuclid", generator.weightEuclid, 0);
        dumkaPercent("euclidInvert", generator.euclidInvert, 0);
        dumkaPercent("placementBias", generator.placementBias, 0);
        {
          const rawMaxRun = generator.euclidMaxRun ?? 1;
          const maxRun = Number(rawMaxRun);
          if (!Number.isInteger(maxRun) || maxRun < 0) {
            throw new Error(
              `mock dumka preview rejected euclidMaxRun ${String(rawMaxRun)}: the engine's serde boundary refuses non-u32 values before generator validation`
            );
          }
          if (maxRun === 0 || maxRun > 8) {
            // Engine-pinned range error (GeneratorError::DumkaMaxRun).
            throw new Error(`dumka euclidMaxRun must be 1-8, got ${maxRun}`);
          }
        }
        const entry = driverOptions.dumkaMockTable[String(generator.pattern ?? "")];
        if (!entry) {
          throw new Error(
            `mock dumka preview has no precompiled entry for pattern: ${String(
              generator.pattern
            )} — add it to DUMKA_MOCK_PATTERNS in mockTauri.ts`
          );
        }
        if ("error" in entry) {
          throw new Error(entry.error);
        }
        const compiledSeed = entry.compiled;
        const rawPalette = generator.subdivisionPalette ?? [];
        if (!Array.isArray(rawPalette)) {
          throw new Error(
            "mock dumka preview rejected subdivisionPalette: the engine's serde boundary requires an array"
          );
        }
        const palette: number[] = [];
        for (const rawLevel of rawPalette) {
          if (
            typeof rawLevel !== "number" ||
            !Number.isInteger(rawLevel) ||
            rawLevel < 0
          ) {
            throw new Error(
              `mock dumka preview rejected subdivisionPalette entry ${String(rawLevel)}: the engine's serde boundary refuses non-u32 values before generator validation`
            );
          }
          if (![2, 3, 5, 7].includes(rawLevel)) {
            throw new Error(
              `dumka subdivisionPalette entries must be 2, 3, 5, or 7, got ${rawLevel}`
            );
          }
          if (!palette.includes(rawLevel)) palette.push(rawLevel);
        }
        if (palette.length > 2) {
          throw new Error(
            `dumka subdivisionPalette supports at most 2 levels, got ${palette.length}`
          );
        }
        const workingSubdivision = palette.reduce(
          (working, level) => working * level,
          compiledSeed.requiredSubdivision
        );
        if (workingSubdivision > 64) {
          throw new Error(
            `dumka subdivisionPalette needs working Subdivision ${workingSubdivision}, above the platform maximum 64`
          );
        }
        if (generator.plan !== undefined && !Array.isArray(generator.plan)) {
          throw new Error(
            "mock dumka preview rejected plan: the engine's serde boundary requires an array"
          );
        }
        const planRows = Array.isArray(generator.plan) ? generator.plan : [];
        if (planRows.length > 256) {
          throw new Error(
            `dumka plan invalid: plan supports at most 256 directives, got ${planRows.length}`
          );
        }
        const knownFamilies = [
          "barlowRemove",
          "barlowAdd",
          "rotate",
          "syncopate",
          "desyncopate",
          "fragment",
          "consolidate",
          "euclid",
          "stochastic",
          "morph",
        ];
        const requireUnsignedInteger = (
          value: unknown,
          label: string
        ): number => {
          if (
            typeof value !== "number" ||
            !Number.isFinite(value) ||
            !Number.isInteger(value) ||
            value < 0
          ) {
            throw new Error(
              `mock dumka preview rejected ${label} ${String(value)}: the engine's serde boundary refuses unsigned-integer values before generator validation`
            );
          }
          return value;
        };
        const rejectUnknownKeys = (
          object: Record<string, unknown>,
          allowed: readonly string[],
          label: string
        ) => {
          const unknown = Object.keys(object).find(
            (key) => !allowed.includes(key)
          );
          if (unknown) {
            throw new Error(
              `mock dumka preview rejected unknown ${label} key ${unknown}: the engine's serde boundary denies unknown fields`
            );
          }
        };
        if (
          generator.evolutionCurve !== undefined &&
          (typeof generator.evolutionCurve !== "object" ||
            generator.evolutionCurve === null ||
            Array.isArray(generator.evolutionCurve))
        ) {
          throw new Error(
            "mock dumka preview rejected evolutionCurve: the engine's serde boundary requires an object"
          );
        }
        const curve =
          typeof generator.evolutionCurve === "object" &&
          generator.evolutionCurve !== null
            ? (generator.evolutionCurve as Record<string, unknown>)
            : {};
        rejectUnknownKeys(
          curve,
          ["enabled", "modelVersion", "toleranceMilli", "maxOperations", "points"],
          "evolutionCurve"
        );
        if (
          curve.modelVersion !== undefined &&
          curve.modelVersion !== "v1"
        ) {
          throw new Error(
            `mock dumka preview rejected curve modelVersion ${String(curve.modelVersion)}: the engine's serde boundary refuses unknown versions`
          );
        }
        const curvePoints = Array.isArray(curve.points) ? curve.points : [];
        if (curvePoints.length > 64) {
          throw new Error(
            `dumka plan invalid: curve supports at most 64 points, got ${curvePoints.length}`
          );
        }
        const normalizedCurvePoints: Array<{ cycle: number; targetMilli: number }> = [];
        let priorCurveCycle: number | null = null;
        for (const rawPoint of curvePoints) {
          if (typeof rawPoint !== "object" || rawPoint === null) {
            throw new Error(
              "mock dumka preview rejected evolutionCurve point: the engine's serde boundary requires an object"
            );
          }
          const point = rawPoint as Record<string, unknown>;
          rejectUnknownKeys(point, ["cycle", "targetMilli"], "curve point");
          const pointCycle = requireUnsignedInteger(
            point.cycle,
            "curve point cycle"
          );
          const targetMilli = requireUnsignedInteger(
            point.targetMilli,
            "curve targetMilli"
          );
          if (pointCycle === 0) {
            throw new Error(
              "dumka plan invalid: curve point cycles must be ≥ 1"
            );
          }
          if (priorCurveCycle !== null && pointCycle <= priorCurveCycle) {
            throw new Error(
              "dumka plan invalid: curve points must have strictly ascending cycles"
            );
          }
          if (targetMilli > 100_000) {
            throw new Error(
              `dumka plan invalid: curve targetMilli must be 0-100000, got ${targetMilli}`
            );
          }
          priorCurveCycle = pointCycle;
          normalizedCurvePoints.push({ cycle: pointCycle, targetMilli });
        }
        const curveTolerance = requireUnsignedInteger(
          curve.toleranceMilli ?? 500,
          "curve toleranceMilli"
        );
        if (curveTolerance > 100_000) {
          throw new Error(
            `dumka plan invalid: curve toleranceMilli must be 0-100000, got ${curveTolerance}`
          );
        }
        const curveMaxOperations = requireUnsignedInteger(
          curve.maxOperations ?? 4,
          "curve maxOperations"
        );
        if (curveMaxOperations === 0 || curveMaxOperations > 8) {
          throw new Error(
            `dumka plan invalid: curve maxOperations must be 1-8, got ${curveMaxOperations}`
          );
        }
        if (normalizedCurvePoints.length > 1) {
          const curveSpan =
            normalizedCurvePoints[normalizedCurvePoints.length - 1]!.cycle -
            normalizedCurvePoints[0]!.cycle;
          if (curveSpan > 512) {
            throw new Error(
              `dumka plan invalid: curve spans ${curveSpan} cycles between its first and last points, the maximum is 512`
            );
          }
        }
        const curveTargetMilliAt = (sampleCycle: number): number => {
          if (
            curve.enabled !== true ||
            normalizedCurvePoints.length === 0 ||
            sampleCycle < normalizedCurvePoints[0]!.cycle ||
            sampleCycle >
              normalizedCurvePoints[normalizedCurvePoints.length - 1]!.cycle
          ) {
            return 0;
          }
          let previous = normalizedCurvePoints[0]!;
          for (const point of normalizedCurvePoints) {
            if (point.cycle === sampleCycle) return point.targetMilli;
            if (point.cycle > sampleCycle) {
              const span = point.cycle - previous.cycle;
              const offset = sampleCycle - previous.cycle;
              const numerator =
                (point.targetMilli - previous.targetMilli) * offset;
              const half = Math.trunc(span / 2);
              const rounded =
                numerator >= 0
                  ? Math.trunc((numerator + half) / span)
                  : Math.trunc((numerator - half) / span);
              return Math.min(
                100_000,
                Math.max(0, previous.targetMilli + rounded)
              );
            }
            previous = point;
          }
          return 0;
        };
        let requestedPerceptualWork = 0;
        if (curve.enabled === true && normalizedCurvePoints.length > 0) {
          const firstCurveCycle = Math.max(
            1,
            normalizedCurvePoints[0]!.cycle
          );
          const lastCurveCycle =
            normalizedCurvePoints[normalizedCurvePoints.length - 1]!.cycle;
          for (
            let sampleCycle = firstCurveCycle;
            sampleCycle <= lastCurveCycle;
            sampleCycle += 1
          ) {
            if (curveTargetMilliAt(sampleCycle) > 0) {
              requestedPerceptualWork += curveMaxOperations + 1;
            }
          }
        }
        const seenDirectiveIds = new Set<number>();
        for (const rawDirective of planRows) {
          if (typeof rawDirective !== "object" || rawDirective === null) {
            throw new Error(
              "mock dumka preview rejected directive: the engine's serde boundary requires an object"
            );
          }
          const directive = rawDirective as Record<string, unknown>;
          rejectUnknownKeys(
            directive,
            [
              "id",
              "order",
              "enabled",
              "fromCycle",
              "toCycle",
              "family",
              "pacing",
              "magnitude",
              "intensity",
              "scope",
              "options",
            ],
            "directive"
          );
          const directiveId = requireUnsignedInteger(
            directive.id,
            "directive id"
          );
          if (directiveId === 0) {
            throw new Error(
              "dumka plan invalid: directive id must be at least 1"
            );
          }
          if (directiveId >= Number.MAX_SAFE_INTEGER) {
            throw new Error(
              `dumka plan invalid: directive id ${directiveId} collides with the reserved curve sentinel ${Number.MAX_SAFE_INTEGER}`
            );
          }
          if (seenDirectiveIds.has(directiveId)) {
            throw new Error(
              `dumka plan invalid: duplicate directive id ${directiveId}`
            );
          }
          seenDirectiveIds.add(directiveId);
          requireUnsignedInteger(
            directive.order,
            `directive ${directiveId} order`
          );
          if (typeof directive.enabled !== "boolean") {
            throw new Error(
              `mock dumka preview rejected directive ${directiveId} enabled ${String(directive.enabled)}: the engine's serde boundary requires a boolean`
            );
          }
          const fromCycle = requireUnsignedInteger(
            directive.fromCycle,
            `directive ${directiveId} fromCycle`
          );
          const toCycle = requireUnsignedInteger(
            directive.toCycle,
            `directive ${directiveId} toCycle`
          );
          const intensity = requireUnsignedInteger(
            directive.intensity,
            `directive ${directiveId} intensity`
          );
          if (fromCycle === 0) {
            throw new Error(
              `dumka plan invalid: directive ${directiveId} fromCycle must be at least 1`
            );
          }
          if (toCycle < fromCycle) {
            throw new Error(
              `dumka plan invalid: directive ${directiveId} toCycle must be at least fromCycle`
            );
          }
          if (intensity > 100) {
            throw new Error(
              `dumka plan invalid: directive ${directiveId} intensity must be 0-100, got ${intensity}`
            );
          }
          if (!knownFamilies.includes(String(directive.family))) {
            throw new Error(
              `mock dumka preview rejected directive ${directiveId} family ${String(directive.family)}: the engine's serde boundary refuses unknown families`
            );
          }
          const pacing = directive.pacing ?? "perCycle";
          if (!["perCycle", "linear", "easeInOut"].includes(String(pacing))) {
            throw new Error(
              `mock dumka preview rejected directive ${directiveId} pacing ${String(pacing)}: the engine's serde boundary refuses unknown pacing`
            );
          }
          if (
            directive.magnitude !== undefined &&
            (typeof directive.magnitude !== "object" ||
              directive.magnitude === null ||
              Array.isArray(directive.magnitude))
          ) {
            throw new Error(
              `mock dumka preview rejected directive ${directiveId} magnitude: the engine's serde boundary requires an object`
            );
          }
          const magnitude = (directive.magnitude ?? {
            mode: "operationQuota",
          }) as Record<string, unknown>;
          rejectUnknownKeys(
            magnitude,
            magnitude.mode === "perceptual"
              ? [
                  "mode",
                  "modelVersion",
                  "targetMilli",
                  "toleranceMilli",
                  "maxOperations",
                ]
              : ["mode"],
            `directive ${directiveId} magnitude`
          );
          if (magnitude.mode === "perceptual") {
            if (magnitude.modelVersion !== "v1") {
              throw new Error(
                `mock dumka preview rejected directive ${directiveId} magnitude modelVersion ${String(magnitude.modelVersion)}: the engine's serde boundary refuses unknown versions`
              );
            }
            const targetMilli = requireUnsignedInteger(
              magnitude.targetMilli,
              `directive ${directiveId} magnitude targetMilli`
            );
            const toleranceMilli = requireUnsignedInteger(
              magnitude.toleranceMilli,
              `directive ${directiveId} magnitude toleranceMilli`
            );
            const maxOperations = requireUnsignedInteger(
              magnitude.maxOperations,
              `directive ${directiveId} magnitude maxOperations`
            );
            if (targetMilli > 100_000) {
              throw new Error(
                `dumka plan invalid: directive ${directiveId} magnitude targetMilli must be 0-100000, got ${targetMilli}`
              );
            }
            if (toleranceMilli > 100_000) {
              throw new Error(
                `dumka plan invalid: directive ${directiveId} magnitude toleranceMilli must be 0-100000, got ${toleranceMilli}`
              );
            }
            if (maxOperations === 0 || maxOperations > 256) {
              throw new Error(
                `dumka plan invalid: directive ${directiveId} magnitude maxOperations must be 1-256, got ${maxOperations}`
              );
            }
            if (pacing !== "perCycle") {
              throw new Error(
                `dumka plan invalid: directive ${directiveId} perceptual magnitude pacing must be perCycle`
              );
            }
            if (directive.family === "stochastic") {
              throw new Error(
                `dumka plan invalid: directive ${directiveId} stochastic magnitude must be operationQuota`
              );
            }
            if (directive.enabled === true) {
              requestedPerceptualWork +=
                (toCycle - fromCycle + 1) * (maxOperations + 1);
            }
          } else if (magnitude.mode !== "operationQuota") {
            throw new Error(
              `mock dumka preview rejected directive ${directiveId} magnitude ${String(magnitude.mode)}: the engine's serde boundary refuses unknown magnitudes`
            );
          }
          if (typeof directive.scope === "object" && directive.scope !== null) {
            const scope = directive.scope as Record<string, unknown>;
            rejectUnknownKeys(
              scope,
              ["startBeat", "lenBeats"],
              `directive ${directiveId} scope`
            );
            requireUnsignedInteger(
              scope.startBeat,
              `directive ${directiveId} scope startBeat`
            );
            const lenBeats = requireUnsignedInteger(
              scope.lenBeats,
              `directive ${directiveId} scope lenBeats`
            );
            if (lenBeats === 0) {
              throw new Error(
                `dumka plan invalid: directive ${directiveId} scope lenBeats must be at least 1`
              );
            }
          }
          if (
            directive.scope !== undefined &&
            directive.scope !== null &&
            typeof directive.scope !== "object"
          ) {
            throw new Error(
              `mock dumka preview rejected directive ${directiveId} scope: the engine's serde boundary requires an object or null`
            );
          }
          if (directive.family === "stochastic" && pacing !== "perCycle") {
            throw new Error(
              `dumka plan invalid: directive ${directiveId} stochastic pacing must be perCycle`
            );
          }
          if (
            directive.options !== undefined &&
            (typeof directive.options !== "object" ||
              directive.options === null ||
              Array.isArray(directive.options))
          ) {
            throw new Error(
              `mock dumka preview rejected directive ${directiveId} options: the engine's serde boundary requires an object`
            );
          }
          const options = (directive.options ?? {}) as Record<string, unknown>;
          rejectUnknownKeys(
            options,
            [
              "barlowTemperature",
              "fillComplexity",
              "densityFloor",
              "densityCeiling",
              "complexityFloor",
              "complexityCeiling",
              "placementBias",
              "subdivisionLevel",
              "morphTarget",
              "euclidMaxRun",
              "euclidInvert",
              "euclidRestPolicy",
              "rotateDirection",
            ],
            `directive ${directiveId} options`
          );
          for (const optionName of [
            "barlowTemperature",
            "fillComplexity",
            "euclidInvert",
            "densityFloor",
            "densityCeiling",
            "placementBias",
          ] as const) {
            const optionValue = options[optionName];
            if (optionValue !== null && optionValue !== undefined) {
              dumkaPercent(
                optionName,
                optionValue,
                0,
                directiveId
              );
            }
          }
          const localDensityFloor =
            options.densityFloor === null || options.densityFloor === undefined
              ? null
              : Number(options.densityFloor);
          const localDensityCeiling =
            options.densityCeiling === null || options.densityCeiling === undefined
              ? null
              : Number(options.densityCeiling);
          if ((localDensityFloor === null) !== (localDensityCeiling === null)) {
            throw new Error(
              `dumka plan invalid: directive ${directiveId} densityFloor and densityCeiling must both be set or both be omitted`
            );
          }
          if (
            localDensityFloor !== null &&
            localDensityCeiling !== null &&
            localDensityFloor > localDensityCeiling
          ) {
            throw new Error(
              `dumka plan invalid: directive ${directiveId} densityFloor must be at most densityCeiling, got ${localDensityFloor} > ${localDensityCeiling}`
            );
          }
          const localComplexityFloor =
            options.complexityFloor === null || options.complexityFloor === undefined
              ? null
              : requireUnsignedInteger(
                  options.complexityFloor,
                  `directive ${directiveId} complexityFloor`
                );
          const localComplexityCeiling =
            options.complexityCeiling === null || options.complexityCeiling === undefined
              ? null
              : requireUnsignedInteger(
                  options.complexityCeiling,
                  `directive ${directiveId} complexityCeiling`
                );
          if ((localComplexityFloor === null) !== (localComplexityCeiling === null)) {
            throw new Error(
              `dumka plan invalid: directive ${String(directive.id)} complexityFloor and complexityCeiling must both be set or both be omitted`
            );
          }
          if (
            localComplexityFloor !== null &&
            localComplexityCeiling !== null &&
            localComplexityFloor > localComplexityCeiling
          ) {
            throw new Error(
              `dumka plan invalid: directive ${String(directive.id)} complexityFloor must be at most complexityCeiling, got ${localComplexityFloor} > ${localComplexityCeiling}`
            );
          }
          if (
            localComplexityFloor !== null &&
            localComplexityCeiling !== null &&
            (localComplexityFloor > 100_000 ||
              localComplexityCeiling > 100_000)
          ) {
            const [name, value] =
              localComplexityFloor > 100_000
                ? ["complexityFloor", localComplexityFloor]
                : ["complexityCeiling", localComplexityCeiling];
            throw new Error(
              `dumka plan invalid: directive ${directiveId} ${name} must be 0-100000, got ${value}`
            );
          }
          if (options.euclidMaxRun !== null && options.euclidMaxRun !== undefined) {
            const maxRun = requireUnsignedInteger(
              options.euclidMaxRun,
              `directive ${directiveId} euclidMaxRun`
            );
            if (maxRun === 0 || maxRun > 8) {
              throw new Error(
                `dumka plan invalid: directive ${directiveId} euclidMaxRun must be 1-8, got ${maxRun}`
              );
            }
          }
          if (
            options.subdivisionLevel !== null &&
            options.subdivisionLevel !== undefined
          ) {
            if (
              typeof options.subdivisionLevel !== "number" ||
              !Number.isInteger(options.subdivisionLevel) ||
              options.subdivisionLevel < 0 ||
              options.subdivisionLevel > 0xffff_ffff
            ) {
              throw new Error(
                `mock dumka preview rejected directive ${directiveId} subdivisionLevel ${String(options.subdivisionLevel)}: the engine's serde boundary refuses non-u32 values before generator validation`
              );
            }
            const level = options.subdivisionLevel;
            if (!palette.includes(level)) {
              throw new Error(
                `dumka plan invalid: directive ${directiveId} subdivisionLevel ${String(options.subdivisionLevel)} is not an enabled palette prime`
              );
            }
          }
          if (directive.family === "morph") {
            const target = options.morphTarget;
            if (typeof target !== "string" || target.trim().length === 0) {
              throw new Error(
                `dumka plan invalid: directive ${directiveId} morph requires options.morphTarget`
              );
            }
            if (directive.enabled !== true) continue;
            const targetEntry = driverOptions.dumkaMockTable[target];
            if (!targetEntry) {
              throw new Error(
                `mock dumka preview has no precompiled entry for Morph target: ${target} — add it to DUMKA_MOCK_PATTERNS in mockTauri.ts`
              );
            }
            if ("error" in targetEntry) throw new Error(targetEntry.error);
            if (targetEntry.compiled.events.length === 0) {
              throw new Error(
                `dumka plan invalid: directive ${directiveId} morph target must contain at least one sounding onset`
              );
            }
            if (targetEntry.compiled.totalBeats !== compiledSeed.totalBeats) {
              throw new Error(
                `dumka plan invalid: directive ${directiveId} morph target spans ${targetEntry.compiled.totalBeats} beats but the seed spans ${compiledSeed.totalBeats}`
              );
            }
            if (workingSubdivision % targetEntry.compiled.requiredSubdivision !== 0) {
              throw new Error(
                `dumka plan invalid: directive ${directiveId} morph target needs Subdivision ${targetEntry.compiled.requiredSubdivision} which does not divide working Subdivision ${workingSubdivision}`
              );
            }
          } else if (
            options.morphTarget !== null &&
            options.morphTarget !== undefined
          ) {
            throw new Error(
              `dumka plan invalid: directive ${directiveId} morphTarget is only valid for morph`
            );
          }
        }
        if (requestedPerceptualWork > 4_096) {
          throw new Error(
            `dumka perceptual plan reserves ${Math.trunc(requestedPerceptualWork)} scoring operations, exceeding the limit of 4096`
          );
        }
        for (let leftIndex = 0; leftIndex < planRows.length; leftIndex += 1) {
          const left = planRows[leftIndex] as Record<string, unknown>;
          for (let rightIndex = leftIndex + 1; rightIndex < planRows.length; rightIndex += 1) {
            const right = planRows[rightIndex] as Record<string, unknown>;
            if (left.family !== right.family) continue;
            const firstShared = Math.max(
              Number(left.fromCycle),
              Number(right.fromCycle)
            );
            if (
              firstShared <=
              Math.min(Number(left.toCycle), Number(right.toCycle))
            ) {
              throw new Error(
                `dumka plan overlap: ${String(left.family)} directives ${String(left.id)} and ${String(right.id)} share cycle ${firstShared}`
              );
            }
          }
        }
        const seedMode = (generator.seedMode ?? {}) as Record<string, unknown>;
        const seed = resolveGeneratorSeed(seedMode, BigInt(cycle));
        const seedDto = {
          seed: String(seed.seed),
          source: seed.source,
          history: seed.history,
        };
        if (request.enabled === false) {
          return { seed: seedDto, spans: [], trace: [] };
        }
        const sampledDensityFloor = sampleAutomationTarget(
          request,
          "generator.dumka.densityFloor",
          1,
          cycle,
          densityFloor
        );
        const sampledDensityCeiling = sampleAutomationTarget(
          request,
          "generator.dumka.densityCeiling",
          1,
          cycle,
          densityCeiling
        );
        const effectiveDensityCeiling = Math.max(
          0,
          Math.min(
            100,
            Math.round(sampledDensityCeiling ?? densityCeiling)
          )
        );
        const effectiveDensityFloor = Math.min(
          effectiveDensityCeiling,
          Math.max(
            0,
            Math.min(
              100,
              Math.round(sampledDensityFloor ?? densityFloor)
            )
          )
        );
        const sampledComplexityFloor = sampleAutomationTarget(
          request,
          "generator.dumka.complexityFloor",
          1,
          cycle,
          complexityFloor
        );
        const sampledComplexityCeiling = sampleAutomationTarget(
          request,
          "generator.dumka.complexityCeiling",
          1,
          cycle,
          complexityCeiling
        );
        const effectiveComplexityCeiling = Math.max(
          0,
          Math.min(
            100_000,
            Math.round(sampledComplexityCeiling ?? complexityCeiling)
          )
        );
        const effectiveComplexityFloor = Math.min(
          effectiveComplexityCeiling,
          Math.max(
            0,
            Math.min(
              100_000,
              Math.round(sampledComplexityFloor ?? complexityFloor)
            )
          )
        );
        const evolutionIsAutomated = hasEnabledAutomationSource(
          request,
          "generator.dumka.evolutionRate"
        );
        const densityIsAutomated =
          hasEnabledAutomationSource(request, "generator.dumka.densityFloor") ||
          hasEnabledAutomationSource(request, "generator.dumka.densityCeiling");
        const complexityIsAutomated =
          hasEnabledAutomationSource(
            request,
            "generator.dumka.complexityFloor"
          ) ||
          hasEnabledAutomationSource(
            request,
            "generator.dumka.complexityCeiling"
          );
        const hasEnabledPlan =
          Array.isArray(generator.plan) &&
          generator.plan.some(
            (directive) =>
              typeof directive === "object" &&
              directive !== null &&
              (directive as Record<string, unknown>).enabled === true
          );
        // The composition curve replaces the stochastic layer; any active
        // curve makes cycles ≥ 1 evolving work the mock must refuse.
        const curveRaw = generator.evolutionCurve as
          | { enabled?: unknown; points?: unknown }
          | undefined;
        const hasActiveCurve =
          typeof curveRaw === "object" &&
          curveRaw !== null &&
          curveRaw.enabled === true &&
          Array.isArray(curveRaw.points) &&
          curveRaw.points.some(
            (point) =>
              typeof point === "object" &&
              point !== null &&
              Number((point as Record<string, unknown>).targetMilli) > 0
          );
        // A drawn property curve steers directive-free cycles (M3.97 §4). Any
        // enabled curve with points evolves the state from cycle 1 on — even a
        // target of 0 is a real level — so cycles ≥ 1 are steered work the mock
        // does not port and must refuse, exactly like the aggregate curve.
        const propertyCurvesRaw = generator.propertyCurves;
        const hasActivePropertyCurve =
          Array.isArray(propertyCurvesRaw) &&
          propertyCurvesRaw.some((curve) => {
            if (typeof curve !== "object" || curve === null) return false;
            const record = curve as Record<string, unknown>;
            return (
              record.enabled === true &&
              Array.isArray(record.points) &&
              record.points.length > 0
            );
          });
        if (
          cycle > 0 &&
          (evolutionRate > 0 ||
            evolutionIsAutomated ||
            effectiveDensityFloor > 0 ||
            effectiveDensityCeiling < 100 ||
            densityIsAutomated ||
            effectiveComplexityFloor > 0 ||
            effectiveComplexityCeiling < 100_000 ||
            complexityIsAutomated ||
            hasEnabledPlan ||
            hasActiveCurve ||
            hasActivePropertyCurve)
        ) {
          throw new Error(
            `mock dumka preview cannot resolve evolving cycle ${cycle}; use the real-backend lane`
          );
        }
        const cycleBeats = Math.max(1, Math.round(Number(request.cycleBeats) || 0));
        const structureError = (message: string) => {
          throw new Error(`dumka structure mismatch: ${message}`);
        };
        if (cycleBeats !== compiledSeed.totalBeats) {
          structureError(
            `pattern spans ${compiledSeed.totalBeats} beats but the cycle has ${cycleBeats}`
          );
        }
        const spanInputs = spans.map((span, index) => {
          const item = span as Record<string, unknown>;
          return {
            spanId: Number(item.spanId) || index + 1,
            spanLen: Number(item.spanLen),
            subdivision: Number(item.subdivision),
          };
        });
        const totalMatras = spanInputs.reduce((sum, span) => sum + span.spanLen, 0);
        const actualSubdivision = spanInputs[0]?.subdivision ?? 0;
        const uniformSubdivision =
          Number.isInteger(actualSubdivision) &&
          actualSubdivision > 0 &&
          actualSubdivision <= 0xffffffff &&
          spanInputs.every(
            (span) =>
              Number.isInteger(span.spanLen) &&
              span.spanLen > 0 &&
              span.spanLen <= 0xffffffff &&
              span.subdivision === actualSubdivision
          ) &&
          totalMatras === cycleBeats * actualSubdivision;
        if (totalMatras === 0 || !uniformSubdivision) {
          structureError(
            `spans carry ${totalMatras} steps over ${cycleBeats} beats; a uniform per-beat Subdivision is required`
          );
        }
        if (actualSubdivision % workingSubdivision !== 0) {
          structureError(
            `pattern needs Subdivision ${workingSubdivision} (or a multiple); the section has ${actualSubdivision}`
          );
        }
        const intervals = compiledSeed.events.map((event) => {
          const start = (event.start.num * actualSubdivision) / event.start.den;
          return {
            start,
            end: start + (event.dur.num * actualSubdivision) / event.dur.den,
          };
        });
        const outSpans = [];
        let spanStart = 0;
        let eventIndex = 0;
        for (const span of spanInputs) {
          const spanEnd = spanStart + span.spanLen;
          const cells = [];
          let cursor = spanStart;
          while (cursor < spanEnd) {
            while (
              eventIndex < intervals.length &&
              intervals[eventIndex]!.end <= cursor
            ) {
              eventIndex += 1;
            }
            const next = intervals[eventIndex];
            let to = spanEnd;
            let rest = true;
            let tiedFromPrevious = false;
            let tiedToNext = false;
            if (next && next.start <= cursor && next.end > cursor) {
              to = Math.min(next.end, spanEnd);
              rest = false;
              tiedFromPrevious = next.start < cursor;
              tiedToNext = next.end > spanEnd;
              if (!tiedToNext) eventIndex += 1;
            } else if (next && next.start < spanEnd) {
              to = next.start;
            }
            cells.push({
              index: cells.length,
              start: cursor - spanStart,
              len: to - cursor,
              rest,
              tiedFromPrevious,
              tiedToNext,
            });
            cursor = to;
          }
          outSpans.push({ spanId: span.spanId, spanLen: span.spanLen, cells });
          spanStart = spanEnd;
        }
        // Whole-cycle calibration readout, mirrored bit-exactly: the mock
        // only ever resolves verbatim repeats here, so cycle ≥ 1 scores an
        // honest 0 when the grid has published Barlow tables; cycle 0 and
        // >7-prime grids have no readout, matching the engine contract.
        const cycleDistance =
          cycle >= 1 && entry.gridSupported
            ? { modelVersion: "v1" as const, distanceMilli: 0 }
            : null;
        const depthMetrics = entry.depthMetrics[String(workingSubdivision)];
        if (!depthMetrics) {
          throw new Error(
            `mock dumka preview has no precomputed depth metrics for working Subdivision ${workingSubdivision}`
          );
        }
        return {
          seed: seedDto,
          spans: stampSpanVelocities(request, outSpans),
          trace: [],
          densityCorridor: {
            floor: effectiveDensityFloor,
            ceiling: effectiveDensityCeiling,
          },
          workingSubdivision,
          complexityCorridor: {
            floor: effectiveComplexityFloor,
            ceiling: effectiveComplexityCeiling,
          },
          stateComplexityMilli: depthMetrics.complexityMilli,
          stateDepthDiversityMilli: depthMetrics.diversityMilli,
          propertyProfile: depthMetrics.profile,
          cycleDistance,
        };
      }
      if (generator.kind !== "example") {
        throw new Error(`unknown generator kind: ${String(generator.kind)}`);
      }
      const seedMode = (generator.seedMode ?? {}) as Record<string, unknown>;
      const seed = resolveGeneratorSeed(seedMode, BigInt(cycle));
      const staticDensity =
        generator.densityPercent === undefined ? 100 : Number(generator.densityPercent);
      if (
        !Number.isInteger(staticDensity) ||
        staticDensity < 0 ||
        staticDensity > 100
      ) {
        throw new Error(
          `example density must be 0-100, got ${String(generator.densityPercent)}`
        );
      }
      const automatedDensity = sampleAutomationTarget(
        request,
        "generator.example.density",
        1,
        cycle,
        staticDensity
      );
      const density = Math.max(
        0,
        Math.min(
          100,
          Math.round(
            automatedDensity ?? staticDensity
          )
        )
      );
      return {
        seed: {
          seed: String(seed.seed),
          source: seed.source,
          history: seed.history,
        },
        spans: request.enabled === false
          ? []
          : stampSpanVelocities(
              request,
              spans.map((span, index) => {
                const item = span as Record<string, unknown>;
                const spanLen = Math.max(1, Math.round(Number(item.spanLen) || 1));
                const spanId = losslessU64(item.spanId ?? index + 1);
                const spanStream =
                  seed.seed ^ fnv1a64U64Le(spanId) ^ 0xe8a6_0d31_5eed_0001n;
                return {
                  spanId: Number(item.spanId) || index + 1,
                  spanLen,
                  cells: Array.from({ length: spanLen }, (_, cellIndex) => {
                    const sounds =
                      density >= 100 ||
                      (density > 0 &&
                        splitMix64Next(mixSeed(spanStream, BigInt(cellIndex))).value % 100n <
                          BigInt(density));
                    return {
                      index: cellIndex,
                      start: cellIndex,
                      len: 1,
                      rest: !sounds,
                      tiedFromPrevious: false,
                      tiedToNext: false,
                    };
                  }),
                };
              })
            ),
        trace: [],
      };
    };

    const resolvePreview = (
      cycle: number,
      request: Record<string, unknown>,
      resolve: (preview: unknown) => void
    ) => {
      const preview = buildPreview(request, cycle);
      assertBackendContractShape("score_preview_subdivision_switch", preview);
      lastPreview = clone(preview);
      const finish = () => resolve(clone(preview));
      if (previewDelayMs > 0) {
        window.setTimeout(finish, previewDelayMs);
      } else {
        finish();
      }
    };

    const driver = {
      async invoke(command: string, args?: unknown) {
        calls.push({ sequence: ++sequence, command, args: clone(args) });
        const delayMs = commandDelays.get(command) ?? 0;
        if (delayMs > 0) {
          await new Promise<void>((resolve) => window.setTimeout(resolve, delayMs));
        }
        const forcedFailure = commandFailures.get(command);
        if (forcedFailure) {
          throw new Error(forcedFailure);
        }
        switch (command) {
          case "transport_get_snapshot": {
            // Mirror the real backend: a forced read advances the shared epoch
            // so the hydrate shares the stream's monotonic epoch space.
            telemetryEpoch += 1;
            return clone({
              ...snapshot,
              sampleEpoch: telemetryEpoch,
              timelineEpoch: telemetryEpoch,
              logEpoch: telemetryEpoch,
            });
          }
          case "transport_set_telemetry_interest": {
            const interest = (
              args as { interest?: TelemetryLogInterest } | undefined
            )?.interest;
            if (
              interest &&
              interest !== telemetryLogInterest
            ) {
              telemetryLogInterest = interest;
              hydrateTransportLog();
            }
            return undefined;
          }
          case "transport_play":
            snapshot = makeSnapshot(0, true);
            emitTransport(snapshot);
            return undefined;
          case "transport_stop":
            snapshot = { ...snapshot, isPlaying: false, currentTick: 0 };
            emitTransport(snapshot);
            return undefined;
          case "transport_resync":
            snapshot = makeSnapshot(0, false);
            emitTransport(snapshot);
            return undefined;
          case "transport_set_tempo": {
            const bpm = Number((args as { bpm?: unknown } | undefined)?.bpm);
            if (Number.isFinite(bpm)) snapshot = { ...snapshot, tempoBpm: bpm };
            emitTransport(snapshot);
            return undefined;
          }
          case "score_preview_subdivision_switch": {
            const payload = args as
              | { request?: Record<string, unknown>; cycle?: unknown }
              | undefined;
            const request = payload?.request ?? {};
            const cycle = Math.max(0, Math.floor(Number(payload?.cycle) || 0));
            lastPreviewRequest = { request: clone(request), cycle };
            if (heldPreviewCycles.has(cycle)) {
              return await new Promise((resolve) => {
                pendingPreviews.push({ cycle, resolve, request: clone(request) });
              });
            }
            return await new Promise((resolve) => resolvePreview(cycle, request, resolve));
          }
          case "score_create_subdivision_switch": {
            const payload = args as { request?: unknown } | undefined;
            lastScoreCreateRequest = clone(payload?.request ?? null);
            return undefined;
          }

          case "generator_preview": {
            const payload = args as { request?: Record<string, unknown> } | undefined;
            const request = payload?.request ?? {};
            lastGeneratorPreviewRequest = clone(request);
            validateGeneratorPreviewCycle(request);
            const preview = buildGeneratorPreview(request);
            lastGeneratorPreview = clone(preview);
            return clone(preview);
          }

          case "track_set_playback": {
            const payload = args as { request?: unknown } | undefined;
            lastTrackPlaybackRequest = clone(payload?.request ?? null);
            return undefined;
          }
          case "parallel_set_playback": {
            const payload = args as { request?: unknown } | undefined;
            lastParallelPlaybackRequest = clone(payload?.request ?? null);
            return undefined;
          }
          case "score_get_current":
            return null;
          case "patch_load_autosave":
            return clone(autosavePatch);

          case "score_create_subdivision":
          case "score_load_from_path":
          case "score_load_preset":
          case "synth_set_enabled":
          case "synth_set_programs":
          case "transport_panic":
            return undefined;
          case "midi_list_destinations":
            return clone(midiDestinations);
          case "midi_set_destination": {
            const payload = args as
              | { dest?: { id: string; name: string } | null }
              | undefined;
            midiRoute = {
              desired: payload?.dest ?? null,
              connected: false,
              lastError: null,
            };
            reconcileMidiRoute();
            emit("midi_route_status", clone(midiRoute));
            return clone(midiRoute);
          }
          case "midi_get_route_status":
            reconcileMidiRoute();
            return clone(midiRoute);
          case "machine_prefs_get":
            return {
              prefs: clone(machinePrefs),
              source: hasMachinePrefsFile ? "file" : "defaults",
            };
          case "machine_prefs_set": {
            const payload = args as
              | { prefs?: Record<string, unknown> }
              | undefined;
            Object.assign(machinePrefs, clone(payload?.prefs ?? {}));
            // The route half stays backend-authoritative.
            machinePrefs.midiDestination = midiRoute.desired;
            return undefined;
          }
          case "score_save_to_path": {
            const payload = args as { path?: unknown } | undefined;
            lastScoreSavePath =
              typeof payload?.path === "string" ? payload.path : null;
            return undefined;
          }
          case "patch_save_to_path": {
            const payload = args as
              | { path?: unknown; patch?: unknown }
              | undefined;
            const path = typeof payload?.path === "string" ? payload.path : "";
            const patch = clone(payload?.patch ?? null);
            if (!path) throw new Error("Missing e2e patch save path");
            patchFiles.set(path, patch);
            lastPatchSave = { path, patch };
            return undefined;
          }
          case "patch_load_from_path": {
            const payload = args as { path?: unknown } | undefined;
            const path = typeof payload?.path === "string" ? payload.path : "";
            lastPatchLoadPath = path || null;
            if (!patchFiles.has(path)) {
              throw new Error(`Missing e2e patch file: ${path}`);
            }
            return clone(patchFiles.get(path));
          }
          case "track_save_to_path": {
            const payload = args as
              | { path?: unknown; document?: unknown }
              | undefined;
            const path = typeof payload?.path === "string" ? payload.path : "";
            const document = clone(payload?.document ?? null);
            if (!path) throw new Error("Missing e2e track save path");
            patchFiles.set(path, document);
            return undefined;
          }
          case "track_load_from_path": {
            const payload = args as { path?: unknown } | undefined;
            const path = typeof payload?.path === "string" ? payload.path : "";
            if (!patchFiles.has(path)) {
              throw new Error(`Missing e2e track file: ${path}`);
            }
            return clone(patchFiles.get(path));
          }
          case "patch_autosave": {
            const payload = args as { patch?: unknown } | undefined;
            autosavePatch = clone(payload?.patch ?? null);
            lastAutosavePatch = clone(autosavePatch);
            return undefined;
          }
          case "patch_clear_autosave":
            autosavePatch = null;
            return undefined;

          default:
            throw new Error(`Unhandled e2e Tauri command: ${command}`);
        }
      },
      async listen(
        eventName: string,
        handler: (event: { payload: unknown }) => void
      ) {
        const handlers = listeners.get(eventName) ?? new Set();
        handlers.add(handler);
        listeners.set(eventName, handlers);
        return () => handlers.delete(handler);
      },
      async dialog(kind: "ask" | "open" | "save", options?: unknown) {
        let result: unknown = null;
        if (kind === "ask") {
          result = askDialogResponses.length > 0 ? askDialogResponses.shift() : false;
        } else if (kind === "open") {
          result = openDialogResponses.length > 0 ? openDialogResponses.shift() : null;
        } else if (kind === "save") {
          result = saveDialogResponses.length > 0 ? saveDialogResponses.shift() : null;
        }
        dialogHistory.push({
          sequence: ++sequence,
          kind,
          options: clone(options),
          result: clone(result),
        });
        return clone(result);
      },
      getState() {
        return clone({
          calls,
          dialogHistory,
          snapshot,
          lastPreviewRequest,
          lastPreview,
          lastScoreCreateRequest,
          lastPatchSave,
          lastPatchLoadPath,
          patchFiles: Object.fromEntries(patchFiles.entries()),
          autosavePatch,
          lastAutosavePatch,
          lastScoreSavePath,
          lastGeneratorPreviewRequest,
          lastGeneratorPreview,
          lastTrackPlaybackRequest,
          lastParallelPlaybackRequest,
          pendingPreviewCycles: pendingPreviews.map((preview) => preview.cycle),
          heldPreviewCycles: Array.from(heldPreviewCycles),
          commandFailures: Object.fromEntries(commandFailures.entries()),
          commandDelays: Object.fromEntries(commandDelays.entries()),
          previewDelayMs,
          midiRoute,
          machinePrefs,
          midiDestinations,
        });
      },
      setCommandFailure(command: string, message: string | null) {
        if (message) {
          commandFailures.set(command, message);
        } else {
          commandFailures.delete(command);
        }
      },
      setCommandDelay(command: string, delayMs: number) {
        const normalized = Math.max(0, Math.round(Number(delayMs) || 0));
        if (normalized === 0) {
          commandDelays.delete(command);
        } else {
          commandDelays.set(command, normalized);
        }
      },
      setPreviewDelay(ms: number) {
        previewDelayMs = Math.max(0, Math.round(Number(ms) || 0));
      },
      releasePreviewCycle(cycle: number) {
        heldPreviewCycles.delete(cycle);
        const matching = pendingPreviews.splice(0, pendingPreviews.length);
        for (const pending of matching) {
          if (pending.cycle === cycle) {
            resolvePreview(pending.cycle, pending.request, pending.resolve);
          } else {
            pendingPreviews.push(pending);
          }
        }
      },
      emitLiveCycle(cycle: number) {
        snapshot = makeSnapshot(Math.max(0, Math.floor(Number(cycle) || 0)), true);
        emitTransport(snapshot);
      },
      emitNativeMenuAction(action: string) {
        emit("native_menu_action", action);
      },
      /** Simulate a hot-plug event: set which destinations are present,
       * re-reconcile the desired route, and push the change like the real
       * watcher would. */
      emitMidiDevicesChanged(present: Array<{ id: string; name: string }>) {
        midiDestinations.length = 0;
        midiDestinations.push(...present.map((dest) => ({ ...dest })));
        reconcileMidiRoute();
        emit("midi_route_status", clone(midiRoute));
      },
      enqueueDialogResponse(kind: "ask" | "open" | "save", value: unknown) {
        if (kind === "ask") {
          askDialogResponses.push(Boolean(value));
        } else if (kind === "open") {
          openDialogResponses.push(typeof value === "string" ? value : null);
        } else {
          saveDialogResponses.push(typeof value === "string" ? value : null);
        }
      },
      setPatchFile(path: string, patch: unknown) {
        patchFiles.set(path, clone(patch));
      },
    };

    window.__CAESURA_E2E_DRIVER__ = driver;
  }, init);
}

export async function readE2eState<T = unknown>(page: Page): Promise<T> {
  return await page.evaluate(() => window.__CAESURA_E2E_STATE__ as T);
}

export async function readDriverState<T = unknown>(page: Page): Promise<T> {
  return await page.evaluate(() => window.__CAESURA_E2E_DRIVER__?.getState() as T);
}
