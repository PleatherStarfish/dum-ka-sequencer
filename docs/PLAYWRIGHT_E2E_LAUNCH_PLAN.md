# Playwright E2E Launch Plan

This document catalogs the app flows that should be covered by Playwright before
Caesura is launched to consumers. It is a design guide for upcoming e2e work,
not a claim that every listed flow is already covered.

The current harness lives in `ui/playwright.config.ts` and `ui/tests/e2e/`.
It runs the real React UI in a browser and replaces Tauri IPC with deterministic
mocks when `CAESURA_E2E=1`.

## North Star

Playwright should prove that the application a consumer sees is the application
that will play.

The highest-value invariant is timeline/audio parity:

1. Authored UI state builds a preview request.
2. The timeline renders the resolved preview.
3. Playback applies the same authored request.
4. Rhythm, ratchet, ornaments, pitch, channel hocket, and automation playback
   configuration match the visible UI state.
5. Live transport metadata is shown only when it belongs to the same cycle and
   same resolved musical request as the visible timeline.

Rust unit tests, proptests, and fuzzers should continue owning musical math,
serde shape, scheduler queue correctness, and model-level invariants.
Playwright owns the consumer workflows where multiple layers meet: React state,
bridge requests, dialogs, mocked transport snapshots, timeline DOM, locks,
latency, and recovery behavior.

## Current Harness Shape

The harness should stay intentionally local-development friendly:

- Real app code: `ui/src/App.tsx` renders normally.
- Mocked Tauri imports:
  - `@tauri-apps/api/core`
  - `@tauri-apps/api/event`
  - `@tauri-apps/plugin-dialog`
- Deterministic mock backend:
  - records every command and payload
  - returns subdivision previews
  - returns rhythm previews
  - emits transport snapshots
  - can hold or delay preview cycles
  - can simulate dialog cancel/accept paths
- Test-only diagnostics:
  - `window.__CAESURA_E2E__`
  - `window.__CAESURA_E2E_STATE__`
  - never read from production behavior
- Stable selectors:
  - prefer accessible labels and roles
  - add `data-testid` only for dense timeline surfaces where accessible names
    would be noisy or brittle

The harness should not require real CoreMIDI, built-in synth output, or Tauri
window APIs. Those remain manual/package smoke checks until we add a separate
Tauri-driver layer.

## Test Data Strategy

Use named fixtures instead of ad hoc setup inside each test. Every fixture
should declare which risk it represents.

- `defaultFreshPatch`: the app's default launch state.
- `denseBoundaryPatch`: many possible boundaries, varied probabilities, varied
  gati and jathi weights.
- `sameGatiBoundaryPatch`: fired boundary that chooses the same gati as the
  previous section and must still render as a section start.
- `automationRichPatch`: score automation plus post-score automation lanes,
  markers, segment curves, and local Y-axis ranges.
- `rhythmRichPatch`: rhythm grouping, arbitrary subdivision, speed choices,
  fallback weights, and articulation edits.
- `ratchetOrnamentPatch`: ratchet plus grace and delay ornaments, including
  cooldown and velocity settings.
- `pitchChannelPatch`: pitch shaper and channel hocket enabled with live render
  metadata.
- `seedHistoryPatch`: global/rhythm/pitch/channel history modes plus seed path
  replay state.
- `persistenceRoundtripPatch`: broad patch state intended to prove save/recall
  fidelity.
- `failureModePatch`: command rejections, delayed previews, stale snapshots,
  malformed patch data, and canceled dialogs.

Keep fixture state compact but musically meaningful. A fixture that is hard to
read becomes a second codebase.

## Priority Levels

- P0: launch blockers. A consumer can lose trust, hear the wrong result, lose
  data, or get stuck.
- P1: high-risk feature workflows. Important before a broad beta.
- P2: polish and resilience. Should be covered before wider consumer launch or
  whenever a nearby area changes.
- Manual: cannot be meaningfully proven by the browser harness alone.

## Implementation Status

Legend:

- Built: covered by the current Playwright suite.
- Partial: a baseline is covered, but richer fixture variants or deeper payload
  assertions are still needed before launch.
- Not built: cataloged only.

Current test files:

- `ui/tests/e2e/timeline-playback-parity.spec.ts`
- `ui/tests/e2e/launch-plan-first-slice.spec.ts`
- `ui/tests/e2e/transport-and-locks.spec.ts`
- `ui/tests/e2e/boundary-authoring.spec.ts`
- `ui/tests/e2e/score-setup-and-accents.spec.ts`
- `ui/tests/e2e/theme-contrast.spec.ts`
- `ui/tests/e2e/patch-persistence.spec.ts`
- `ui/tests/e2e/model-ui-fuzzer.spec.ts`
- `ui/tests/e2e/chaos-gremlins.spec.ts`

Current support files:

- `ui/tests/e2e/support/appHarness.ts`
- `ui/tests/e2e/support/mockTauri.ts`

Current coverage:

