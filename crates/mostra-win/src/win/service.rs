//! The home's login service on Windows (RT-08, RT-11, D151): what Task Scheduler runs at the
//! user's logon. Task Scheduler starts its action in the user's desktop session, and Node.js is a
//! console program that would open a console window there, so the action is this launcher
//! (`mostra-win-service`, a program with no console), which runs the daemon without a window and
//! keeps it running as launchd's `KeepAlive` and systemd's `Restart=on-failure` do:
//!
//! - the daemon's standard output and error are appended to the service's log;
//! - an exit with code 0 (`mostra daemon stop`, another daemon owning the home) ends the launcher;
//!   any other exit starts the daemon again after [`RESTART_DELAY_MS`], as often as it takes
//!   (Task Scheduler's own restart setting didn't restart an action that exited 1, `VERIFIED_FACTS`
//!   WP-W2);
//! - the daemon and everything it starts run in a kill-on-close job the launcher holds, so ending
//!   the task (`schtasks /End`, a logoff) ends them all;
//! - the named event `--stop-event` (which `mostra-win service-stop` signals) stops it cleanly: the
//!   daemon gets Ctrl+Break, on which the runtime stops as it does on `mostra/shutdown` (D87), and
//!   after [`STOP_GRACE_MS`] the job ends whatever is left.

use std::ffi::OsString;
use std::time::{SystemTime, UNIX_EPOCH};

use super::acl;
use super::gate::command_line;
use super::sys::{self, Handle, Job, NamedEvent};

/// How long after an unexpected exit the daemon starts again (launchd's `ThrottleInterval`,
/// systemd's `RestartSec`).
pub const RESTART_DELAY_MS: u32 = 10_000;

/// How long a stopping daemon gets after Ctrl+Break before its job ends it.
pub const STOP_GRACE_MS: u32 = 15_000;

/// What the launcher runs.
pub struct Options {
    /// The event that asks it to stop: `Local\mostra-service-<home hash>`.
    pub stop_event: String,
    /// The log the daemon's output and the launcher's own lines go to.
    pub log: OsString,
    /// Variables the daemon gets besides the user's logon environment (`--env NAME=VALUE`).
    pub env: Vec<(String, OsString)>,
    /// The daemon's program (the bundle's `node.exe`) and arguments.
    pub program: OsString,
    /// The daemon's arguments.
    pub arguments: Vec<OsString>,
}

/// `YYYY-MM-DDTHH:MM:SS.mmmZ` for `millis` since the Unix epoch (the runtime's log format).
pub fn rfc3339(millis: u128) -> String {
    let seconds = u64::try_from(millis / 1000).unwrap_or(0);
    let days = i64::try_from(seconds / 86_400).unwrap_or(0);
    let rest = seconds % 86_400;
    // Howard Hinnant's civil-from-days.
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}.{:03}Z",
        rest / 3600,
        rest % 3600 / 60,
        rest % 60,
        millis % 1000
    )
}

fn now_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_millis())
}

/// Appends one line in the runtime's log format: `{"at","level","pid","event",…}`.
fn note(log: &Handle, level: &str, event: &str, fields: &serde_json::Value) {
    let mut line = serde_json::json!({
        "at": rfc3339(now_millis()),
        "level": level,
        "pid": std::process::id(),
        "event": event,
    });
    if let (Some(line), Some(fields)) = (line.as_object_mut(), fields.as_object()) {
        for (key, value) in fields {
            line.insert(key.clone(), value.clone());
        }
    }
    let mut text = line.to_string();
    text.push('\n');
    let _ = sys::write_all(log, text.as_bytes());
}

/// How one run of the daemon ended.
enum Ended {
    /// It exited with this code.
    Exited(u32),
    /// The stop event was signalled; it was stopped.
    Stopped,
}

/// Runs the daemon once, until it exits or the stop event is signalled.
fn run_once(
    options: &Options,
    log: &Handle,
    stop: &NamedEvent,
    user: &str,
) -> std::io::Result<Ended> {
    let null = sys::open_null()?;
    let job = Job::create_unnamed(&acl::owner_only_object(user)?)?;
    let line = command_line(&options.program, &options.arguments);
    let child = sys::create_suspended_with(
        &options.program,
        &line,
        [null.borrow(), log.borrow(), log.borrow()],
        &[],
        &[null.borrow(), log.borrow()],
        &job,
        true,
    )?;
    child.resume()?;
    note(
        log,
        "info",
        "service.daemon_started",
        &serde_json::json!({ "daemon": child.pid }),
    );
    let process = child.process.borrow();
    if sys::wait_any(&[process, stop.borrow()], None)? == Some(0) {
        Ok(Ended::Exited(sys::exit_code(&child.process)?))
    } else {
        // Ctrl+Break, as at a console: the runtime stops cleanly (D87).
        if let Err(error) = sys::send_ctrl_break(child.pid) {
            note(
                log,
                "warn",
                "service.stop_signal_failed",
                &serde_json::json!({ "error": error.to_string() }),
            );
        }
        if sys::wait_any(&[process], Some(STOP_GRACE_MS))?.is_none() {
            note(
                log,
                "warn",
                "service.stop_forced",
                &serde_json::json!({ "graceMs": STOP_GRACE_MS }),
            );
            job.terminate(1)?;
            let _ = sys::wait_any(&[process], Some(5000));
        }
        Ok(Ended::Stopped)
    }
}

