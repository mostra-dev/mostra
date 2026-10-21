//! Embeds the release's bundle pins (`bundles.json`, which the release writes into the crate
//! before `cargo publish`, D143), so a published crate installs exactly the bundles its release
//! attested. A development checkout has none.

use std::path::PathBuf;

fn main() {
    let manifest = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").expect("set by cargo"));
    let pins = manifest.join("bundles.json");
    println!("cargo::rerun-if-changed={}", pins.display());
    let code = match std::fs::read_to_string(&pins) {
        Ok(text) => {
            // Pins of another release would install another runtime than this crate speaks to.
            let version = serde_json::from_str::<serde_json::Value>(&text)
                .ok()
                .and_then(|pins| pins["version"].as_str().map(str::to_owned));
            let crate_version = std::env::var("CARGO_PKG_VERSION").expect("set by cargo");
            assert!(
                version.as_deref() == Some(crate_version.as_str()),
                "bundles.json pins release {version:?}, but this crate is {crate_version}: \
                 a release writes the pins of its own version (D143); remove a stale bundles.json"
            );
            format!("Some({text:?})")
        }
        Err(_) => "None".to_owned(),
    };
    let out = PathBuf::from(std::env::var("OUT_DIR").expect("set by cargo")).join("pins.rs");
    std::fs::write(out, code).expect("OUT_DIR is writable");
}
