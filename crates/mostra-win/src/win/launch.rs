//! The runtime bundle's launchers on Windows (RT-12, D153): `bin\mostra.exe`,
//! `bin\mostra-runtime.exe` and `bin\mostra-setup.exe` are copies of one program, which runs the
//! entry its own name picks (`bundle.json`'s `entries.cli`, `runtime` or `setup`) on the bundle's
//! own Node.js (`node.path`) with its arguments, from any directory, and exits with Node.js's exit
//! code: what the POSIX launchers' `exec "$root/node/bin/node" "$root/<entry>" "$@"` does.
//!
//! An executable rather than a `.cmd` script: Node.js refuses to spawn a `.cmd` without a shell
//! (CVE-2024-27980), `cmd.exe` re-parses `%*` (so `&`, `|`, `^` and `%` in an argument would
//! change the command), and a console's Ctrl+C asks "Terminate batch job (Y/N)?" after the program
//! itself has ended.
//!
//! Node.js runs in a kill-on-close job of the launcher's, so ending the launcher ends it (as
//! ending a POSIX launcher's PID, which `exec` gave to Node.js, does), while every process Node.js
//! starts is outside the job (silent breakaway, as libuv's own job), so a daemon the CLI starts
//! outlives the command. Node.js shares the launcher's console and gets its Ctrl+C; the launcher
//! outlives the event and exits once Node.js has.

use std::ffi::{OsStr, OsString};
use std::path::{Path, PathBuf};

use super::acl;
use super::gate::command_line;
use super::sys::{self, Job};

/// Exit code: the bundle couldn't be read (as the POSIX launcher's `exit 3`).
const EXIT_NO_BUNDLE: i32 = 3;
/// Exit code: Node.js couldn't be started (as a shell's 127).
const EXIT_CANNOT_RUN: i32 = 127;

/// Which `bundle.json` entry a launcher named `stem` runs.
pub fn entry_for(stem: &str) -> Option<&'static str> {
    match stem.to_ascii_lowercase().as_str() {
        "mostra" => Some("cli"),
        "mostra-runtime" => Some("runtime"),
        "mostra-setup" => Some("setup"),
        _ => None,
    }
}

/// The bundle a launcher at `exe` belongs to: `<root>\bin\<launcher>.exe`.
fn bundle_root(exe: &Path) -> Option<PathBuf> {
    exe.parent()?.parent().map(Path::to_path_buf)
}

/// A relative, `/`-separated path of the bundle as a path under `root`, or `None` when it would
/// leave the bundle (an absolute path, a `..`, a drive): `bundle.json` is the bundle's own, but a
/// launcher runs nothing outside it.
fn inside(root: &Path, relative: &str) -> Option<PathBuf> {
    let plain = !relative.is_empty()
        && !relative.contains(['\\', ':', '\0'])
        && relative
            .split('/')
            .all(|segment| !segment.is_empty() && segment != "." && segment != "..");
    plain.then(|| {
        relative
            .split('/')
            .fold(root.to_path_buf(), |path, part| path.join(part))
    })
}

/// What the launcher at `exe` runs: Node.js and the entry, or why it can't.
pub fn resolve(exe: &Path) -> Result<(PathBuf, PathBuf), String> {
    let stem = exe
        .file_stem()
        .and_then(OsStr::to_str)
        .ok_or("the launcher has no name")?;
    let entry = entry_for(stem).ok_or_else(|| format!("no bundle entry is named {stem}"))?;
    let root = bundle_root(exe).ok_or("the launcher isn't in a bundle's bin directory")?;
    let file = root.join("bundle.json");
    let text = std::fs::read_to_string(&file)
        .map_err(|error| format!("{} can't be read: {error}", file.display()))?;
    let info: serde_json::Value = serde_json::from_str(&text)
        .map_err(|_| format!("{} isn't a runtime bundle's", file.display()))?;
    let node = info["node"]["path"]
        .as_str()
        .and_then(|path| inside(&root, path));
    let script = info["entries"][entry]
        .as_str()
        .and_then(|path| inside(&root, path));
    match (node, script) {
        (Some(node), Some(script)) => Ok((node, script)),
        _ => Err(format!(
            "{} names no {entry} entry inside the bundle",
            file.display()
        )),
    }
}

/// Runs the launcher with `arguments`; returns the exit code.
pub fn run(arguments: &[OsString]) -> i32 {
    let exe = match std::env::current_exe() {
        Ok(exe) => exe,
        Err(error) => {
            eprintln!("mostra: the launcher can't find itself: {error}");
            return EXIT_NO_BUNDLE;
        }
    };
    let (node, script) = match resolve(&exe) {
        Ok(found) => found,
        Err(why) => {
            eprintln!("mostra: {why}");
            return EXIT_NO_BUNDLE;
        }
    };
    sys::outlive_console_interrupts();
    let mut all = vec![script.into_os_string()];
    all.extend(arguments.iter().cloned());
    let line = command_line(node.as_os_str(), &all);
    let started = (|| {
        let user = sys::current_user()?.to_sddl()?;
        let job = Job::create_for_launcher(&acl::owner_only_object(&user)?)?;
        let child = sys::create_suspended_in_console(
            node.as_os_str(),
            &line,
            sys::standard_handles(),
            &job,
        )?;
        child.resume()?;
        Ok::<_, std::io::Error>((job, child))
    })();
    let (job, child) = match started {
        Ok(started) => started,
        Err(error) => {
            eprintln!("mostra: {} couldn't be started: {error}", node.display());
            return EXIT_CANNOT_RUN;
        }
    };
    let code = sys::wait_exit(&child.process).unwrap_or(1);
    drop(job);
    code.cast_signed()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_launchers_name_picks_its_entry() {
        assert_eq!(entry_for("mostra"), Some("cli"));
        assert_eq!(entry_for("MOSTRA-RUNTIME"), Some("runtime"));
        assert_eq!(entry_for("mostra-setup"), Some("setup"));
        assert_eq!(entry_for("mostra-win"), None);
    }

    #[test]
    fn runs_nothing_outside_the_bundle() {
        let root = Path::new(r"C:\b");
        assert_eq!(
            inside(root, "node/node.exe"),
            Some(PathBuf::from(r"C:\b\node\node.exe"))
        );
        for bad in [
            "",
            "../x",
            "a/../../x",
            r"C:\x",
            "/x",
            "a\\b",
            "a//b",
            "./a",
        ] {
            assert_eq!(inside(root, bad), None, "{bad}");
        }
    }
}
