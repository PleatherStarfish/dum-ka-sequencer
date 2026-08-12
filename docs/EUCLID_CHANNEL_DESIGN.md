# Euclidean (Bjorklund) Channel Assignment

Status: **shipped** (2026-07-30) — phases 0-5 landed; the `Never` reset scope
is the one deferred item (§7).

The Channel Shaper's per-note channel decision now has two selectable
strategies: the original **Markov chain** (transition matrix + entry/fallback
weights) and a deterministic **Euclidean (Bjorklund)** pattern engine. One
strategy is active per track (`channelHocket.assignMode`); nothing about the
Markov path changed, and the whole feature is additive (patch schema v6).
This is distinct from **Channel Logic**, the cross-track collision resolver —
only its read-only "possible channels" helper learned the new mode.

## 1. Literature the design draws on

- **Bjorklund 1999/2003** (SNS-NOTE-CNTRL-99) — the bucket recursion that
  distributes k onsets among n slots; `bjorklund_mask` implements it
  literally, matching Toussaint's worked examples (E(5,13) = 1001010010100).
- **Toussaint 2005**, *The Euclidean algorithm generates traditional musical
  rhythms* — E(k,n) notation, rotations as distinct world rhythms (per-layer
  `rotation`).
- **Demaine et al. 2009**, *The distance geometry of music* — the complement
  of a Euclidean rhythm is Euclidean, which justifies the Partition
  placement's hierarchical recursion staying maximally even at every level.
- **Ellis, Ruskey, Sawada & Simpson 2003**, *Euclidean strings* — the
  interval-vector bump-and-rotate test behind the panel's "Euclidean string"
  / "reverse Euclidean string" badges (`ui/src/euclidChannels.ts`).
- **moinsound 2022** (CC-BY whitepaper) — the max-run **burst** extension:
  cluster k onsets into ⌈k/L⌉ bursts (full-length first), Bjorklund-space the
  bursts among the rests, expand. `max_run` = 1 reduces to classic Euclid;
  golden (5,13,3) → 1110000110000. The construction needs at least as many
  rests as bursts; with fewer, adjacent bursts merge (documented on
  `bjorklund_burst_mask`).

Two Euclidean generators deliberately coexist in the repo: Shape Groups keep
the closed form `(i·k) mod n < k` (`euclidean_mask`, ER-102-manual parity),
while the channel strategy uses true Bjorklund recursion (literature-canonical
output). They differ by a rotation for some (k,n); a property test pins the
rotation equivalence and the two-value gap multiset for every k ≤ n ≤ 64.

## 2. Model

`EuclidChannelSpec` (cseq-rhythm, additive `#[serde(default)]` fields on
`ChannelHocketSpec`):

| Field | Meaning |
|---|---|
| `placement` | `partition` \| `stack` (§2.1) |
| `steps` | Partition's shared cycle length n, 1..=64 |
| `layers[]` | priority-ordered voices: `channel` (palette member, unique), `pulses` k, `rotation`, `max_run` (bursts), `steps` + `invert` (Stack only) |
| `reset` | `cycle` \| `section` \| `beat` \| `accentSpan` (§2.3) |
| `span_accent_mode` | `woven` \| `bypass` (§2.4) |
| `span_accent_channel` | Bypass anchor; `None` = the static `fallback` |

### 2.1 Placements

**Partition** — layers claim slots of one shared length-n cycle by iterated
Bjorklund over the slots earlier layers left behind; remainder slots fall to
the static `fallback` channel. Exact quotas: layer c sounds exactly k_c of
every n steps. Layer 1 is perfectly Euclidean in absolute slots; each later
layer is Euclidean relative to what remains (complement theorem).

**Stack** — every layer runs its own mask of its own length (polymeter; the
combined period is lcm of the layer lengths, evaluated lazily). The first
layer in priority order whose mask is on wins; otherwise the slot falls back.
Quotas are approximate (shadowing); `invert` lets a layer claim the rests.

### 2.2 Runtime semantics (`EuclidAssigner` behind `ChannelAssigner`)

