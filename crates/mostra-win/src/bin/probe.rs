//! `mostra-win-probe`, a test probe that is never shipped (RT-10's access check): as another
//! local user, try to open each path, and say what happened.
//!
//! ```text
//! mostra-win-probe as-user <user> <password> <kind>:<path>…    kind: dir, file, pipe or mkdir
//!   (mkdir creates the directory as that user, so the user owns it)
//! → {"ok":true,"result":[{"path","read","readWrite","error"?}]}
//! ```
//! `read` opens for reading only (a directory: listing it), `readWrite` for reading and writing.
//!
//! ```text
//! mostra-win-probe suspend|resume <pid>    freezes or thaws every thread of a process
//! mostra-win-probe group <pid file> -- <program> <args>…
//!                                          runs it leading a console process group of its own
//! mostra-win-probe ctrl-break <pid>        sends that group Ctrl+Break, as a console would
//! mostra-win-probe end-session <pid>       sends that process's windows what a logoff sends
//! mostra-win-probe squat <user> <password> <name>
//!                                          as that user, holds \\.\pipe\<name> (or the event
//!                                          <name>, when it starts `Local\`) until stdin ends
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
        && (command == "ctrl-break" || command == "end-session")
    {
        std::process::exit(if command == "ctrl-break" {
            ctrl_break(pid)
        } else {
            end_session(pid)
        });
    }
    if let [command, pid_file, separator, program, rest @ ..] = arguments.as_slice()
        && command == "group"
        && separator == "--"
    {
        std::process::exit(group(pid_file, program, rest));
    }
    if let [command, pid] = arguments.as_slice()
        && (command == "suspend" || command == "resume")
    {
        std::process::exit(suspend(pid, command == "suspend"));
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

/// Sends Ctrl+Break to the console process group `pid` leads; prints one JSON answer.
#[cfg(windows)]
fn suspend(pid: &str, suspend: bool) -> i32 {
    use mostra_win::win::sys;
    use serde_json::json;
    let Ok(pid) = pid.parse() else {
        return 2;
    };
    match sys::suspend_process(pid, suspend) {
        Ok(threads) => {
            println!(
                "{}",
                json!({ "ok": true, "result": { "threads": threads } })
            );
            0
        }
        Err(error) => {
            println!(
                "{}",
                json!({ "ok": false, "error": { "message": error.to_string() } })
            );
            1
        }
    }
}

#[cfg(windows)]
fn end_session(pid: &str) -> i32 {
    use mostra_win::win::sys;
    use serde_json::json;
    let Ok(pid) = pid.parse() else {
        return 2;
    };
    match sys::end_session_of(pid, 10_000) {
        Ok(windows) => {
            println!(
                "{}",
                json!({ "ok": true, "result": { "windows": windows } })
            );
            0
        }
        Err(error) => {
            println!(
                "{}",
                json!({ "ok": false, "error": { "message": error.to_string() } })
            );
            1
        }
    }
}

#[cfg(windows)]
fn ctrl_break(pid: &str) -> i32 {
    use mostra_win::win::sys;
    use serde_json::json;
    let Ok(pid) = pid.parse() else {
        return 2;
    };
    match sys::send_ctrl_break(pid) {
        Ok(()) => {
            println!("{}", json!({ "ok": true, "result": {} }));
            0
        }
        Err(error) => {
            println!(
                "{}",
                json!({ "ok": false, "error": { "message": error.to_string() } })
            );
            1
        }
    }
}

/// Runs `program` as the leader of a console process group of its own, on this console and with
/// these standard streams, writes its PID to `pid_file`, and exits with its code: so a test can
/// send it Ctrl+Break (`ctrl-break <pid>`) as a person at the console would, and nothing else.
#[cfg(windows)]
fn group(pid_file: &str, program: &str, arguments: &[String]) -> i32 {
    use std::os::windows::process::CommandExt;
    /// `CREATE_NEW_PROCESS_GROUP`.
    const NEW_GROUP: u32 = 0x0000_0200;
    let mut child = match std::process::Command::new(program)
        .args(arguments)
        .creation_flags(NEW_GROUP)
        .spawn()
    {
        Ok(child) => child,
        Err(error) => {
            eprintln!("mostra-win-probe group: {error}");
            return 127;
        }
    };
    if let Err(error) = std::fs::write(pid_file, child.id().to_string()) {
        eprintln!("mostra-win-probe group: {error}");
        let _ = child.kill();
        return 127;
    }
    child
        .wait()
        .ok()
        .and_then(|status| status.code())
        .unwrap_or(1)
}

/// As another user, creates `\\.\pipe\<name>` (owned by that user, open to everyone), says so
/// on stdout and holds it until stdin ends: a pipe another user took under a name an instance once
/// served (Opus review of WP-W1).
#[cfg(windows)]
fn squat(user: &str, password: &str, name: &str) {
    use mostra_win::win::sys;
    use serde_json::json;
    if name.starts_with("Local\\") {
        squat_event(user, password, name);
        return;
    }
    let full = format!(r"\\.\pipe\{name}");
    let created = sys::as_user(user, password, || {
        // Several instances, so each client the test opens finds one free.
        sys::SecurityDescriptor::from_sddl("D:(A;;GA;;;WD)").and_then(|descriptor| {
            (0..8)
                .map(|index| sys::create_pipe_instance(&full, index == 0, &descriptor))
                .collect::<std::io::Result<Vec<_>>>()
        })
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

/// As that user, creates the named event `name` (in this session's `Local\` namespace) open to
/// everyone, and holds it until stdin ends: what someone who wanted to keep a launcher from
/// starting, or to stop it, would do.
#[cfg(windows)]
fn squat_event(user: &str, password: &str, name: &str) {
    use mostra_win::win::sys;
    use serde_json::json;
    let created = sys::as_user(user, password, || {
        sys::SecurityDescriptor::from_sddl("D:(A;;GA;;;WD)")
            .and_then(|descriptor| sys::NamedEvent::create(name, &descriptor))
    });
    match created {
        Ok(Ok(sys::Created::New(event) | sys::Created::Existing(event))) => {
            println!("{}", json!({ "ok": true, "result": { "event": name } }));
            let mut sink = String::new();
            let _ = std::io::stdin().read_line(&mut sink);
            drop(event);
        }
        Ok(Err(error)) | Err(error) => {
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
