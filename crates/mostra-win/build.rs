//! Embeds `windows.manifest` in every program of this crate built for Windows with MSVC's linker:
//! each runs as whoever starts it (`asInvoker`), so UAC's installer detection never takes one for
//! an installer and asks an ordinary user for elevation (D153; `mostra-setup.exe` met it on
//! Windows arm64).

fn main() {
    println!("cargo:rerun-if-changed=windows.manifest");
    let windows = std::env::var("CARGO_CFG_TARGET_OS").is_ok_and(|os| os == "windows");
    let msvc = std::env::var("CARGO_CFG_TARGET_ENV").is_ok_and(|env| env == "msvc");
    if windows && msvc {
        let manifest = std::path::Path::new(&std::env::var("CARGO_MANIFEST_DIR").unwrap())
            .join("windows.manifest");
        println!("cargo:rustc-link-arg-bins=/MANIFEST:EMBED");
        println!(
            "cargo:rustc-link-arg-bins=/MANIFESTINPUT:{}",
            manifest.display()
        );
    }
}
