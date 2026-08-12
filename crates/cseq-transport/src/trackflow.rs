//! Pure Track Flow resolver.
//!
//! Track Flow is the project's *sequential* playback lane. Where parallel tracks
//! free-run together, Track Flow tracks are grouped into **boxes**; each box is a
//! single synthetic runtime participant — `track-flow-<boxId>` — that chooses
//! between its member source tracks, one at a time, governed by its own Markov
//! chain. A project can have any number of boxes, each playing in parallel with
//! ordinary parallel tracks and with every other box. This module is the pure
//! head of that flow: given a chain spec and a seed, it decides which member
//! source-track *index* a box realizes next. It holds no transport/runtime state
//! and does no I/O. (The v1 single lane is now the box with id `main`.)
//!
//! It mirrors the channel-hocket resolver in `cseq-rhythm` (a Markov walk over a
//! small set of integer states with entry/fallback weights), but over
//! source-track indices instead of MIDI channels. Determinism: identical
//! `(spec, seed)` yields an identical choice sequence.
//!
//! ## The load-bearing identity split (do not collapse), generalized per box
//! - **Display** uses the authored `sourceTrackId` (the timeline shows which
//!   track the box is currently playing) plus the box name.
//! - **Conflict resolution** uses the box's synthetic lane slot, [`lane_id`]
//!   (`track-flow-<boxId>`) — one participant, regardless of how many tracks
//!   feed it.
//! - **Seed-path replay** uses the composite id from [`seed_path_id`]
//!   (`track-flow-<boxId>:<sourceId>`) so a Track Flow realization never collides
//!   with the same track's ordinary parallel seed-path identity, nor with the
//!   same source in another box.

use cseq_rhythm::MarkovOrder;

/// The reserved id family prefix for every Track Flow box. A box with id `b`
/// owns the lane id `track-flow-<b>` and the composite seed-path namespace
/// `track-flow-<b>:`. Authored parallel-track and box-member ids must never
/// start with this, or the conflict/seed-path identity splits could collapse.
pub const TRACK_FLOW_PREFIX: &str = "track-flow-";

/// The conflict-lane participant id for a box: `track-flow-<boxId>`. The lane
/// counts as exactly one conflict participant when it is sounding, and
/// contributes nothing while idle. The v1 single lane is `lane_id("main")` ==
/// `"track-flow-main"`.
pub fn lane_id(box_id: &str) -> String {
    format!("{TRACK_FLOW_PREFIX}{box_id}")
}

/// Composite seed-path identity for a box-member source realization,
/// `track-flow-<boxId>:<sourceTrackId>` — distinct from the source track's
/// ordinary parallel seed-path id (so replay of one never matches the other) and
/// distinct across boxes (the `boxId` segment disambiguates). Box ids may not
/// contain `:` (see [`validate_box_id`]) so this composite parses unambiguously.
pub fn seed_path_id(box_id: &str, source_track_id: &str) -> String {
    format!("{}:{source_track_id}", lane_id(box_id))
}

/// True if `id` falls in the reserved Track Flow id family ([`TRACK_FLOW_PREFIX`])
/// — i.e. it would collide with some box's conflict lane id (`track-flow-<boxId>`)
/// or composite seed-path identity (`track-flow-<boxId>:<sourceId>`). Authored
/// parallel-track and box-member ids must avoid this namespace so conflict
/// routing and seed-path replay cannot be aliased by user data.
pub fn is_reserved_track_id(id: &str) -> bool {
    id.starts_with(TRACK_FLOW_PREFIX)
}

