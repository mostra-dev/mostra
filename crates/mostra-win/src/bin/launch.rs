//! `mostra-launch`, the runtime bundle's launcher on Windows (RT-12, D153): copied into a
//! bundle's `bin\` as `mostra.exe`, `mostra-runtime.exe` and `mostra-setup.exe`, each running the
//! entry its name picks on the bundle's own Node.js (`src/win/launch.rs`).

#[cfg(windows)]
fn main() {
    let arguments: Vec<std::ffi::OsString> = std::env::args_os().skip(1).collect();
    std::process::exit(mostra_win::win::launch::run(&arguments));
}

#[cfg(not(windows))]
fn main() {
    eprintln!("mostra-launch runs on Windows only.");
    std::process::exit(2);
}
