//! `mostra-win-probe`, a test probe that is never shipped (RT-10's access check): as another
//! local user, try to open each path, and say what happened.
//!
//! ```text
//! mostra-win-probe as-user <user> <password> <kind>:<path>…    kind: dir, file or pipe
//! → {"ok":true,"result":[{"path","read","readWrite","error"?}]}
//! ```
//! `read` opens for reading only (a directory: listing it), `readWrite` for reading and writing.
//!
//! ```text
//! mostra-win-probe suspend|resume <pid>    freezes or thaws every thread of a process
//! ```

#[cfg(windows)]
fn main() {
    use std::ffi::OsStr;

    use mostra_win::win::sys;
    use serde_json::json;

    let arguments: Vec<String> = std::env::args().skip(1).collect();
    if let [command, path] = arguments.as_slice()
        && command == "security"
    {
        match sys::file_security(OsStr::new(path)) {
            Ok(security) => println!(
                "{}",
                json!({ "ok": true, "result": { "sddl": security.sddl, "protected": security.protected } })
            ),
            Err(error) => {
                println!(
                    "{}",
                    json!({ "ok": false, "error": { "message": error.to_string() } })
                );
                std::process::exit(1);
            }
        }
        return;
    }
    if let [command, pid] = arguments.as_slice()
        && (command == "suspend" || command == "resume")
    {
        {
            let Ok(pid) = pid.parse() else {
                std::process::exit(2)
            };
            match sys::suspend_process(pid, command == "suspend") {
                Ok(threads) => println!(
                    "{}",
                    json!({ "ok": true, "result": { "threads": threads } })
                ),
                Err(error) => {
                    println!(
                        "{}",
                        json!({ "ok": false, "error": { "message": error.to_string() } })
                    );
                    std::process::exit(1);
                }
            }
            return;
        }
    }
    let [command, user, password, targets @ ..] = arguments.as_slice() else {
        println!(
            "{}",
            json!({ "ok": false, "error": { "message": "usage: mostra-win-probe as-user <user> <password> <kind>:<path>…" } })
        );
        std::process::exit(2);
    };
    if command != "as-user" {
        std::process::exit(2);
    }
    let attempts = sys::as_user(user, password, || {
        targets
            .iter()
            .map(|target| {
                let (kind, path) = target.split_once(':').unwrap_or(("file", target));
                let path = OsStr::new(path);
                let directory = kind == "dir";
                let read = if directory {
                    sys::try_open(path, true)
                } else {
                    sys::try_open_read(path)
                };
                let read_write = sys::try_open(path, directory);
                json!({
                    "path": target,
                    "read": read.is_ok(),
                    "readWrite": read_write.is_ok(),
                    "error": read_write.err().and_then(|e| e.raw_os_error()),
                })
            })
            .collect::<Vec<_>>()
    });
    match attempts {
        Ok(result) => println!("{}", json!({ "ok": true, "result": result })),
        Err(error) => {
            println!(
                "{}",
                json!({ "ok": false, "error": { "message": error.to_string(), "os": error.raw_os_error() } })
            );
            std::process::exit(1);
        }
    }
}

#[cfg(not(windows))]
fn main() {
    eprintln!("mostra-win-probe runs on Windows only.");
    std::process::exit(2);
}