| Area | Status | Built | Still missing |
| --- | --- | --- | --- |
| Harness hardening | Built | Shared app open/wait helpers, driver state readers, command counters, pending-preview waits, command failure toggles, native menu event emission, same-gati preview fixture. | Named rich patch fixtures for automation/rhythm/ratchet/pitch/channel/persistence. |
| App Boot And Initial State | Built | E2E-BOOT-001 through E2E-BOOT-005. | None for the baseline boot block; richer malformed patch boot cases are tracked under P2 failure flows. |
| Timeline And Playback Parity | Built | E2E-PARITY-001 through E2E-PARITY-010 have direct P0 coverage: preview-to-DOM section/gati/matra/jathi/automation parity, preview request identity, playback apply identity, rhythm playback ordering and launch-critical shared payload identity, live-cycle coherence, stale render hiding/reveal, stopped-cycle inspection, same-gati section starts, and timeline sync reset. | Full feature-specific rhythm/ratchet/ornament/pitch/channel/seed payload breadth is now tracked as P1 depth, not P0 launch blocking. |
| Transport Lifecycle | Built | E2E-TRANSPORT-001 through E2E-TRANSPORT-008: play ordering, stop/release, rapid Play coalescing, stop failure, valid and invalid tempo edits, synth toggle command flow, and always-on rhythm playback request flow. | None for the current P0 transport lifecycle catalog. Future richer cases may still belong under failure/latency or setup flows. |
| Structural Edit Locks | Built | E2E-LOCK-001 through E2E-LOCK-006 are covered: stopped-cycle input, cycle length, boundary topology, automation length, automation graph point/segment controls, graph click no-op while locked, lock messaging, and stop release. | None for the current P0 structural lock catalog. |
| Boundary And Gati Authoring | Built | E2E-BOUNDARY-001 through E2E-BOUNDARY-010: rail add/update/remove, marker detail opening, after-beat ordering, detail position/chance editing, probability clamps, boundary gati and jathi weights, start-section gati/jathi weights, and max-section count weights. Same-gati resolved rendering is covered under parity. | None for the current P0 boundary and gati authoring catalog. |
| Score Setup And Accents | Built | E2E-SCORE-001 through E2E-SCORE-010: score name, cycle length normalization, pitch and velocity preview/playback identity, invalid pitch/velocity clamping, beat/section/jathi accent ranges, jathi mode, and single-parameter modulation. | None for the current P0 score setup catalog. |
| Patch Persistence | Built | E2E-PATCH-001 through E2E-PATCH-010: Save prompts for a path, Save reuses the current path, Save As prompts again, Recall hydrates saved state, Recall cancel leaves state untouched, autosave toggle clears/updates status, autosave recovery restore/discard, score JSON export, and a rich roundtrip covering automation, seeds, rhythm, ratchet, ornaments, pitch, channel, setup, and debug state together. | None for the current P0 patch persistence catalog. |
| Theme And Contrast | Built | `theme-contrast.spec.ts` scans Solarized Astral dark and light modes with axe-core's rendered text contrast rule across the main view and each main editor, checks semantic token pairs with colorjs.io, and guards light mode against hardcoded dark container leaks. | Broader keyboard/focus-order accessibility and screen-reader naming audits remain P2. |
| Model-Based UI Fuzzer | Partial | Initial seeded Playwright state-machine fuzzer covers score edits, boundary edits, jathi/gati weights, automation lane mutation, timeline automation lane toggles, transport start/stop, synth toggles, and playback lock assertions with invariant checks after every action. A second seeded `gremlins.js` chaos layer now stresses stopped editor state, automation dialogs, locked live playback, live-cycle churn, and Play/Stop transport churn. | Expand the semantic model to all P1 feature panels, add reducer/shrinker, add replay for chaos artifacts, and run 30K-action local soak profiles regularly. |
| P1/P2 catalogs | Not built | None beyond live render layer baseline. | Automation, seeds, rhythm shaper, ratchet/ornaments, pitch, channel, synth/setup, debug, accessibility, layout, latency, and menu-routing breadth. |

The first slice completed the boot block and advanced the earliest parity rows.
The second slice completed the P0 transport lifecycle catalog and deepened
playback lock coverage. The third slice covered the core boundary and
max-section authoring workflows. The fourth slice completed score setup and
accent authoring coverage, and closed the start-section weight gap. The fifth
slice added patch save/recall/export/autosave recovery coverage. The suite is
now P0-complete for the launch-blocking browser catalog; remaining work is P1/P2
depth, breadth, and long-run state-space pressure. The sixth slice closed the
remaining P0 boundary clamp and rich patch roundtrip gaps. The
seventh slice completed direct automation graph lock coverage for point,
segment, target-browser, and graph-click editing. The eighth slice added
automation curve sampling to the E2E mock and proved visible automation timeline
lane values match the preview and playback automation payload. The ninth slice
added mock jathi pulse spans plus stable jathi cell metadata and proved the
visible jathi lane matches preview pulse spans. The tenth slice started the P1
model-based UI fuzzer as a seeded, replayable Playwright state machine. The
eleventh slice added a pinned `gremlins.js` chaos fuzzer that runs random
browser-level actions inside the same parity harness, with special emphasis on
live playback and timeline coherence.

## P0 Flow Catalog

### App Boot And Initial State

| ID | Flow | Assertions |
| --- | --- | --- |
| E2E-BOOT-001 | Fresh launch | Initial transport snapshot is fetched, no command error is shown, timeline panel mounts, default preview resolves. |
| E2E-BOOT-002 | Initial Play gating | Play remains disabled until preview and rhythm sources are coherent, then enables. |
| E2E-BOOT-003 | Initial timeline defaults | Default cycle has expected beats, default boundaries, section count readout, gati matra cells, and rhythm layer readiness. |
| E2E-BOOT-004 | Backend command failure on boot | A rejected initial snapshot or preview shows a recoverable error and does not leave partial playback state. |
| E2E-BOOT-005 | Recovery after boot failure | A later successful snapshot/preview clears the error and enables normal editing. |