The step index advances **exactly once per assigner method call**, inheriting
the Markov chain's draw-consumption structure verbatim (ratchet
`SourceChannel` = 1 draw, `WholeRatchet` = 1-2, `PerRatchetHit` = 1 + up to 1
per hit, ornaments likewise). Gesture semantics, aux-RNG probability gating
(accent chance, position action weights, gesture rolls — still seeded), and
call counts are therefore strategy-independent, and the seed dialog stays
meaningful in euclid mode.

Rule mappings (same wire enums, mode-appropriate meaning):

| Markov concept | Euclid meaning |
|---|---|
| position `NormalMarkov` | follow the pattern (ordinary step) |
| position `RenderOnly` | override the rendered channel; the index still advances |
| position `ResetMarkov` | **re-anchor**: render the rule's chosen channel, next step reads slot 0 |
| accent `DriveChain` | **phase magnet**: jump forward to the next slot playing the forced channel and continue past it; if no slot within the exact repeating pattern plays it, render it and advance one step in place |
| accent `RenderOnly` | override the rendered channel; the index still advances |

Trace sources reuse the existing `RhythmChoiceSource` variants (pattern step
→ `transition`, remainder/stack miss → `fallback` with the timeline's
fallback flag, magnet → `accent`, re-anchor → `position`) — zero DTO/TS/
fixture ripple.

### 2.3 Reset scopes

The index re-anchors to slot 0 whenever a note group enters a new reset
region: `cycle` (tala cycle start — the pattern runs freely across sections,
i.e. "no reset per section"), `section`, `beat`, or `accentSpan`. Regions are
derived tick-side from the pulse spans (custom-section-safe); a gesture that
crosses a boundary stays anchored to the region it starts in. All four scopes
are pure functions of (config, cycle, resolved structure), so mid-play
`apply_in_place`, preroll, triggered launches, and Track Flow need no special
handling.

### 2.4 Span accents — the woven/bypass toggle

Accent spans are the technique layer that carries the protected-accent
grouping, per section: Jathi Bhedam cells if present, else jathi frames, else
the gati beat frames (mirroring `emit_pulse_spans`). The **span-start
accent** is the note group at a span's exact start tick; a silent span start
contributes no accent.

Within one reset region with groups g_0…g_{G−1} and accent set A (|A| = a):

- **Woven** (default): every group is a pattern step — σ(g_j) = j. The
  pattern is indifferent to the accent grid. For a regular J-pulse jathi
  densely filled, frame m's accent lands on slot (m·J) mod n — the accent
  timbre cycles with period lcm(J,n)/J frames (deliberate polymetric drift).
- **Bypass**: accents render the anchor channel, consume no step, and
  outrank position/velocity-accent rules; the stream compacts across them —
  σ(g_j) = j − |A ∩ [0,j)|. The jathi structure is timbrally pinned (in
  electronic music accent is often perceived as a timbral change, and on a
  multi-channel hocket the channel *is* the timbre) while the interior keeps
  the exact k:n mix regardless of where accents fall.
- **Woven + reset = accentSpan**: every span replays the pattern head, so
  each accent deterministically sounds slot 0's channel — pattern-derived
  accent timbre without leaving the stream.

Quota corollary (pinned by the `euclid_partition_quotas_are_exact` fuzzer
property in both modes): Partition, no accent/position rules, default
gestures, reset=cycle ⇒ Woven gives each layer channel exactly k_c·⌊G/n⌋
notes among the first ⌊G/n⌋·n steps; Bypass gives k_c·⌊(G−a)/n⌋ among the
non-accent steps plus exactly a anchor notes.

## 3. Where things live

- **Core** `crates/cseq-rhythm/src/lib.rs`: `bjorklund_mask`,
  `bjorklund_burst_mask`, `euclid_partition_table`, stack masks,
  `EuclidAssigner`, spec types + validation (steps/layer bounds, palette
  membership, layer uniqueness, partition Σk ≤ n, anchor membership —
  O(layers), allocation-free, runs per note group like the rest of
  `validate_channel_hocket_spec`). Stack phase magnets scan a short common
  prefix, then solve the true polymetric mask constraints with generalized
  CRT; the combined LCM is never truncated.
