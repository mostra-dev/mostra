//! The home's control pipe on Windows (D81, D82, RT-06, RT-10): a named pipe that only the user
//! (and `SYSTEM`) can open, that refuses remote clients, and whose first instance this process
//! must create, so no other program's pipe is ever served under its name. Node.js creates its own
//! pipes with the system's default access (everyone may open them to read) and without refusing
//! remote clients, so the helper owns the pipe and forwards each connection to the supervisor over
//! descriptor 4 (an overlapped pipe only the two processes hold), in frames:
//!
//! ```text
//! [connection: u32 LE][kind: u8][length: u32 LE][payload]
//! kind 1 OPEN  helper → supervisor   a client connected
//! kind 2 DATA  both ways             bytes of that connection
//! kind 3 CLOSE both ways             that connection ended (or end it)
//! kind 4 READY helper → supervisor   the pipe exists; payload: its full name (connection 0)
//! kind 5 FATAL helper → supervisor   the pipe can't be served; payload: why (connection 0)
//! ```
//!
//! When descriptor 4 closes (the supervisor stopped the pipe, exited or was killed), the helper
//! exits and the pipe disappears with it.

use std::collections::HashMap;
use std::io;
use std::sync::mpsc::{Receiver, Sender, channel};
use std::sync::{Arc, Mutex};
use std::thread;

use super::acl;
use super::sys::{self, Handle, RawHandle, SecurityDescriptor};

/// A client connected.
pub const OPEN: u8 = 1;
/// Bytes of a connection.
pub const DATA: u8 = 2;
/// A connection ended, or is to be ended.
pub const CLOSE: u8 = 3;
/// The pipe exists.
pub const READY: u8 = 4;
/// The pipe can't be served.
pub const FATAL: u8 = 5;

/// One frame's bytes.
pub fn frame(connection: u32, kind: u8, payload: &[u8]) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(9 + payload.len());
    bytes.extend_from_slice(&connection.to_le_bytes());
    bytes.push(kind);
    bytes.extend_from_slice(
        &u32::try_from(payload.len())
            .unwrap_or(u32::MAX)
            .to_le_bytes(),
    );
    bytes.extend_from_slice(payload);
    bytes
}

fn read_exact(handle: RawHandle, mut buffer: &mut [u8]) -> io::Result<bool> {
    while !buffer.is_empty() {
        let read = sys::pipe_read(handle, buffer)?;
        if read == 0 {
            return Ok(false);
        }
        buffer = &mut buffer[read..];
    }
    Ok(true)
}

type Connections = Arc<Mutex<HashMap<u32, Sender<Vec<u8>>>>>;

/// Serves `\\.\pipe\<name>` until descriptor 4 closes; returns the exit code.
pub fn run(name: &str) -> i32 {
    let (table, _) = sys::inherited_descriptors();
    let Some(channel_handle) = table
        .get(4)
        .filter(|entry| entry.flags != 0 && !entry.handle.is_invalid())
        .map(|e| e.handle)
    else {
        eprintln!("mostra-win pipe: descriptor 4 (the supervisor's channel) is missing");
        return 2;
    };
    let (out, outgoing) = channel::<Vec<u8>>();
    let writer = thread::spawn(move || {
        for bytes in outgoing {
            if sys::pipe_write_all(channel_handle, &bytes).is_err() {
                std::process::exit(0);
            }
        }
    });

    let full = format!(r"\\.\pipe\{name}");
    let prepared = (|| -> io::Result<(SecurityDescriptor, Handle)> {
        let user = sys::current_user()?.to_sddl()?;
        let descriptor = acl::owner_only_object(&user)?;
        let first = sys::create_pipe_instance(&full, true, &descriptor)?;
        Ok((descriptor, first))
    })();
    let (descriptor, first) = match prepared {
        Ok(prepared) => prepared,
        Err(error) => {
            let _ = out.send(frame(0, FATAL, error.to_string().as_bytes()));
            drop(out);
            let _ = writer.join();
            return 1;
        }
    };
    let _ = out.send(frame(0, READY, full.as_bytes()));

    let connections: Connections = Arc::new(Mutex::new(HashMap::new()));
    {
        let out = out.clone();
        let connections = Arc::clone(&connections);
        thread::spawn(move || accept(&full, &descriptor, first, &out, &connections));
    }

    // Frames from the supervisor.
    let mut header = [0u8; 9];
    loop {
        match read_exact(channel_handle, &mut header) {
            Ok(true) => {}
            _ => std::process::exit(0),
        }
        let connection = u32::from_le_bytes([header[0], header[1], header[2], header[3]]);
        let kind = header[4];
        let length = u32::from_le_bytes([header[5], header[6], header[7], header[8]]) as usize;
        let mut payload = vec![0u8; length];
        if !matches!(read_exact(channel_handle, &mut payload), Ok(true)) {
            std::process::exit(0);
        }
        let mut map = connections
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        match kind {
            DATA => {
                if map
                    .get(&connection)
                    .is_some_and(|sender| sender.send(payload).is_err())
                {
                    map.remove(&connection);
                }
            }
            CLOSE => {
                // Dropping the sender ends the connection's writer, which flushes and disconnects.
                map.remove(&connection);
            }
            _ => {}
        }
    }
}

fn accept(
    full: &str,
    descriptor: &SecurityDescriptor,
    first: Handle,
    out: &Sender<Vec<u8>>,
    connections: &Connections,
) {
    let mut instance = first;
    let mut next_id = 0u32;
    loop {
        if sys::pipe_accept(&instance).is_err() {
            // A client that left before the connection completed: serve the name again.
            match sys::create_pipe_instance(full, false, descriptor) {
                Ok(fresh) => {
                    instance = fresh;
                    continue;
                }
                Err(error) => {
                    let _ = out.send(frame(0, FATAL, error.to_string().as_bytes()));
                    return;
                }
            }
        }
        // The next client finds an instance waiting while this one is handed over.
        let fresh = match sys::create_pipe_instance(full, false, descriptor) {
            Ok(fresh) => fresh,
            Err(error) => {
                let _ = out.send(frame(0, FATAL, error.to_string().as_bytes()));
                return;
            }
        };
        let connected = std::mem::replace(&mut instance, fresh);
        next_id = next_id.wrapping_add(1).max(1);
        serve(next_id, connected, out, connections);
    }
}

fn serve(id: u32, pipe: Handle, out: &Sender<Vec<u8>>, connections: &Connections) {
    let pipe = Arc::new(pipe);
    let (sender, receiver): (Sender<Vec<u8>>, Receiver<Vec<u8>>) = channel();
    connections
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .insert(id, sender);
    let _ = out.send(frame(id, OPEN, &[]));

    let writing = Arc::clone(&pipe);
    thread::spawn(move || {
        for bytes in receiver {
            if sys::pipe_write_all(writing.borrow(), &bytes).is_err() {
                break;
            }
        }
        sys::pipe_close(&writing);
    });

    let reading = Arc::clone(&pipe);
    let out = out.clone();
    let connections = Arc::clone(connections);
    thread::spawn(move || {
        let mut buffer = vec![0u8; 65_536];
        loop {
            match sys::pipe_read(reading.borrow(), &mut buffer) {
                Ok(0) | Err(_) => break,
                Ok(read) => {
                    if out.send(frame(id, DATA, &buffer[..read])).is_err() {
                        break;
                    }
                }
            }
        }
        connections
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .remove(&id);
        let _ = out.send(frame(id, CLOSE, &[]));
    });
}