### Timeline And Playback Parity

| ID | Flow | Assertions |
| --- | --- | --- |
| E2E-PARITY-001 | Stopped preview-to-DOM parity | Resolved sections, beat count, gati cells, section starts, jathi lane, and automation lane values match preview response. |
| E2E-PARITY-002 | Preview request identity | The latest `score_preview_subdivision_switch` payload matches current authored UI state. |
| E2E-PARITY-003 | Playback apply identity | `score_create_subdivision_switch` receives the exact authored request that produced the visible timeline before `transport_play`. |
| E2E-PARITY-004 | Rhythm playback identity | `rhythm_set_playback` is ordered before `transport_play`, carries the current enabled state, and carries launch-critical shared payloads such as automation. Full feature-specific rhythm/ratchet/ornament/pitch/channel/seed breadth is P1. |
| E2E-PARITY-005 | Live cycle follows snapshot | During playback the inspected timeline cycle follows the live transport cycle, not the stopped preview input. |
| E2E-PARITY-006 | Stale live preview hiding | If snapshot cycle advances before preview/rhythm catches up, live ratchet/pitch/channel layers are hidden and "Syncing live render" appears. |
| E2E-PARITY-007 | Live render reveal | After preview/rhythm catch up to the live cycle, render layers appear and syncing status disappears. |
| E2E-PARITY-008 | Stopped cycle inspection | Changing "Inspect stopped cycle" requests a new preview/rhythm result for that cycle without changing authored patch state. |
| E2E-PARITY-009 | Same-gati fired boundary | Preview that marks a same-gati boundary as a section start renders a separate section and section-start accent. |
| E2E-PARITY-010 | Timeline sync reset | Reset Timeline Sync clears stale live state, fetches a fresh snapshot, and resumes normal parity gating. |

### Transport Lifecycle

| ID | Flow | Assertions |
| --- | --- | --- |
| E2E-TRANSPORT-001 | Play | Play sends create/apply commands first, then `transport_play`; UI enters Running. |
| E2E-TRANSPORT-002 | Stop | Stop sends `transport_stop`, returns UI to Idle, and releases playback locks. |
| E2E-TRANSPORT-003 | Double-click Play | Rapid repeated Play clicks do not send duplicate `transport_play` calls. |
| E2E-TRANSPORT-004 | Stop failure | A rejected stop command reports error and does not clear state optimistically. |
| E2E-TRANSPORT-005 | Tempo edit | Tempo blur/Enter sends `transport_set_tempo`, updates readout, and preserves timeline parity. |
| E2E-TRANSPORT-006 | Tempo invalid input | Invalid or out-of-range tempo is clamped or rejected without sending nonsense. |
| E2E-TRANSPORT-007 | Synth toggle | Synth on/off calls backend and UI pending state prevents duplicate toggles. |
| E2E-TRANSPORT-008 | Always-on rhythm playback | Rhythm playback request stays enabled and no top-level rhythm toggle is exposed. |

### Structural Edit Locks

| ID | Flow | Assertions |
| --- | --- | --- |
| E2E-LOCK-001 | Playing locks stopped-cycle input | Inspect stopped cycle is disabled while playing. |
| E2E-LOCK-002 | Playing locks cycle length | Beats/cycle cannot change while playing. |
| E2E-LOCK-003 | Playing locks boundary topology | Add/remove/drag boundary controls are disabled or no-op while playing. |
| E2E-LOCK-004 | Playing locks automation editing | Automation length, graph edits, and point edits are disabled while playing. |
| E2E-LOCK-005 | Playing lock messaging | UI shows "Structure locked while playing" or a specific short status message. |
| E2E-LOCK-006 | Stop releases locks | All locked controls are usable after stop. |

### Boundary And Gati Authoring

| ID | Flow | Assertions |
| --- | --- | --- |
| E2E-BOUNDARY-001 | Add boundary from rail | Click/drag after a beat creates one boundary at that integer after-beat position. |
| E2E-BOUNDARY-002 | Update boundary chance from rail | Vertical rail interaction updates probability and preview request. |
| E2E-BOUNDARY-003 | Boundary detail opens | Marker `edit` opens the detailed boundary card/panel for the correct beat. |
| E2E-BOUNDARY-004 | Remove boundary | Marker/card delete removes boundary, preview request, and rendered possible-boundary count. |
| E2E-BOUNDARY-005 | Boundary order | Multiple boundaries are sorted left-to-right and remain after-beat positions. |
| E2E-BOUNDARY-006 | Boundary probability clamp | Chance controls cannot send values outside 0..1. |
| E2E-BOUNDARY-007 | Boundary gati weights | Editing weights updates the correct boundary's gati weight list. |
| E2E-BOUNDARY-008 | Boundary jathi weights | Editing jathi weights updates the correct boundary and preview request. |
| E2E-BOUNDARY-009 | Start-section weights | Editing initial gati/jathi weights affects the first section only. |
| E2E-BOUNDARY-010 | Max-section cap | Section-count weights flow into preview request and summary chips. |

### Score Setup And Accents