- **Transport** `crates/cseq-transport/src/lib.rs`: `ChannelAssigner` enum
  dispatch inside `apply_channel_hocket_to_queue`, `channel_accent_regions`,
  `euclid_group_contexts` (region keys + span-accent flags), bypass
  early-return, repair clamps, automation block
  (`channelHocket.euclid.steps`, `channelHocket.euclid.layer.{i}.pulses|
  rotation|maxRun|steps` — a rotation lane is the roadmap's "rotation per
  beat, section, or span"; tables rebuild per group from the automated spec
  while the index survives). Because numeric lanes sample independently, the
  Euclid-only repair pass runs again after every per-group sample; the Markov
  branch never enters it.
- **Wire/persistence**: shared serde type over the existing request DTO;
  patch schema **v6** in both gates (`ui/src/patchIo.ts`,
  `src-tauri/src/main.rs`); pre-v6 documents load as markov with a default
  euclid block (plain defaulting — `assignMode` gates behavior, so no
  tri-state or migration body is needed).
- **UI**: Channel Shaper header gains the Assignment select (Order/Axis are
  markov-only); euclid mode swaps the Matrix + Entry & Fallback tabs for the
  **Pattern** tab (placement/steps/reset/span-accent controls, priority-
  ordered layer rows with bead strips, E(k,n) + interval-vector readouts,
  Euclidean-string badges, numbered combined strip). `ui/src/euclidChannels.ts`
  is the TS twin of the Rust generators, pinned to the same goldens. Its
  canonical layer filter is shared by editable state and playback requests;
  layer selectors prevent duplicate channel claims.
- **Coverage**: cseq-rhythm literature goldens + rotation-equivalence and
  burst properties; six transport unit tests (weave/bypass/re-anchor,
  gesture step parity, repair); the invariant fuzzer's hocket builder derives
  strategy + euclid params + accent mode from the case seed (no new feature
  axis) plus the quota property, which directly checks every compacted
  `table[σ(g_j) mod n]` slot before checking aggregate quotas; golden
  two-cycle ledger `euclid_hocket_chatusra`; TS goldens + panel e2e
  (`ui/tests/e2e/channel-euclid.spec.ts`).

## 4. Decisions

1. **Side-by-side strategies, mutually exclusive per track** — nothing
   Markov-side was deleted; dormant fields stay authored and validated so
   switching strategies never invalidates a spec.
2. **True Bjorklund next to the closed form** — channel patterns follow the
   literature exactly; Shape Groups keep ER-102 parity. Rotation-equivalence
   is property-tested so the two can never silently diverge further.
3. **One step per assigner call** — the only rule that keeps gesture
   semantics and seed-path replay identical across strategies.
4. **Reuse `RhythmChoiceSource`** — no new trace variants; the timeline,
   DTOs, and fixtures are untouched.
5. **Automation targets registered regardless of mode** (like the matrix
   lanes) so flipping strategies never invalidates authored automation.
6. **Randomize stays markov-scoped** in v1 — the channel randomize domain
   still generates matrix weights; a euclid recipe is follow-up work.

## 5. Deferred

- **`reset = never`** (free-running index across cycles): needs a
  `RatchetCarry`-style cycle-keyed checkpoint on `RhythmPlaybackConfig` plus
  its four lifecycle touchpoints, and carries a UX caveat (mid-play config
  applies re-anchor because `apply_in_place` replaces the config wholesale).
  Everything the original request names ships without it: "no reset per
  section" is the `cycle` scope.
- **Euclid randomize recipe**, **Hamming-distance "similar patterns"
  browser** (Toussaint's distance geometry), and per-layer accent-channel
  weighting are natural follow-ups.
- The libFuzzer targets generate ratchet-V2 specs with the V2 layer off
  (`band`/`fill`/`placement`: `None`) — V2-layer generation there is an open
  chore unrelated to this feature.
