//! The gate every child starts behind on Windows (issue #7, D93, RT-09 and RT-10). It is the
//! Windows form of the `/bin/sh` gate: the child is created suspended in a Job Object of its own,
//! its PID and creation time are reported on descriptor 3, and it runs only once the supervisor,
//! having recorded it, writes `go`. Descriptor 3 then stays open as the child's lifeline: when it
//! closes (the supervisor stopped the child, exited or was killed), the gate ends the job, so the
//! child and every process it started end at once. The job ends with its last handle too (the
//! gate's), so killing the gate is as good as ending the job. A Windows process group is not a
//! thing that can be signalled; the job is what plays its part (ARCHITECTURE §4).
//!
//! The supervisor starts `mostra-win gate -- <program> <args…>` with its child's standard handles
//! and extra descriptors (the IPC channel, a worker's channel); the gate passes them on in the
//! C runtime's descriptor table, without descriptor 3, so a Node.js child finds its channel where
//! `NODE_CHANNEL_FD` says. The gate's exit code is the child's.

use std::ffi::{OsStr, OsString};
use std::io;
use std::os::windows::ffi::{OsStrExt, OsStringExt};
use std::path::Path;
use std::sync::Arc;
use std::thread;

use windows_sys::Win32::Foundation::{
    ERROR_FILE_NOT_FOUND, ERROR_PATH_NOT_FOUND, INVALID_HANDLE_VALUE,
};

use super::acl;
use super::sys::{self, CrtEntry, Job, RawHandle};

/// The gate's own exit codes, as the POSIX gate and shells use them.
const EXIT_NOT_RELEASED: i32 = 125;
const EXIT_CANNOT_RUN: i32 = 126;
const EXIT_NOT_FOUND: i32 = 127;

/// The name of the job of the child created at `created` with `pid`: the reaper opens it by the
/// child's recorded identity (`FAILURE_MODEL` §2), and no other process has both.
pub fn job_name(pid: u32, created: u64) -> String {
    format!("Local\\mostra-job-{pid}-{created}")
}

/// Appends `argument` to a command line, quoted as the Microsoft C runtime parses it.
pub fn push_argument(line: &mut Vec<u16>, argument: &OsStr) {
    let text: Vec<u16> = argument.encode_wide().collect();
    let plain = !text.is_empty()
        && !text.iter().any(|&c| {
            c == u16::from(b' ')
                || c == u16::from(b'\t')
                || c == u16::from(b'\n')
                || c == 0x0b
                || c == u16::from(b'"')
        });
    if !line.is_empty() {
        line.push(u16::from(b' '));
    }
    if plain {
        line.extend(text);
        return;
    }
    line.push(u16::from(b'"'));
    let mut backslashes = 0usize;
    for c in text {
        if c == u16::from(b'\\') {
            backslashes += 1;
            continue;
        }
        if c == u16::from(b'"') {
            line.extend(std::iter::repeat_n(u16::from(b'\\'), backslashes * 2 + 1));
        } else {
            line.extend(std::iter::repeat_n(u16::from(b'\\'), backslashes));
        }
        backslashes = 0;
        line.push(c);
    }
    line.extend(std::iter::repeat_n(u16::from(b'\\'), backslashes * 2));
    line.push(u16::from(b'"'));
}

/// The full command line of `program` with `arguments`.
pub fn command_line(program: &OsStr, arguments: &[OsString]) -> OsString {
    let mut line = Vec::new();
    push_argument(&mut line, program);
    for argument in arguments {
        push_argument(&mut line, argument);
    }
    OsString::from_wide(&line)
}

fn report(lifeline: RawHandle, line: &serde_json::Value) {
    let mut text = line.to_string();
    text.push('\n');
    let _ = sys::pipe_write_all(lifeline, text.as_bytes());
}

/// Reads the lifeline until a full line arrives; `None` when it closed first.
fn read_line(lifeline: RawHandle) -> Option<String> {
    let mut bytes = Vec::new();
    let mut buffer = [0u8; 64];
    loop {
        match sys::pipe_read(lifeline, &mut buffer) {
            Ok(0) | Err(_) => return None,
            Ok(read) => {
                bytes.extend_from_slice(&buffer[..read]);
                if let Some(end) = bytes.iter().position(|&b| b == b'\n') {
                    return Some(String::from_utf8_lossy(&bytes[..end]).trim().to_owned());
                }
                if bytes.len() > 4096 {
                    return None;
                }
            }
        }
    }
}