| ID | Flow | Assertions |
| --- | --- | --- |
| E2E-SCORE-001 | Rename score | Name field changes preview/create request and patch state. |
| E2E-SCORE-002 | Beats/cycle edit | Timeline grid, possible boundary filtering, and preview request update. |
| E2E-SCORE-003 | Pitch edit | Valid pitch reaches preview/create request and transport playback config. |
| E2E-SCORE-004 | Velocity edit | Valid velocity reaches preview/create request and timeline accent values. |
| E2E-SCORE-005 | Pitch/velocity invalid | Out-of-range values are clamped or rejected before bridge calls. |
| E2E-SCORE-006 | Beat accent range | Beat-start range edits reach preview request. |
| E2E-SCORE-007 | Section accent range | Section-start range edits reach preview request. |
| E2E-SCORE-008 | Jathi accent range | Jathi-start range edits reach preview request. |
| E2E-SCORE-009 | Jathi mode | Override/layered mode reaches preview request. |
| E2E-SCORE-010 | Single-parameter modulation | Toggle reaches preview/create request and summary state. |

### Patch Persistence

| ID | Flow | Assertions |
| --- | --- | --- |
| E2E-PATCH-001 | Save with no path | Save prompts for a `.caesura` path, then calls `patch_save_to_path`. |
| E2E-PATCH-002 | Save with existing path | Subsequent Save writes directly without another dialog. |
| E2E-PATCH-003 | Save As | Save As always prompts for a new path. |
| E2E-PATCH-004 | Recall patch | Recall prompts open path and hydrates broad UI state. |
| E2E-PATCH-005 | Recall cancel | Canceled dialog leaves current patch untouched. |
| E2E-PATCH-006 | Autosave toggle | Autosave on/off calls backend and updates status. |
| E2E-PATCH-007 | Autosave recovery accept | Recovery prompt restores autosave payload and clears recovery state as intended. |
| E2E-PATCH-008 | Autosave recovery decline | Decline keeps current/default state and clears or preserves recovery according to product rule. |
| E2E-PATCH-009 | Export score JSON | Export prompts score path and calls score export/save command. |
| E2E-PATCH-010 | Full roundtrip | A rich patch saves, recalls, and preserves all launch-critical UI state. |

## P1 Flow Catalog

### Model-Based UI Fuzzer

The UI fuzzer treats Playwright as a deterministic state-machine driver, not as
a blind pixel clicker. Each run has a seed, a step count, a constrained action
vocabulary, and invariant checks after every action. The purpose is to make the
real React app traverse thousands of realistic UI states before, during, and
after playback while the mocked Tauri backend records the exact requests that
would reach Rust.

Default local development should stay fast. The checked-in fuzzer therefore
runs a smoke profile by default, then exposes environment variables for long
soak profiles:

- `pnpm --dir ui test:e2e:fuzz` runs the seeded smoke fuzzer.
- `CAESURA_UI_FUZZ_STEPS=30000 pnpm --dir ui test:e2e:fuzz` runs one 30K-step
  soak.
- `CAESURA_UI_FUZZ_SEEDS=20260517,20260518 pnpm --dir ui test:e2e:fuzz` runs
  multiple replayable seeds.
- `pnpm --dir ui test:e2e:fuzz:soak` is the convenience 30K-action local soak.
- `pnpm --dir ui test:e2e:chaos` runs the seeded `gremlins.js` chaos fuzzer.
- `CAESURA_GREMLINS_ACTIONS=30000 pnpm --dir ui test:e2e:chaos` runs one
  30K-action browser-level chaos soak.
- `CAESURA_GREMLINS_SEEDS=20260517,20260518 pnpm --dir ui test:e2e:chaos`
  shards chaos across multiple replayable seeds.
- `pnpm --dir ui test:e2e:chaos:soak` is the convenience 30K-action
  `gremlins.js` local soak. It uses larger 1000-action segments and a 1 ms
  action delay so local long runs spend most of their time exploring, while
  still checking invariants after every segment.

Failure artifacts should always make a bug replayable. On failure the fuzzer
attaches `ui-fuzz-repro.json` with the seed, step count, ordered action log,
current E2E state, and mock driver state. The next evolution is a reducer that
replays the log and minimizes it to the shortest failing subsequence.
The chaos fuzzer attaches `gremlins-chaos-repro.json` with the seed, total
action count, phase/segment summaries, recent browser-level action logs,
in-page audit snapshots, runtime errors, current E2E state, and mock driver
state.

Current smoke action vocabulary:

- stopped score edits: cycle length, pitch, velocity, stopped-cycle inspection
- boundary authoring: rail edits across edge probabilities
- start-section weights: gati and jathi edge weights
- automation: add/mutate Velocity lane and toggle timeline automation rows
- transport: start, stop, tempo edits, synth toggle
- live lock pressure: assert structure locks while playback is running

Current `gremlins.js` chaos phases and species:

- stopped editor surface: random click, double-click, mouse, key, scroll, and
  form-fill actions over expanded score and boundary panels while Play/Stop is
  excluded
- stopped automation dialog: the same browser-level pressure inside the
  Automation dialog after a Velocity lane is created
- locked live playback surface: playback is started, structural controls are
  locked, random browser actions continue outside transport controls, and mock
  live-cycle snapshots are emitted during the attack
- live transport churn: random browser actions are allowed to hit Play/Stop so
  the app is challenged around start/stop races, lock release, and recovery

