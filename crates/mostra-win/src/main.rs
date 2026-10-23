//! `mostra-win`, Mostra's Windows platform helper. Every command prints one JSON line on stdout,
//! `{"ok":true,"result":…}` or `{"ok":false,"error":{"message":…,"os":…}}` (exit 1), except the
//! two long-running ones, `gate` and `pipe`, which speak on their descriptors 3 and 4:
//!
//! ```text
//! mostra-win secure-dir <path>              owner-only directory: {"secured":"created"|"kept"|"tightened","from"?}
//!                                           or {"refused":"not-owned","owner"} / {"refused":"not-directory"}
//! mostra-win seal <dir> | unseal <dir>      a version directory read-only for everyone, or owner-only again
//! mostra-win identity <pid>…                [{"pid","startTime"} | {"pid","gone":true} | {"pid","hidden":true}]
//! mostra-win processes                      [{"pid","ppid","startTime"?,"hidden"?}] for every running process
//! mostra-win reap <pid>:<startTime>…        ends recorded children's jobs: [{"pid","job","ended","reused"}]
//! mostra-win whoami                         {"user","owner"}: this process's SID and default owner
//! mostra-win gate -- <program> <args>…      the child gate (src/win/gate.rs); exits with the child's code
//! mostra-win pipe <name>                    serves \\.\pipe\<name> over descriptor 4 (src/win/pipe.rs)
//! mostra-win connect <name>                 a client of the pipe <name>, its owner checked, over
//!                                           stdin and stdout (src/win/connect.rs)
//! ```

#[cfg(windows)]
fn main() {
    std::process::exit(windows::main(
        &std::env::args_os().skip(1).collect::<Vec<_>>(),
    ));
}

#[cfg(not(windows))]
fn main() {
    eprintln!("mostra-win runs on Windows only.");
    std::process::exit(2);
}

#[cfg(windows)]
mod windows {
    use std::ffi::OsString;
    use std::io::Write;
    use std::path::Path;

    use mostra_win::win::{acl, connect, gate, pipe, process, sys};
    use serde_json::{Value, json};

    fn print(value: &Value) {
        let mut out = std::io::stdout().lock();
        let _ = writeln!(out, "{value}");
        let _ = out.flush();
    }

    fn fail(message: &str, error: Option<&std::io::Error>) -> i32 {
        print(
            &json!({ "ok": false, "error": { "message": message, "os": error.and_then(std::io::Error::raw_os_error) } }),
        );
        1
    }

    fn ok(result: &Value) -> i32 {
        print(&json!({ "ok": true, "result": result }));
        0
    }

    fn text(argument: &OsString) -> Option<&str> {
        argument.to_str()
    }

    pub fn main(arguments: &[OsString]) -> i32 {
        let Some(command) = arguments.first().and_then(text) else {
            return fail("usage: mostra-win <command> …", None);
        };
        let rest = &arguments[1..];
        match command {
            "gate" => {
                let start = usize::from(rest.first().and_then(text) == Some("--"));
                let Some(program) = rest.get(start) else {
                    eprintln!("usage: mostra-win gate -- <program> [arguments…]");
                    return 126;
                };
                gate::run(program, &rest[start + 1..])
            }
            "pipe" => match rest.first().and_then(text) {
                Some(name) if !name.is_empty() && !name.contains('\\') => pipe::run(name),
                _ => {
                    eprintln!("usage: mostra-win pipe <name>");
                    2
                }
            },
            "connect" => match rest.first().and_then(text) {
                Some(name) if !name.is_empty() && !name.contains('\\') => connect::run(name),
                _ => {
                    eprintln!("usage: mostra-win connect <name>");
                    2
                }
            },
            "secure-dir" => {
                let Some(path) = rest.first() else {
                    return fail("usage: mostra-win secure-dir <path>", None);
                };
                match acl::secure_directory(Path::new(path)) {
                    Ok(acl::Secured::Created) => ok(&json!({ "secured": "created" })),
                    Ok(acl::Secured::Kept) => ok(&json!({ "secured": "kept" })),
                    Ok(acl::Secured::Tightened { from }) => {
                        ok(&json!({ "secured": "tightened", "from": from }))
                    }
                    Err(acl::Refused::NotOwned { owner }) => {
                        ok(&json!({ "refused": "not-owned", "owner": owner }))
                    }
                    Err(acl::Refused::NotDirectory) => ok(&json!({ "refused": "not-directory" })),
                    Err(acl::Refused::Io(error)) => fail(&error.to_string(), Some(&error)),
                }
            }
            "seal" | "unseal" => {
                let Some(path) = rest.first() else {
                    return fail("usage: mostra-win seal|unseal <dir>", None);
                };
                match acl::reset_version(path, command == "seal") {
                    Ok(()) => ok(&json!({})),
                    Err(error) => fail(&error.to_string(), Some(&error)),
                }
            }
            "identity" => {
                let pids: Option<Vec<u32>> = rest
                    .iter()
                    .map(|a| text(a).and_then(|t| t.parse().ok()))
                    .collect();
                match pids {
                    Some(pids) => ok(&process::identity(&pids)),
                    None => fail("usage: mostra-win identity <pid>…", None),
                }
            }
            "processes" => match process::processes() {
                Ok(list) => ok(&list),
                Err(error) => fail(&error.to_string(), Some(&error)),
            },
            "reap" => {
                let targets: Option<Vec<(u32, String)>> = rest
                    .iter()
                    .map(|a| {
                        let (pid, start) = text(a)?.split_once(':')?;
                        Some((pid.parse().ok()?, start.to_owned()))
                    })
                    .collect();
                match targets {
                    Some(targets) => ok(&process::reap(&targets)),
                    None => fail("usage: mostra-win reap <pid>:<startTime>…", None),
                }
            }
            "whoami" => {
                let user = sys::current_user().and_then(|sid| sid.to_sddl());
                let owner = sys::default_owner().and_then(|sid| sid.to_sddl());
                match (user, owner) {
                    (Ok(user), Ok(owner)) => ok(&json!({ "user": user, "owner": owner })),
                    (Err(error), _) | (_, Err(error)) => fail(&error.to_string(), Some(&error)),
                }
            }
            _ => fail(&format!("unknown command {command}"), None),
        }
    }
}