/// Validate a box id's intrinsic shape (the checks that need no project context):
/// it must be non-empty and must not contain `:`, so the composite seed-path
/// `track-flow-<boxId>:<sourceId>` parses unambiguously. Uniqueness across boxes
/// and non-collision of the derived lane id with authored track ids are checked
/// by the transport validator, which can see the whole project.
pub fn validate_box_id(box_id: &str) -> Result<(), String> {
    if box_id.trim().is_empty() {
        return Err("Track Flow box id is empty".to_string());
    }
    if box_id.contains(':') {
        return Err(format!(
            "Track Flow box id {box_id:?} must not contain ':' (it would break the seed-path identity)"
        ));
    }
    // The backend is the security boundary: a box id in the reserved family would
    // nest the prefix (`track-flow-track-flow-…`) and collide with the namespace
    // authored ids are kept out of. The frontend sanitizer repairs these; reject
    // them here too so a hand-crafted runtime config cannot smuggle one in.
    if is_reserved_track_id(box_id) {
        return Err(format!(
            "Track Flow box id {box_id:?} must not start with the reserved {TRACK_FLOW_PREFIX:?} prefix"
        ));
    }
    Ok(())
}

fn context_len(order: &MarkovOrder) -> usize {
    match order {
        MarkovOrder::First => 1,
        MarkovOrder::Second => 2,
    }
}

/// One transition in the Track Flow chain. `from` is a context of source-track
/// indices (length 1 for first-order, 2 for second-order); `to` is the next
/// source-track index.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TrackFlowTransition {
    pub from: Vec<u32>,
    pub to: u32,
    pub weight: u32,
}

/// Weight for starting the walk on a given context of source-track indices.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TrackFlowEntryWeight {
    pub states: Vec<u32>,
    pub weight: u32,
}

/// Weight for the fallback source-track index used when the chain has no
/// positive outgoing transition from the current context.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TrackFlowFallbackWeight {
    pub state: u32,
    pub weight: u32,
}

/// The Track Flow Markov chain over `state_count` source tracks. States are
/// indices into the lane's source-track list, in authored order. Pure structure
/// only; the concrete RNG seed is supplied to the resolver (mirroring
/// `cseq_rhythm::resolve_channel_hocket`, where the seed mode is resolved one
/// layer up).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TrackFlowSpec {
    pub order: MarkovOrder,
    pub state_count: u32,
    pub transitions: Vec<TrackFlowTransition>,
    pub fallback: u32,
    pub fallback_weights: Vec<TrackFlowFallbackWeight>,
    pub entry_weights: Vec<TrackFlowEntryWeight>,
}

impl TrackFlowSpec {
    /// The v1 default chain: a uniform first-order walk over `state_count`
    /// tracks — every state can follow every state with equal weight, and the
    /// walk also *starts* uniformly (one entry weight per state). With no
    /// authored chain this makes the lane wander uniformly at random while
    /// staying fully deterministic per seed.
    pub fn uniform(state_count: u32) -> Self {
        let n = state_count.max(1);
        let mut transitions = Vec::with_capacity((n * n) as usize);
        for from in 0..n {
            for to in 0..n {
                transitions.push(TrackFlowTransition {
                    from: vec![from],
                    to,
                    weight: 1,
                });
            }
        }
        let entry_weights = (0..n)
            .map(|state| TrackFlowEntryWeight {
                states: vec![state],
                weight: 1,
            })
            .collect();
        Self {
            order: MarkovOrder::First,
            state_count: n,
            transitions,
            fallback: 0,
            fallback_weights: Vec::new(),
            entry_weights,
        }
    }
}

/// Validate an authored Track Flow chain against its source count. Rejects
/// malformed Markov data — out-of-range fallback/entry/transition states, wrong
/// context lengths, or a `state_count` that disagrees with the sources — so bad
/// data can never silently play the wrong source instead of being clamped.
pub fn validate_track_flow_spec(spec: &TrackFlowSpec, source_count: usize) -> Result<(), String> {
    if source_count == 0 {
        return Err("track flow spec has no source tracks".to_string());
    }
    let n = source_count as u32;
    if spec.state_count != n {
        return Err(format!(
            "track flow spec state_count {} does not match {} source tracks",
            spec.state_count, source_count
        ));
    }
    if spec.fallback >= n {
        return Err(format!(
            "track flow fallback source {} is out of range (0..{n})",
            spec.fallback
        ));
    }
    let ctx = context_len(&spec.order);
    for fallback in &spec.fallback_weights {
        if fallback.state >= n {
            return Err(format!(
                "track flow fallback weight references out-of-range source {}",
                fallback.state
            ));
        }
    }
    for entry in &spec.entry_weights {
        if entry.states.len() != ctx {
            return Err(format!(
                "track flow entry weight context length {} does not match order ({ctx})",
                entry.states.len()
            ));
        }
        if entry.states.iter().any(|state| *state >= n) {
            return Err("track flow entry weight references an out-of-range source".to_string());
        }
    }
    for transition in &spec.transitions {
        if transition.from.len() != ctx {
            return Err(format!(
                "track flow transition context length {} does not match order ({ctx})",
                transition.from.len()
            ));
        }
        if transition.from.iter().any(|state| *state >= n) || transition.to >= n {
            return Err("track flow transition references an out-of-range source".to_string());
        }
    }
    Ok(())
}

