#![allow(dead_code)]

use arbitrary::Unstructured;
use cseq_model as model;

pub fn boolish(u: &mut Unstructured<'_>) -> bool {
    u.arbitrary::<bool>().unwrap_or(false)
}

pub fn index(u: &mut Unstructured<'_>, upper_exclusive: usize) -> usize {
    if upper_exclusive <= 1 {
        return 0;
    }
    u.int_in_range(0..=(upper_exclusive - 1)).unwrap_or(0)
}

pub fn small_usize(u: &mut Unstructured<'_>, min: usize, max: usize) -> usize {
    if min >= max {
        return min;
    }
    u.int_in_range(min..=max).unwrap_or(min)
}

pub fn small_u32(u: &mut Unstructured<'_>, min: u32, max: u32) -> u32 {
    if min >= max {
        return min;
    }
    u.int_in_range(min..=max).unwrap_or(min)
}

pub fn small_u64(u: &mut Unstructured<'_>, min: u64, max: u64) -> u64 {
    if min >= max {
        return min;
    }
    u.int_in_range(min..=max).unwrap_or(min)
}

pub fn small_i32(u: &mut Unstructured<'_>, min: i32, max: i32) -> i32 {
    if min >= max {
        return min;
    }
    u.int_in_range(min..=max).unwrap_or(min)
}

pub fn midi(u: &mut Unstructured<'_>, min: u8, max: u8) -> u8 {
    if min >= max {
        return min.min(127);
    }
    u.int_in_range(min.min(127)..=max.min(127))
        .unwrap_or(min.min(127))
}

pub fn unit_f32(u: &mut Unstructured<'_>) -> f32 {
    let raw = u.int_in_range(0..=1_000_u32).unwrap_or(0);
    raw as f32 / 1_000.0
}

pub fn positive_weight(u: &mut Unstructured<'_>) -> u32 {
    small_u32(u, 1, 64)
}

pub fn maybe_zero_weight(u: &mut Unstructured<'_>) -> u32 {
    small_u32(u, 0, 64)
}

pub fn pick_copy<T: Copy>(u: &mut Unstructured<'_>, values: &[T]) -> T {
    values[index(u, values.len())]
}

pub fn custom_subdivision(u: &mut Unstructured<'_>) -> model::CustomSubdivisionSpec {
    // `Score::subdivision_switch` validates this spec and deliberately panics
    // on invalid authored input. Keep the fuzz builder inside that constructor
    // precondition so the target reaches transport instead of treating its own
    // malformed fixture as an engine crash.
    let part_count_choice_len = small_usize(u, 1, 3);
    let first_part_count = small_u32(u, 1, 12);
    let part_count_weights = (0..part_count_choice_len)
        .map(|offset| model::WeightedCustomPartCount {
            count: 1 + ((first_part_count - 1 + offset as u32) % 12),
            weight: unit_f32(u).max(0.001),
        })
        .collect();
    let gati_choice_len = small_usize(u, 1, 3);

    model::CustomSubdivisionSpec {
        per_beat_weight: unit_f32(u) * 2.0,
        equal_parts_weight: (unit_f32(u) * 2.0).max(0.001),
        part_count_weights,
        part_gati_weights: (0..gati_choice_len)
            .map(|_| model::WeightedSubdivisionChoice {
                subdivision: small_u32(u, 1, 16),
                weight: unit_f32(u).max(0.001),
            })
            .collect(),
        divisions: vec![],
        jathi_weights: vec![],
    }
}
