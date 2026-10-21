//! Embeds the release's bundle pins (`bundles.json`, which the release writes into the crate
//! before `cargo publish`, D143), so a published crate installs exactly the bundles its release
//! attested. A development checkout has none.

use std::path::PathBuf;

fn main() {
    let manifest = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").expect("set by cargo"));
    let pins = manifest.join("bundles.json");
    println!("cargo::rerun-if-changed={}", pins.display());
    let code = match std::fs::read_to_string(&pins) {
        Ok(text) => format!("Some({text:?})"),
        Err(_) => "None".to_owned(),
    };
    let out = PathBuf::from(std::env::var("OUT_DIR").expect("set by cargo")).join("pins.rs");
    std::fs::write(out, code).expect("OUT_DIR is writable");
}