/// Why a particular source-track index was chosen — useful for tests and for
/// surfacing "stuck chain" diagnostics later.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TrackFlowChoiceSource {
    /// Picked from the entry-weight selector at the start of the walk.
    Entry,
    /// Picked from a positive outgoing transition for the current context.
    Transition,
    /// The chain had no positive outgoing transition; fell back.
    Fallback,
}

/// One resolved step: the chosen source-track index and how it was chosen.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ResolvedTrackChoice {
    pub state: u32,
    pub source: TrackFlowChoiceSource,
}

/// SplitMix64 — a private copy of the same PRNG the channel-hocket resolver uses
/// (it is not exported from `cseq-rhythm`), so Track Flow draws are bit-identical
/// in spirit and self-contained here.
#[derive(Debug, Clone)]
struct SplitMix64 {
    state: u64,
}

impl SplitMix64 {
    fn new(seed: u64) -> Self {
        Self { state: seed }
    }

    fn next_u64(&mut self) -> u64 {
        self.state = self.state.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.state;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }

    fn next_below(&mut self, upper_exclusive: u64) -> u64 {
        if upper_exclusive == 0 {
            return 0;
        }
        self.next_u64() % upper_exclusive
    }
}

/// A stateful Track Flow walk. Build one per playback run (or per replay) and
/// call [`TrackFlowResolver::next_choice`] once per cycle the lane sounds.
#[derive(Debug, Clone)]
pub struct TrackFlowResolver {
    spec: TrackFlowSpec,
    context_len: usize,
    seed: u64,
    rng: SplitMix64,
    history: Vec<u32>,
    pending_entry: Vec<u32>,
}

impl TrackFlowResolver {
    pub fn new(spec: TrackFlowSpec, seed: u64) -> Self {
        let context_len = context_len(&spec.order);
        Self {
            spec,
            context_len,
            seed,
            rng: SplitMix64::new(seed),
            history: Vec::new(),
            pending_entry: Vec::new(),
        }
    }

    /// Restore the walk to its initial state (same RNG seed, empty history) so a
    /// playback reapply reproduces the identical choice sequence — mirroring how
    /// triggered followers reset their carry/cursor in the transport.
    pub fn reset(&mut self) {
        self.rng = SplitMix64::new(self.seed);
        self.history.clear();
        self.pending_entry.clear();
    }

    /// Resolve the next source-track index for the lane.
    pub fn next_choice(&mut self) -> ResolvedTrackChoice {
        let choice = if self.history.len() < self.context_len {
            if self.pending_entry.is_empty() {
                self.pending_entry = choose_entry(&self.spec, self.context_len, &mut self.rng);
                let already_filled = self.history.len().min(self.pending_entry.len());
                self.pending_entry.drain(0..already_filled);
            }
            ResolvedTrackChoice {
                state: self
                    .pending_entry
                    .first()
                    .copied()
                    .unwrap_or(self.spec.fallback),
                source: TrackFlowChoiceSource::Entry,
            }
        } else {
            let context = &self.history[self.history.len() - self.context_len..];
            choose_transition(&self.spec, context, &mut self.rng).unwrap_or(ResolvedTrackChoice {
                state: choose_fallback(&self.spec, &mut self.rng),
                source: TrackFlowChoiceSource::Fallback,
            })
        };
        if choice.source == TrackFlowChoiceSource::Entry && !self.pending_entry.is_empty() {
            self.pending_entry.remove(0);
        }
        self.history.push(choice.state);
        choice
    }
}

