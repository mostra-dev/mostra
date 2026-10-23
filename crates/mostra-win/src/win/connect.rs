//! A client's connection to the home's control pipe on Windows, for clients that can't check the
//! pipe themselves (Node.js can't): `mostra-win connect <pipe>` opens the pipe, refuses it unless
//! its owner is this user (another user may create a pipe of a name no instance serves right now,
//! such as an old one `instance.json` still names), and only then relays its standard input to the
//! pipe and the pipe to its standard output. The server is never allowed to act as this process.
//!
//! On standard error it writes one JSON line before any byte is relayed: `{"connected":true}`, or
//! `{"error":…,"code":…}` and exits 2 (no such pipe, busy) or 3 (another user's pipe).

use std::io::{Read, Write};
use std::thread;

use super::sys::{self, RawHandle};

/// Exit code: the pipe can't be reached.
const EXIT_UNREACHABLE: i32 = 2;
/// Exit code: the pipe belongs to someone else.
const EXIT_NOT_OWNED: i32 = 3;

fn tell(line: &serde_json::Value) {
    let mut err = std::io::stderr().lock();
    let _ = writeln!(err, "{line}");
    let _ = err.flush();
}

/// Connects to `\\.\pipe\<name>`, checks its owner, relays; returns the exit code.
pub fn run(name: &str) -> i32 {
    let full = format!(r"\\.\pipe\{name}");
    let pipe = match sys::open_pipe_client(&full) {
        Ok(pipe) => pipe,
        Err(error) => {
            tell(&serde_json::json!({ "error": error.to_string(), "code": "unreachable" }));
            return EXIT_UNREACHABLE;
        }
    };
    let owned = (|| -> std::io::Result<bool> {
        let owner = sys::object_owner(&pipe)?;
        Ok(owner.equals(&sys::current_user()?) || owner.equals(&sys::default_owner()?))
    })();
    match owned {
        Ok(true) => {}
        Ok(false) => {
            tell(&serde_json::json!({
                "error": "the pipe belongs to another user",
                "code": "not-owned",
            }));
            return EXIT_NOT_OWNED;
        }
        Err(error) => {
            tell(&serde_json::json!({ "error": error.to_string(), "code": "not-owned" }));
            return EXIT_NOT_OWNED;
        }
    }
    tell(&serde_json::json!({ "connected": true }));

    let raw = RawHandle(pipe.raw());
    // Standard input to the pipe, until it ends.
    let writer = thread::spawn(move || {
        let mut input = std::io::stdin().lock();
        let mut buffer = vec![0u8; 65_536];
        loop {
            match input.read(&mut buffer) {
                Ok(0) | Err(_) => break,
                Ok(read) => {
                    if sys::pipe_write_all(raw, &buffer[..read]).is_err() {
                        break;
                    }
                }
            }
        }
        // The client is done: the server sees the connection end once this process exits.
        std::process::exit(0);
    });
    // The pipe to standard output, until the server closes it.
    let mut output = std::io::stdout().lock();
    let mut buffer = vec![0u8; 65_536];
    while let Ok(read) = sys::pipe_read(raw, &mut buffer) {
        if read == 0
            || output
                .write_all(&buffer[..read])
                .and_then(|()| output.flush())
                .is_err()
        {
            break;
        }
    }
    drop(writer);
    drop(pipe);
    0
}
