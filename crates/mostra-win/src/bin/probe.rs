//! `mostra-win-probe`, a test probe that is never shipped (RT-10's access check): as another
//! local user, try to open each path, and say what happened.
//!
//! ```text
//! mostra-win-probe as-user <user> <password> <kind>:<path>…    kind: dir, file, pipe, mkdir or job
//!   (mkdir creates the directory as that user, so the user owns it; job creates a named job)
//! → {"ok":true,"result":[{"path","read","readWrite","error"?}]}
//! ```
//! `read` opens for reading only (a directory: listing it), `readWrite` for reading and writing.
//!
//! ```text
//! mostra-win-probe suspend|resume <pid>    freezes or thaws every thread of a process
//! mostra-win-probe squat <user> <password> <name>
//!                                          as that user, holds \\.\pipe\<name> until stdin ends
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
        security(path);
        return;
    }
    if let [command, user, password, name] = arguments.as_slice()
        && command == "squat"
    {
        squat(user, password, name);
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
                if kind == "job" {
                    // A named job in the global namespace, as a gate makes one.
                    let made = sys::current_user()
                        .and_then(|user| user.to_sddl())
                        .and_then(|user| mostra_win::win::acl::owner_only_object(&user))
                        .and_then(|descriptor| sys::Job::create(path, &descriptor));
                    return json!({
                        "path": target,
                        "created": made.is_ok(),
                        "error": made.err().and_then(|e| e.raw_os_error()),
                    });
                }
                if kind == "mkdir" {
                    let made = std::fs::create_dir(path);
                    return json!({
                        "path": target,
                        "created": made.is_ok(),
                        "error": made.err().and_then(|e| e.raw_os_error()),
                    });
                }
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

/// Prints a path's security descriptor as SDDL and whether its list is protected.
#[cfg(windows)]
fn security(path: &str) {
    use std::ffi::OsStr;

    use mostra_win::win::sys;
    use serde_json::json;
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
}

/// As another user, creates `\\.\pipe\<name>` (owned by that user, open to everyone), says so
/// on stdout and holds it until stdin ends: a pipe another user took under a name an instance once
/// served (Opus review of WP-W1).
#[cfg(windows)]
fn squat(user: &str, password: &str, name: &str) {
    use mostra_win::win::sys;
    use serde_json::json;
    let full = format!(r"\\.\pipe\{name}");
    let created = sys::as_user(user, password, || {
        sys::SecurityDescriptor::from_sddl("D:(A;;GA;;;WD)")
            .and_then(|descriptor| sys::create_pipe_instance(&full, true, &descriptor))
    });
    match created {
        Ok(Ok(pipe)) => {
            println!("{}", json!({ "ok": true, "result": { "pipe": full } }));
            let mut sink = String::new();
            let _ = std::io::stdin().read_line(&mut sink);
            drop(pipe);
        }
        Ok(Err(error)) | Err(error) => {
            println!(
                "{}",
                json!({ "ok": false, "error": { "message": error.to_string() } })
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