/// Resolve `count` Track Flow choices from `spec` seeded by `seed`. Convenience
/// for tests and batch resolution; the runtime drives [`TrackFlowResolver`]
/// directly, one choice per sounding cycle.
pub fn resolve_track_flow(
    spec: &TrackFlowSpec,
    count: usize,
    seed: u64,
) -> Vec<ResolvedTrackChoice> {
    let mut resolver = TrackFlowResolver::new(spec.clone(), seed);
    (0..count).map(|_| resolver.next_choice()).collect()
}

fn choose_entry(spec: &TrackFlowSpec, context_len: usize, rng: &mut SplitMix64) -> Vec<u32> {
    let candidates = spec
        .entry_weights
        .iter()
        .filter(|entry| {
            entry.weight > 0
                && entry.states.len() == context_len
                && entry.states.iter().all(|state| *state < spec.state_count)
        })
        .collect::<Vec<_>>();
    let total = candidates
        .iter()
        .map(|entry| entry.weight as u64)
        .sum::<u64>();
    if total == 0 {
        return vec![spec.fallback; context_len];
    }
    let mut pick = rng.next_below(total);
    for entry in candidates {
        let weight = entry.weight as u64;
        if pick < weight {
            return entry.states.clone();
        }
        pick -= weight;
    }
    vec![spec.fallback; context_len]
}

fn choose_fallback(spec: &TrackFlowSpec, rng: &mut SplitMix64) -> u32 {
    let candidates = spec
        .fallback_weights
        .iter()
        .filter(|fallback| fallback.weight > 0 && fallback.state < spec.state_count)
        .collect::<Vec<_>>();
    let total = candidates
        .iter()
        .map(|fallback| fallback.weight as u64)
        .sum::<u64>();
    if total == 0 {
        return spec.fallback;
    }
    let mut pick = rng.next_below(total);
    for fallback in candidates {
        let weight = fallback.weight as u64;
        if pick < weight {
            return fallback.state;
        }
        pick -= weight;
    }
    spec.fallback
}