/// Runs the launcher; returns its exit code.
pub fn run(options: &Options) -> i32 {
    let Ok(log) = sys::open_append(&options.log) else {
        return 1;
    };
    let fail = |error: &std::io::Error| -> i32 {
        note(
            &log,
            "error",
            "service.failed",
            &serde_json::json!({ "error": error.to_string() }),
        );
        1
    };
    let user = match sys::current_user().and_then(|sid| sid.to_sddl()) {
        Ok(user) => user,
        Err(error) => return fail(&error),
    };
    let stop = match acl::owner_only_object(&user)
        .and_then(|descriptor| NamedEvent::create(&options.stop_event, &descriptor))
    {
        Ok(Some(stop)) => stop,
        Ok(None) => {
            // Task Scheduler runs one instance at a time; this is a second launcher started by
            // hand, and the first one keeps the daemon running.
            note(
                &log,
                "info",
                "service.already_running",
                &serde_json::json!({}),
            );
            return 0;
        }
        Err(error) => return fail(&error),
    };
    for (name, value) in &options.env {
        if let Err(error) = sys::set_environment_variable(name, value) {
            return fail(&error);
        }
    }
    note(&log, "info", "service.started", &serde_json::json!({}));
    loop {
        match run_once(options, &log, &stop, &user) {
            Ok(Ended::Stopped) => {
                note(&log, "info", "service.stopped", &serde_json::json!({}));
                return 0;
            }
            Ok(Ended::Exited(0)) => {
                note(
                    &log,
                    "info",
                    "service.daemon_exited",
                    &serde_json::json!({ "code": 0 }),
                );
                return 0;
            }
            Ok(Ended::Exited(code)) => {
                note(
                    &log,
                    "warn",
                    "service.daemon_exited",
                    &serde_json::json!({ "code": code, "restartInMs": RESTART_DELAY_MS }),
                );
            }
            Err(error) => {
                note(
                    &log,
                    "error",
                    "service.daemon_start_failed",
                    &serde_json::json!({ "error": error.to_string(), "restartInMs": RESTART_DELAY_MS }),
                );
            }
        }
        match sys::wait_any(&[stop.borrow()], Some(RESTART_DELAY_MS)) {
            Ok(None) => {}
            Ok(Some(_)) => {
                note(&log, "info", "service.stopped", &serde_json::json!({}));
                return 0;
            }
            Err(error) => return fail(&error),
        }
    }
}

/// Signals the stop event `name` and waits up to `timeout_ms` for the launcher to exit (its event
/// disappears with its last handle). `(signalled, stopped)`: `(false, true)` when none runs.
pub fn stop(name: &str, timeout_ms: u64) -> std::io::Result<(bool, bool)> {
    let Some(event) = NamedEvent::open(name)? else {
        return Ok((false, true));
    };
    event.set()?;
    drop(event);
    let deadline = std::time::Instant::now() + std::time::Duration::from_millis(timeout_ms);
    while std::time::Instant::now() < deadline {
        if NamedEvent::open(name)?.is_none() {
            return Ok((true, true));
        }
        std::thread::sleep(std::time::Duration::from_millis(100));
    }
    Ok((true, false))
}

/// Parses `--stop-event <name> --log <path> [--env NAME=VALUE]… -- <program> <args>…`.
pub fn parse(arguments: &[OsString]) -> Option<Options> {
    let mut stop_event = None;
    let mut log = None;
    let mut env = Vec::new();
    let mut rest = arguments.iter();
    while let Some(argument) = rest.next() {
        match argument.to_str() {
            Some("--stop-event") => {
                stop_event = rest
                    .next()
                    .and_then(|value| value.to_str())
                    .map(str::to_owned);
            }
            Some("--log") => log = rest.next().cloned(),
            Some("--env") => {
                let pair = rest.next()?.to_str()?;
                let (name, value) = pair.split_once('=')?;
                if name.is_empty() {
                    return None;
                }
                env.push((name.to_owned(), OsString::from(value)));
            }
            Some("--") => {
                let program = rest.next()?.clone();
                let arguments: Vec<OsString> = rest.cloned().collect();
                return Some(Options {
                    stop_event: stop_event?,
                    log: log?,
                    env,
                    program,
                    arguments,
                });
            }
            _ => return None,
        }
    }
    None
}
