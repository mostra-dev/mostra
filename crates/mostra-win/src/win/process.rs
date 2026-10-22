//! Process identity on Windows (`DATA_MODEL` §3 `child.start_time`, `FAILURE_MODEL` §2): a process is
//! its PID and its creation time (`GetProcessTimes`, 100 ns units since 1601), written
//! `win/<creation time>`. Windows reuses PIDs soon after a process ends, but never while the
//! process object lives, and two processes never share both values. The creation time is
//! absolute, so it also tells processes of different boots apart.

use serde_json::{Value, json};

use super::gate::job_name;
use super::sys::{self, Job, Liveness};

/// The `startTime` of a process created at `created`.
pub fn start_time(created: u64) -> String {
    format!("win/{created}")
}

/// Reads a `startTime` back.
pub fn parse_start_time(text: &str) -> Option<u64> {
    text.strip_prefix("win/")?.parse().ok()
}

/// One process's identity, as `identity` and `processes` report it.
fn describe(pid: u32, parent: Option<u32>) -> Value {
    let mut entry = json!({ "pid": pid });
    if let Some(parent) = parent {
        entry["ppid"] = json!(parent);
    }
    match sys::process_liveness(pid) {
        Liveness::Running(created) => entry["startTime"] = json!(start_time(created)),
        Liveness::Gone => entry["gone"] = json!(true),
        Liveness::Hidden => entry["hidden"] = json!(true),
    }
    entry
}

/// `identity <pid>…`: each process's start time, or that it is gone.
pub fn identity(pids: &[u32]) -> Value {
    Value::Array(pids.iter().map(|&pid| describe(pid, None)).collect())
}

/// `processes`: every running process with its parent and start time (none for processes this
/// user can't query).
pub fn processes() -> Result<Value, std::io::Error> {
    let entries = sys::process_snapshot()?;
    Ok(Value::Array(
        entries
            .into_iter()
            .filter(|entry| entry.pid != 0)
            .map(|entry| describe(entry.pid, Some(entry.ppid)))
            .filter(|entry| entry.get("gone").is_none())
            .collect(),
    ))
}

/// `reap <pid>:<startTime>…`: for each recorded child, ends its job (the child and everything it
/// started, even after the child itself exited) when the job still exists, and the child itself
/// when it still runs as the recorded process. A PID another process now holds is left alone.
pub fn reap(targets: &[(u32, String)]) -> Value {
    Value::Array(
        targets
            .iter()
            .map(|(pid, start)| {
                let Some(created) = parse_start_time(start) else {
                    return json!({ "pid": pid, "error": "the start time isn't a Windows start time" });
                };
                let name = job_name(*pid, created);
                let mut ended: Vec<u32> = Vec::new();
                let mut job_found = false;
                match Job::open(&name) {
                    Ok(Some(job)) => {
                        job_found = true;
                        ended = job.process_ids().unwrap_or_default();
                        let _ = job.terminate(1);
                    }
                    Ok(None) => {}
                    Err(error) => return json!({ "pid": pid, "error": error.to_string() }),
                }
                let liveness = sys::process_liveness(*pid);
                if liveness == Liveness::Running(created)
                    && sys::terminate_if(*pid, created).unwrap_or(false)
                    && !ended.contains(pid)
                {
                    ended.push(*pid);
                }
                let reused = matches!(liveness, Liveness::Running(now) if now != created);
                json!({ "pid": pid, "job": job_found, "ended": ended, "reused": reused })
            })
            .collect(),
    )
}