The chaos layer intentionally does less musical modeling than the semantic
fuzzer. Its job is to create surprising browser-level sequences that a normal
model would not think to try, then let the same invariant suite decide whether
the app is still coherent. It filters out disabled and read-only form fields so
failures stay close to realistic user behavior, but still allows awkward focus,
keyboard, scroll, pointer, dialog, and transport interactions.

The chaos species are a mix of stock `gremlins.js` species and Caesura-aware
species:

- stock clicker, form filler, scroller, and typer species with disabled/read-only
  target filtering
- app-control clicks over summaries, buttons, checkboxes, and radio buttons
- numeric edge-value mutation for enabled number fields
- text edge-value mutation for score/name/search fields
- select-option mutation
- boundary rail coordinate clicks
- automation graph clicks and short drags
- timeline surface clicks and short drags
- live transport control clicks during the transport-churn phase
- mock-driver pressure that emits live-cycle snapshots and injects small preview
  delays during live phases

Invariant checks after every semantic action and after each browser-level chaos
segment:

- no browser page errors or console errors
- no app error/preview banners after the timeline settles
- preview, rhythm, and timeline layer sources return to coherent state
- `switchRequest.ok` remains true
- latest preview request has finite numeric data
- cycle length, pitch, velocity, boundary probability, accent range, and weights
  remain inside valid DTO ranges
- Play/Stop enabled states match idle/running transport state
- playback locks are active while running and released when idle
- when running, the score create request still equals the latest coherent
  preview request
- semantic fuzzing cross-checks rendered gati matra cell count every tenth step;
  chaos fuzzing cross-checks it after every segment

Expansion path:

| ID | Flow | Assertions |
| --- | --- | --- |
| E2E-FUZZ-001 | Seeded smoke state machine | Default run covers a compact mix of stopped and playing actions and records a replay log on failure. |
| E2E-FUZZ-002 | 30K local soak profile | Same state machine can run 30K actions under a single seed without changing source. |
| E2E-FUZZ-003 | Seed sharding | Multiple seeds can run as separate Playwright tests for better failure isolation. |
| E2E-FUZZ-004 | Action log replay | A failed `ui-fuzz-repro.json` can be replayed exactly. |
| E2E-FUZZ-005 | Failure shrinking | Replay can minimize a failing action log to the smallest reproducer. |
| E2E-FUZZ-006 | Full automation actions | Add graph drag, marker edit/delete, target filtering, pick mode, and segment curve mutations. |
| E2E-FUZZ-007 | Rhythm/ratchet/ornament actions | Add high-risk playback shaper controls, including live toggles and edge values. |
| E2E-FUZZ-008 | Pitch/channel/seed actions | Add matrix edits, fallback edits, seed mode transitions, and seed-path replay pressure. |
| E2E-FUZZ-009 | Persistence actions | Mix save/recall/export/autosave recovery into random sequences with mocked dialogs. |
| E2E-FUZZ-010 | Latency and failure actions | Inject delayed previews, command rejections, stale snapshots, and recovery paths mid-sequence. |
| E2E-FUZZ-011 | Browser-level chaos smoke | `gremlins.js` runs segmented stopped, dialog, live-lock, and transport-churn attacks with timeline/playback invariants after each segment. |
| E2E-FUZZ-012 | Browser-level chaos soak | `CAESURA_GREMLINS_ACTIONS=30000` can run the same segmented attack profile as a long local soak with larger segments for throughput. |
| E2E-FUZZ-013 | Chaos replay | `gremlins-chaos-repro.json` can be replayed exactly by seed, phase, and segment. |
| E2E-FUZZ-014 | Chaos minimizer | A failed chaos artifact can be reduced to the shortest segment/action budget that still fails. |

### Deep Playback Payload Parity

This is the P1 continuation of P0 `E2E-PARITY-004`. P0 proves command ordering,
transport coherence, and launch-critical shared payload identity. P1 should
prove every high-risk feature-specific playback payload against visible UI
state.

| ID | Flow | Assertions |
| --- | --- | --- |
| E2E-PAYLOAD-001 | Rhythm payload parity | Chains, fallback, articulation, arbitrary subdivision, speed choices, and seed mode match visible rhythm controls before play. |
| E2E-PAYLOAD-002 | Ratchet payload parity | Ratchet probability, speed, cooldown, gates, modifiers, time curve, velocity, and internal rhythm match visible controls. |
| E2E-PAYLOAD-003 | Ornament payload parity | Grace and delay settings match visible controls before play. |
| E2E-PAYLOAD-004 | Pitch payload parity | Pitch shaper states, transitions, fallback, boundary policy, ornament/ratchet pitch, grace pitch, and transposition match visible controls. |
| E2E-PAYLOAD-005 | Channel payload parity | Channel set, transitions, fallback, ratchet/ornament routing, and accent routing rules match visible controls. |
| E2E-PAYLOAD-006 | Seed payload parity | Global and domain-local seed modes, history pools, seed path replay, and wildcard rules match visible controls. |

### Automation