/// Runs the gate for `program` and `arguments`; returns the exit code.
pub fn run(program: &OsStr, arguments: &[OsString]) -> i32 {
    let (table, standard) = sys::inherited_descriptors();
    let Some(lifeline) = table
        .get(3)
        .filter(|entry| entry.flags != 0 && !entry.handle.is_invalid())
        .map(|e| e.handle)
    else {
        eprintln!("mostra-win gate: descriptor 3 (the gate pipe) is missing");
        return EXIT_CANNOT_RUN;
    };
    // The lifeline is the gate's alone; the child must never hold it open.
    let _ = lifeline.set_inheritable(false);
    if !Path::new(program).is_absolute() {
        report(
            lifeline,
            &serde_json::json!({ "error": "the program must be an absolute path" }),
        );
        return EXIT_CANNOT_RUN;
    }

    let mut child_table: Vec<CrtEntry> = table.clone();
    if let Some(entry) = child_table.get_mut(3) {
        *entry = CrtEntry {
            flags: 0,
            handle: RawHandle(INVALID_HANDLE_VALUE),
        };
    }
    let mut inherit: Vec<RawHandle> = standard.to_vec();
    inherit.extend(
        child_table
            .iter()
            .filter(|entry| entry.flags != 0 && !entry.handle.is_invalid())
            .map(|entry| entry.handle),
    );

    let line = command_line(program, arguments);
    let suspended = match sys::create_suspended(program, &line, standard, &child_table, &inherit) {
        Ok(suspended) => suspended,
        Err(error) => {
            report(
                lifeline,
                &serde_json::json!({ "error": error.to_string(), "os": error.raw_os_error() }),
            );
            let missing = sys::is_error(&error, ERROR_FILE_NOT_FOUND)
                || sys::is_error(&error, ERROR_PATH_NOT_FOUND);
            return if missing {
                EXIT_NOT_FOUND
            } else {
                EXIT_CANNOT_RUN
            };
        }
    };
    let started = (|| -> io::Result<(u64, String, Job)> {
        let created = sys::creation_time(&suspended.process)?;
        let name = job_name(suspended.pid, created);
        let user = sys::current_user()?.to_sddl()?;
        let job = Job::create(&name, &acl::owner_only_object(&user)?)?;
        job.assign(&suspended.process)?;
        Ok((created, name, job))
    })();
    let (created, name, job) = match started {
        Ok(started) => started,
        Err(error) => {
            let _ = sys::terminate_if(
                suspended.pid,
                sys::creation_time(&suspended.process).unwrap_or(0),
            );
            report(
                lifeline,
                &serde_json::json!({ "error": error.to_string(), "os": error.raw_os_error() }),
            );
            return EXIT_CANNOT_RUN;
        }
    };
    let job = Arc::new(job);
    report(
        lifeline,
        &serde_json::json!({ "pid": suspended.pid, "startTime": format!("win/{created}"), "job": name }),
    );
    if read_line(lifeline).as_deref() != Some("go") {
        // The supervisor died, or stopped the child, before recording it: it never runs.
        let _ = job.terminate(EXIT_NOT_RELEASED.cast_unsigned());
        return EXIT_NOT_RELEASED;
    }
    if let Err(error) = suspended.resume() {
        let _ = job.terminate(1);
        eprintln!("mostra-win gate: couldn't start the child: {error}");
        return EXIT_CANNOT_RUN;
    }
    // The child holds its own copies now; ours would keep its pipes open after it exits.
    let mut closed: Vec<RawHandle> = Vec::new();
    for handle in inherit {
        if !handle.is_invalid() && !closed.contains(&handle) {
            handle.close();
            closed.push(handle);
        }
    }

    watch_lifeline(lifeline, Arc::clone(&job));

    let code = sys::wait_exit(&suspended.process).unwrap_or(1);
    // The child is gone; whatever it started goes with it, as a group ends with its leader.
    let _ = job.terminate(code);
    code.cast_signed()
}

/// Ends the job when the lifeline closes: the supervisor stopped the child, exited or was killed.
fn watch_lifeline(lifeline: RawHandle, job: Arc<Job>) {
    // A test fault (MOSTRA_TEST_GATE=ignore-lifeline): a gate that no longer watches its lifeline,
    // as a gate that hangs would, so the reaper's own path is what ends the child after a
    // supervisor crash (FAILURE_MODEL §2). Never set outside the runtime's tests.
    let watch = std::env::var_os("MOSTRA_TEST_GATE").is_none_or(|value| value != "ignore-lifeline");
    thread::spawn(move || {
        if !watch {
            return;
        }
        let mut buffer = [0u8; 64];
        while let Ok(read) = sys::pipe_read(lifeline, &mut buffer) {
            if read == 0 {
                break;
            }
        }
        // The lifeline closed: end the child and everything it started.
        let _ = job.terminate(1);
    });
}