fn choose_transition(
    spec: &TrackFlowSpec,
    context: &[u32],
    rng: &mut SplitMix64,
) -> Option<ResolvedTrackChoice> {
    let candidates = spec
        .transitions
        .iter()
        .filter(|transition| {
            transition.weight > 0
                && transition.from == context
                // Defense-in-depth: never pick an out-of-range target even if a
                // spec slipped past validation. Valid specs have none.
                && transition.to < spec.state_count
        })
        .collect::<Vec<_>>();
    let total = candidates
        .iter()
        .map(|transition| transition.weight as u64)
        .sum::<u64>();
    if total == 0 {
        return None;
    }
    let mut pick = rng.next_below(total);
    for transition in candidates {
        let weight = transition.weight as u64;
        if pick < weight {
            return Some(ResolvedTrackChoice {
                state: transition.to,
                source: TrackFlowChoiceSource::Transition,
            });
        }
        pick -= weight;
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lane_and_seed_path_ids_are_composite_and_distinct_per_box() {
        assert_eq!(lane_id("main"), "track-flow-main");
        assert_eq!(lane_id("a"), "track-flow-a");
        assert_eq!(seed_path_id("main", "track-3"), "track-flow-main:track-3");
        assert_eq!(seed_path_id("a", "track-3"), "track-flow-a:track-3");
        assert_ne!(seed_path_id("main", "track-3"), "track-3");
        // Same source in two boxes never aliases.
        assert_ne!(seed_path_id("a", "track-3"), seed_path_id("b", "track-3"));
    }

    #[test]
    fn reserved_namespace_covers_the_whole_track_flow_family() {
        assert!(is_reserved_track_id("track-flow-main"));
        assert!(is_reserved_track_id("track-flow-main:s0"));
        assert!(is_reserved_track_id("track-flow-anything"));
        assert!(is_reserved_track_id(&lane_id("b")));
        assert!(is_reserved_track_id(&seed_path_id("b", "s0")));
        // Authored ids outside the reserved namespace are fine.
        assert!(!is_reserved_track_id("track-3"));
        assert!(!is_reserved_track_id("track-flo"));
        assert!(!is_reserved_track_id(""));
    }

    #[test]
    fn validate_box_id_rejects_empty_colon_and_reserved() {
        assert!(validate_box_id("main").is_ok());
        assert!(validate_box_id("box-a").is_ok());
        assert!(validate_box_id("").is_err());
        assert!(validate_box_id("   ").is_err());
        assert!(validate_box_id("a:b").is_err());
        // A box id in the reserved family is rejected at the security boundary.
        assert!(validate_box_id("track-flow-x").is_err());
        assert!(validate_box_id(&lane_id("a")).is_err());
    }

    #[test]
    fn validate_accepts_a_well_formed_and_the_uniform_spec() {
        assert!(validate_track_flow_spec(&TrackFlowSpec::uniform(4), 4).is_ok());
        let spec = TrackFlowSpec {
            order: MarkovOrder::First,
            state_count: 2,
            transitions: vec![TrackFlowTransition {
                from: vec![0],
                to: 1,
                weight: 1,
            }],
            fallback: 0,
            fallback_weights: vec![TrackFlowFallbackWeight {
                state: 1,
                weight: 1,
            }],
            entry_weights: vec![TrackFlowEntryWeight {
                states: vec![0],
                weight: 1,
            }],
        };
        assert!(validate_track_flow_spec(&spec, 2).is_ok());
    }

    #[test]
    fn validate_rejects_malformed_specs() {
        let base = TrackFlowSpec::uniform(2);
        // state_count disagreeing with the source count.
        assert!(validate_track_flow_spec(&base, 3).is_err());
        // out-of-range transition target.
        let bad_to = TrackFlowSpec {
            transitions: vec![TrackFlowTransition {
                from: vec![0],
                to: 5,
                weight: 1,
            }],
            ..TrackFlowSpec::uniform(2)
        };
        assert!(validate_track_flow_spec(&bad_to, 2).is_err());
        // out-of-range fallback.
        let bad_fallback = TrackFlowSpec {
            fallback: 9,
            ..TrackFlowSpec::uniform(2)
        };
        assert!(validate_track_flow_spec(&bad_fallback, 2).is_err());
        // wrong context length for the order.
        let bad_ctx = TrackFlowSpec {
            order: MarkovOrder::Second,
            transitions: vec![TrackFlowTransition {
                from: vec![0],
                to: 1,
                weight: 1,
            }],
            entry_weights: vec![TrackFlowEntryWeight {
                states: vec![0, 1],
                weight: 1,
            }],
            ..TrackFlowSpec::uniform(2)
        };
        assert!(validate_track_flow_spec(&bad_ctx, 2).is_err());
        // zero sources.
        assert!(validate_track_flow_spec(&TrackFlowSpec::uniform(1), 0).is_err());
    }

    #[test]
    fn is_deterministic_for_a_given_seed() {
        let spec = TrackFlowSpec::uniform(4);
        let a = resolve_track_flow(&spec, 32, 1234);
        let b = resolve_track_flow(&spec, 32, 1234);
        assert_eq!(a, b);
    }

    #[test]
    fn reset_reproduces_the_initial_sequence() {
        let spec = TrackFlowSpec::uniform(4);
        let mut resolver = TrackFlowResolver::new(spec, 1234);
        let first: Vec<u32> = (0..16).map(|_| resolver.next_choice().state).collect();
        resolver.reset();
        let again: Vec<u32> = (0..16).map(|_| resolver.next_choice().state).collect();
        assert_eq!(first, again);
    }

    #[test]
    fn different_seeds_diverge() {
        let spec = TrackFlowSpec::uniform(4);
        let a = resolve_track_flow(&spec, 32, 1);
        let b = resolve_track_flow(&spec, 32, 2);
        assert_ne!(a, b);
    }

    #[test]
    fn all_choices_are_valid_state_indices() {
        let spec = TrackFlowSpec::uniform(5);
        for choice in resolve_track_flow(&spec, 200, 99) {
            assert!(choice.state < 5, "state {} out of range", choice.state);
        }
    }

    #[test]
    fn uniform_chain_visits_every_track_over_a_long_run() {
        let spec = TrackFlowSpec::uniform(4);
        let mut seen = [false; 4];
        for choice in resolve_track_flow(&spec, 500, 7) {
            seen[choice.state as usize] = true;
        }
        assert!(
            seen.iter().all(|&s| s),
            "uniform walk did not visit all tracks"
        );
    }

    #[test]
    fn first_choice_uses_the_entry_selector() {
        let spec = TrackFlowSpec::uniform(3);
        let mut resolver = TrackFlowResolver::new(spec, 42);
        assert_eq!(resolver.next_choice().source, TrackFlowChoiceSource::Entry);
        assert_eq!(
            resolver.next_choice().source,
            TrackFlowChoiceSource::Transition
        );
    }

    #[test]
    fn deterministic_transitions_force_a_fixed_cycle() {
        // 0 -> 1 -> 2 -> 0 ... with a single entry on state 0.
        let spec = TrackFlowSpec {
            order: MarkovOrder::First,
            state_count: 3,
            transitions: vec![
                TrackFlowTransition {
                    from: vec![0],
                    to: 1,
                    weight: 1,
                },
                TrackFlowTransition {
                    from: vec![1],
                    to: 2,
                    weight: 1,
                },
                TrackFlowTransition {
                    from: vec![2],
                    to: 0,
                    weight: 1,
                },
            ],
            fallback: 0,
            fallback_weights: vec![],
            entry_weights: vec![TrackFlowEntryWeight {
                states: vec![0],
                weight: 1,
            }],
        };
        let states: Vec<u32> = resolve_track_flow(&spec, 7, 123)
            .into_iter()
            .map(|c| c.state)
            .collect();
        assert_eq!(states, vec![0, 1, 2, 0, 1, 2, 0]);
    }

    #[test]
    fn falls_back_when_the_chain_has_no_outgoing_transition() {
        // Start on state 0 (entry), but no transition leaves state 0, so the
        // second choice must come from the weighted fallback (state 2).
        let spec = TrackFlowSpec {
            order: MarkovOrder::First,
            state_count: 3,
            transitions: vec![],
            fallback: 0,
            fallback_weights: vec![TrackFlowFallbackWeight {
                state: 2,
                weight: 1,
            }],
            entry_weights: vec![TrackFlowEntryWeight {
                states: vec![0],
                weight: 1,
            }],
        };
        let choices = resolve_track_flow(&spec, 2, 5);
        assert_eq!(choices[0].state, 0);
        assert_eq!(choices[0].source, TrackFlowChoiceSource::Entry);
        assert_eq!(choices[1].state, 2);
        assert_eq!(choices[1].source, TrackFlowChoiceSource::Fallback);
    }

    #[test]
    fn second_order_context_uses_last_two_states() {
        // Entry seeds [0, 1]; from context [0,1] -> 2; from [1,2] -> 0.
        let spec = TrackFlowSpec {
            order: MarkovOrder::Second,
            state_count: 3,
            transitions: vec![
                TrackFlowTransition {
                    from: vec![0, 1],
                    to: 2,
                    weight: 1,
                },
                TrackFlowTransition {
                    from: vec![1, 2],
                    to: 0,
                    weight: 1,
                },
            ],
            fallback: 0,
            fallback_weights: vec![],
            entry_weights: vec![TrackFlowEntryWeight {
                states: vec![0, 1],
                weight: 1,
            }],
        };
        let states: Vec<u32> = resolve_track_flow(&spec, 4, 9)
            .into_iter()
            .map(|c| c.state)
            .collect();
        assert_eq!(states, vec![0, 1, 2, 0]);
    }
}