| ID | Flow | Assertions |
| --- | --- | --- |
| E2E-AUTO-001 | Open/close Automation overview | Dialog opens, closes by button and Escape, focus returns sensibly. |
| E2E-AUTO-002 | Add target from browser | Search/filter/select creates a lane with the correct stable target id. |
| E2E-AUTO-003 | Direct target access | Cmd-click or Control-click an automatable control creates or opens the correct lane. |
| E2E-AUTO-004 | Inline automation shortcut | Local automation symbol opens shortlist for only that section/group. |
| E2E-AUTO-005 | Timeline lane selector | Selecting lanes shows timeline automation rows from preview values. |
| E2E-AUTO-006 | Add graph point | Pointer or button interaction creates a point with exact rational time. |
| E2E-AUTO-007 | Move graph point | Drag updates time/value and preview request. |
| E2E-AUTO-008 | Edit exact point fields | Numeric fields update point time/value with correct rounding for lane type. |
| E2E-AUTO-009 | Delete point/lane | Removal updates patch state and preview/playback requests. |
| E2E-AUTO-010 | Segment curve edit | Curve kind and amount persist and render. |
| E2E-AUTO-011 | Marker add/edit/remove | Shared marker lines persist and appear in graph editors. |
| E2E-AUTO-012 | Weight Y-range | Weight-lane local min/max affects graph scaling without changing target domain. |
| E2E-AUTO-013 | Score target playback parity | Score-level automation values in timeline match preview beat values. |
| E2E-AUTO-014 | Post-score target playback parity | Rhythm/ratchet/pitch/channel automation reaches `rhythm_set_playback`. |

### Seed Strategy

| ID | Flow | Assertions |
| --- | --- | --- |
| E2E-SEED-001 | Open via menu event | Mock native menu opens Seed Strategy dialog. |
| E2E-SEED-002 | Global locked seed | Locked seed updates preview request and summaries. |
| E2E-SEED-003 | Global per-cycle seed | Per-cycle mode changes cycle preview behavior deterministically. |
| E2E-SEED-004 | Global history/new | History pool, weights, and max history update preview request. |
| E2E-SEED-005 | Rhythm follows global | Rhythm local controls are disabled/hidden and request inherits global. |
| E2E-SEED-006 | Rhythm local seed | Local locked/per-cycle/history modes update rhythm request. |
| E2E-SEED-007 | Pitch local seed | Pitch seed mode updates playback request and summaries. |
| E2E-SEED-008 | Channel local seed | Channel seed mode updates playback request and summaries. |
| E2E-SEED-009 | Ratchet seed | Independent ratchet seed updates playback request. |
| E2E-SEED-010 | Ornament seed | Independent ornament seed updates playback request. |
| E2E-SEED-011 | Seed loop monitor | History snapshots render recurrence cells correctly. |
| E2E-SEED-012 | Seed path record/replay | Playback records seed path, derived replay can be queued, next play records a new path. |
| E2E-SEED-013 | Wildcard replay | Wildcarded domain/cycle is skipped during replay and marked in UI. |

### Rhythm Shaper

| ID | Flow | Assertions |
| --- | --- | --- |
| E2E-RHYTHM-001 | Open/close panel | Panel state persists in patch. |
| E2E-RHYTHM-002 | Rhythm enabled toggle | Toggle changes playback request and timeline rhythm layer. |
| E2E-RHYTHM-003 | Pattern add/remove | Selected patterns update state list and rhythm preview request. |
| E2E-RHYTHM-004 | First/second-order switch | Matrix context shape and request update. |
| E2E-RHYTHM-005 | Matrix weight edit | Edited cell updates correct transition target id. |
| E2E-RHYTHM-006 | Fallback mode/weights | Static/weighted fallback updates request. |
| E2E-RHYTHM-007 | Articulation rails | Rest/tie probabilities update request and automation targets. |
| E2E-RHYTHM-008 | Arbitrary subdivision enable | Re-subdivision controls flow into rhythm preview/playback config. |
| E2E-RHYTHM-009 | Arbitrary pool edit | Pool weights update correct length/state target. |
| E2E-RHYTHM-010 | Rhythm speed choices | Gati/jathi speed weights update playback request. |
| E2E-RHYTHM-011 | Extrapolate matrix | Extrapolation command updates intended target lengths only. |
| E2E-RHYTHM-012 | Import passage | Passage command materializes matrices and handles help dialog. |

### Ratchet And Ornaments

| ID | Flow | Assertions |
| --- | --- | --- |
| E2E-RATCHET-001 | Enable ratchet | Playback request includes ratchet enabled and timeline can show live markers. |
| E2E-RATCHET-002 | Chance and speed windows | Probability/rate edits reach playback request. |
| E2E-RATCHET-003 | Cooldown and span gates | Edits reach playback request and automation target ids. |
| E2E-RATCHET-004 | Probability modifiers | Slow/fast/position/gati/jathi modifiers reach playback request. |
| E2E-RATCHET-005 | Time curve editor | Curve points, variance, interpolation, and preset weights persist. |
| E2E-RATCHET-006 | Velocity controls | Velocity mode/range/attraction/same-probability reach playback request. |
| E2E-RATCHET-007 | Internal ratchet rhythm | Internal rhythm hit-count gates and pattern settings reach request. |
| E2E-ORN-001 | Enable ornaments | Playback request includes ornament config. |
| E2E-ORN-002 | Grace note controls | Count, placement, rest targeting, cooldown, velocity, and probability reach request. |
| E2E-ORN-003 | Delay controls | Delay min/max, quantization, distribution, tuplets reach request. |
| E2E-ORN-004 | Live ornament markers | Coherent snapshots render grace/delay markers and stale snapshots hide them. |

### Pitch Shaper

