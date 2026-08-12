//! Host time utilities for CoreMIDI timestamped sends.
//!
//! CoreMIDI timestamps are in mach absolute time units. These functions
//! convert between nanoseconds and host time using `mach_timebase_info`,
//! which is calibrated once at first use.

use std::sync::OnceLock;

// mach_timebase_info gives us (numer, denom) to convert host ticks ↔ nanos:
//   nanos = host_ticks * numer / denom
//   host_ticks = nanos * denom / numer

extern "C" {
    fn mach_absolute_time() -> u64;
    fn mach_timebase_info(info: *mut MachTimebaseInfo) -> i32;
}

#[repr(C)]
#[derive(Debug, Clone, Copy)]
struct MachTimebaseInfo {
    numer: u32,
    denom: u32,
}

static TIMEBASE: OnceLock<MachTimebaseInfo> = OnceLock::new();

fn timebase() -> MachTimebaseInfo {
    *TIMEBASE.get_or_init(|| {
        let mut info = MachTimebaseInfo { numer: 0, denom: 0 };
        // Safety: mach_timebase_info is always safe to call with a valid pointer.
        unsafe { mach_timebase_info(&mut info) };
        assert!(
            info.numer > 0 && info.denom > 0,
            "invalid mach_timebase_info"
        );
        info
    })
}

/// Current host time in mach absolute time units.
pub fn host_time_now() -> u64 {
    // Safety: mach_absolute_time is always safe to call.
    unsafe { mach_absolute_time() }
}

/// Convert nanoseconds to mach host time units.
pub fn nanos_to_host_time(nanos: u64) -> u64 {
    let tb = timebase();
    // host_ticks = nanos * denom / numer
    // Use u128 to avoid overflow on large values.
    ((nanos as u128 * tb.denom as u128) / tb.numer as u128) as u64
}

/// Convert mach host time units to nanoseconds.
pub fn host_time_to_nanos(host_time: u64) -> u64 {
    let tb = timebase();
    // nanos = host_ticks * numer / denom
    ((host_time as u128 * tb.numer as u128) / tb.denom as u128) as u64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip_conversion() {
        let nanos: u64 = 1_000_000_000; // 1 second
        let ht = nanos_to_host_time(nanos);
        let back = host_time_to_nanos(ht);
        // Allow rounding error of 1 nanosecond.
        assert!((back as i64 - nanos as i64).unsigned_abs() <= 1);
    }

    #[test]
    fn host_time_now_is_nonzero() {
        assert!(host_time_now() > 0);
    }
}
