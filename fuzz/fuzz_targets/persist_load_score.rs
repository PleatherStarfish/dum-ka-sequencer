#![no_main]

use libfuzzer_sys::fuzz_target;

fuzz_target!(|data: &[u8]| {
    if data.len() > 64 * 1024 {
        return;
    }

    let Ok(json) = std::str::from_utf8(data) else {
        return;
    };

    let _ = cseq_persist::load_from_str(json);
});
