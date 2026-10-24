//! `mostra-win-service`, the login service's launcher on Windows (RT-11, D151): what the home's
//! Task Scheduler task runs at the user's logon. It is a program without a console, so no window
//! opens at logon, and it runs the daemon without one (`src/win/service.rs`):
//!
//! ```text
//! mostra-win-service --stop-event Local\mostra-service-<hash> --log <home>\logs\service.log
//!                    -- <node.exe> <mostra-runtime> daemon --always-on --home <home>
//! ```
//!
//! It exits 0 when the daemon exits 0 or `mostra-win service-stop` stops it, 1 when it can't run
//! at all, and 2 on a usage error (nothing is printed: it has no console).

// No console: Windows opens no window when Task Scheduler starts it.
#![cfg_attr(windows, windows_subsystem = "windows")]

#[cfg(windows)]
fn main() {
    let arguments: Vec<std::ffi::OsString> = std::env::args_os().skip(1).collect();
    let Some(options) = mostra_win::win::service::parse(&arguments) else {
        std::process::exit(2);
    };
    std::process::exit(mostra_win::win::service::run(&options));
}

#[cfg(not(windows))]
fn main() {
    eprintln!("mostra-win-service runs on Windows only.");
    std::process::exit(2);
}
