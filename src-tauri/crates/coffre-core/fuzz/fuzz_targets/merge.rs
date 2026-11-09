#![no_main]

use libfuzzer_sys::fuzz_target;

fuzz_target!(|data: &[u8]| {
    if let Ok(text) = std::str::from_utf8(data) {
        if let Ok(file) = coffre_core::VaultFile::parse(text) {
            let _ = coffre_core::merge(&file, &[]);
        }
    }
});