| ID | Flow | Assertions |
| --- | --- | --- |
| E2E-PITCH-001 | Enable pitch shaper | Playback request includes pitch shaper and timeline pitch lane can render. |
| E2E-PITCH-002 | Apply collection preset | Preset/range/transposition updates pitch states. |
| E2E-PITCH-003 | Add/remove pitch state | State list, fallback, and matrix dimensions remain valid. |
| E2E-PITCH-004 | Fallback mode/weights | Pitch fallback controls update request. |
| E2E-PITCH-005 | Boundary policy | Wrap/clamp/nearest/modulo settings reach request. |
| E2E-PITCH-006 | Matrix weight edit | First/second-order pitch transitions update correct target. |
| E2E-PITCH-007 | Ratchet pitch modes | Source/whole/per-hit modes and probabilities reach request. |
| E2E-PITCH-008 | Ornament pitch modes | Ornament pitch probabilities reach request. |
| E2E-PITCH-009 | Grace pitch injection | Weighted pitch pool and chance reach request. |
| E2E-PITCH-010 | Grace transpose injection | Direction weights, interval list, and scope reach request. |
| E2E-PITCH-011 | Transposition tab | Probabilistic transposition settings reach request. |
| E2E-PITCH-012 | Live pitch lane | Coherent snapshot pitch events render correct labels and stale ones hide. |

### Channel Shaper

| ID | Flow | Assertions |
| --- | --- | --- |
| E2E-CHANNEL-001 | Enable hocket | Playback request includes channel hocket config and timeline channel lane can render. |
| E2E-CHANNEL-002 | Static output channel | MIDI output channel reaches playback request. |
| E2E-CHANNEL-003 | Channel set selection | Enabled channel chips update matrix dimensions and fallback options. |
| E2E-CHANNEL-004 | Fallback channel/mode | Static/weighted fallback updates request. |
| E2E-CHANNEL-005 | Matrix weight edit | First/second-order channel transitions update correct target. |
| E2E-CHANNEL-006 | Ratchet channel modes | Source/whole/per-hit modes and probabilities reach request. |
| E2E-CHANNEL-007 | Ornament channel modes | Ornament channel strategy reaches request. |
| E2E-CHANNEL-008 | Accent routing rules | Velocity bands, modes, and channel weights reach request. |
| E2E-CHANNEL-009 | Reset accent bands | Reset restores default bands and updates request. |
| E2E-CHANNEL-010 | Live channel lane | Coherent snapshot channel events render correct channel colors/numbers and stale ones hide. |

### Built-In Synth And Setup

| ID | Flow | Assertions |
| --- | --- | --- |
| E2E-SYNTH-001 | Synth properties panel | Opens/closes from button and menu event. |
| E2E-SYNTH-002 | Program edit | Melodic program changes call `synth_set_programs`. |
| E2E-SYNTH-003 | Drum note edit | Percussion key changes call `synth_set_programs`. |
| E2E-SYNTH-004 | Preset apply | Presets update all expected voice rows. |
| E2E-SETUP-001 | Audio & MIDI Setup opens | Mock menu opens setup dialog. |
| E2E-SETUP-002 | Audio tab | Synth monitor readouts and properties link behave. |
| E2E-SETUP-003 | MIDI tab | Static channel, channel-shaper access, debug visibility, all-notes-off action. |
| E2E-SETUP-004 | Files tab | Autosave interval, recovery toggle, save/export shortcuts, clear recovery action. |

### Debug Readouts

| ID | Flow | Assertions |
| --- | --- | --- |
| E2E-DEBUG-001 | MIDI debug empty state | Empty debug readout is clear and compact. |
| E2E-DEBUG-002 | MIDI debug events | Snapshot events render latest-first, capped by selected limit. |
| E2E-DEBUG-003 | MIDI debug limit | Limit control changes visible row count. |
| E2E-DEBUG-004 | Automation debug empty state | Empty automation readout is clear. |
| E2E-DEBUG-005 | Automation debug events | Values render by target and cycle, capped by selected limit. |

## P2 Flow Catalog

### Accessibility And Keyboard

| ID | Flow | Assertions |
| --- | --- | --- |
| E2E-A11Y-001 | Escape closes dialogs | Automation, setup, seed, help, and floating menus close with Escape. |
| E2E-A11Y-002 | Outside click closes popovers | Menus close without mutating state. |
| E2E-A11Y-003 | Tab order smoke | Transport, timeline controls, and dialogs have usable tab flow. |
| E2E-A11Y-004 | Disabled controls | Disabled states are reflected by actual disabled controls or clear aria state. |
| E2E-A11Y-005 | Accessible labels | Key buttons/inputs can be found by role/name rather than only test ids. |

### Responsive And Layout Smoke

| ID | Flow | Assertions |
| --- | --- | --- |
| E2E-LAYOUT-001 | Desktop laptop viewport | Main transport and timeline do not overlap. |
| E2E-LAYOUT-002 | Narrow viewport | Timeline scrolls horizontally and controls remain reachable. |
| E2E-LAYOUT-003 | Dense timeline | Many sections/matras do not produce incoherent overlap. |
| E2E-LAYOUT-004 | Long labels | Long patch names, target names, and seed labels stay inside containers. |
| E2E-LAYOUT-005 | Open all major panels | Page remains usable with major panels expanded. |

### Failure, Latency, And Native Menu Events

| ID | Flow | Assertions |
| --- | --- | --- |
| E2E-FAIL-001 | Slow subdivision preview | Play remains disabled until preview arrives. |
| E2E-FAIL-002 | Slow rhythm preview | Rhythm/live layers hide until rhythm result arrives. |
| E2E-FAIL-003 | Preview rejection | Error appears, timeline falls back safely, Play disabled. |
| E2E-FAIL-004 | Rhythm rejection | Error appears, playback does not start with stale rhythm config. |
| E2E-FAIL-005 | Patch load malformed | Validation falls back or reports error without corrupting current state. |
| E2E-FAIL-006 | Dialog cancel everywhere | Save/open/export canceled dialogs leave state unchanged. |
| E2E-MENU-001 | File menu events | New, Save, Save As, Recall, Recall Recent, Export, Toggle Autosave route correctly. |
| E2E-MENU-002 | Setup menu events | Audio & MIDI Setup and Seed Strategy open correctly. |
| E2E-MENU-003 | View menu events | Toggle Rhythm Shaper opens/closes the panel. |
| E2E-MENU-004 | Playback menu events | Reset sync, Synth Properties, and Toggle Synth route correctly. |

## Manual Or Non-Playwright Coverage

These are real launch checks, but the current browser harness is not the right
place to prove them:

- Real CoreMIDI virtual port appears in Audio MIDI Setup.
- External MIDI routing to Ableton, Max/MSP, a MIDI monitor, and hardware.
- Built-in synth produces sound through macOS audio output.
- All-notes-off works against real stuck MIDI notes.
- Tauri native menu behavior in the packaged macOS app.
- File dialogs in the packaged Tauri shell.
- Release signing, notarization, installation, first launch permissions, and
  app bundle metadata.
- Performance soak with real audio/MIDI under long playback sessions.

Document manual results in release notes or a launch checklist. Do not pretend
the mocked browser harness has proven hardware behavior.

## Implementation Roadmap

### Phase 1: Harden The Harness

Goal: make adding tests cheap and consistent.

- Extract fixture builders for preview, rhythm, transport snapshot, patch, and
  dialog responses.
- Add helper assertions for command order and payload identity.
- Add helper assertions for timeline section/matra parity.
- Add fixture presets listed in "Test Data Strategy".
- Add failure/latency controls to the mock driver.
- Prefer accessible locators; add test ids only where timeline geometry makes
  semantic labels too noisy.

Exit criteria:

- New e2e tests rarely need custom mock logic.
- A failed parity assertion prints the mismatched command/request clearly.
- Current P0 parity tests remain under roughly 10 seconds locally.

### Phase 2: Complete P0 Launch Blockers

Goal: cover every flow that can cause wrong playback, lost patch state, or a
stuck consumer session.

- App boot and recovery.
- Full timeline/playback parity.
- Transport lifecycle.
- Structural locks.
- Boundary and score setup authoring.
- Patch save/recall/autosave/export.

Exit criteria:

- Every P0 row has at least one Playwright test.
- Rich patch roundtrip proves broad UI state survives save/recall.
- Stale live render tests cover rhythm, ratchet/ornament, pitch, and channel
  layers.

### Phase 3: High-Risk Feature Surfaces

Goal: cover the dense creative surfaces most likely to drift from playback
requests.

- Automation overview and timeline automation lanes.
- Seed Strategy dialog and seed paths.
- Rhythm Shaper.
- Ratchet and ornaments.
- Pitch Shaper.
- Channel Shaper.
- Synth properties and setup dialog.
- Debug panels.

Exit criteria:

- Every feature that contributes to `rhythm_set_playback` has a request-parity
  e2e test.
- Every live transport layer has coherent/stale render tests.
- Automation target creation and preview/playback propagation are covered.

### Phase 4: Consumer Polish And Resilience

Goal: catch embarrassing UI failures before wider launch.

- Accessibility smoke tests.
- Responsive/layout smoke tests.
- Dialog cancel paths.
- Backend rejection and slow response scenarios.
- Native menu event routing.

Exit criteria:

- Main flows are reachable by role/name locators.
- Major dialogs close predictably.
- The app reports recoverable errors without corrupting state.

## Definition Of Done For New E2E Tests

A new Playwright test should:

- Name the user flow, not the implementation detail.
- Start from a named fixture or a clearly minimal setup.
- Assert both UI outcome and bridge command payload when the flow affects
  playback or persistence.
- Exercise failure/stale behavior for flows that involve async preview,
  playback, or dialogs.
- Avoid arbitrary sleeps. Use explicit state, DOM, or command-stream waits.
- Keep mocks deterministic and readable.
- Leave production behavior untouched except for guarded test-only diagnostics
  or stable selectors.
- Prefer one strong end-to-end assertion over many brittle visual details.

## Maintenance Rules

- When a new visible workflow ships, add it to this document before or alongside
  the test.
- When a control affects preview, create/apply, rhythm playback, patch
  persistence, or live transport rendering, it needs a parity assertion.
- When a Rust semantic test already proves musical math, do not duplicate that
  math in Playwright. Assert that the UI sends and displays the result
  correctly.
- Keep the mock backend honest but simple. It should produce structurally valid
  responses, not reimplement the Rust engine.
- If an e2e test becomes flaky, fix the synchronization model instead of
  increasing timeouts by habit.
- Review this plan before consumer launch and mark any unimplemented P0 flow as
  an explicit launch risk.
