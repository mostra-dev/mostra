//! What the crate does on Windows that the standard library and tokio can't (WP-W3, D153): the
//! owner of the home's control pipe, whether a process still runs, and the free space of a disk.
//! The only module with `unsafe`; each call checks its result and frees what it allocates.
#![allow(unsafe_code)]

use std::ffi::c_void;
use std::io;
use std::os::windows::ffi::OsStrExt;
use std::os::windows::io::RawHandle;
use std::path::Path;
use std::ptr::null_mut;

use windows_sys::Win32::Foundation::{
    CloseHandle, ERROR_ACCESS_DENIED, GetLastError, HANDLE, LocalFree, STILL_ACTIVE,
};
use windows_sys::Win32::Security::Authorization::{GetSecurityInfo, SE_KERNEL_OBJECT};
use windows_sys::Win32::Security::{
    EqualSid, GetTokenInformation, OWNER_SECURITY_INFORMATION, PSECURITY_DESCRIPTOR, PSID,
    TOKEN_QUERY, TOKEN_USER, TokenUser,
};
use windows_sys::Win32::Storage::FileSystem::{
    BY_HANDLE_FILE_INFORMATION, GetDiskFreeSpaceExW, GetFileInformationByHandle,
};
use windows_sys::Win32::System::Threading::{
    GetCurrentProcess, GetExitCodeProcess, OpenProcess, OpenProcessToken,
    PROCESS_QUERY_LIMITED_INFORMATION,
};

/// A handle this module opened, closed on drop.
struct Owned(HANDLE);

impl Drop for Owned {
    fn drop(&mut self) {
        // SAFETY: a handle this module opened and still owns.
        unsafe { CloseHandle(self.0) };
    }
}

/// This process's user, as the bytes of its `TOKEN_USER` (the SID lives inside them).
fn current_user() -> io::Result<Vec<u64>> {
    let mut token: HANDLE = null_mut();
    // SAFETY: the current process's pseudo handle; `token` receives an owned handle.
    if unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &raw mut token) } == 0 {
        return Err(io::Error::last_os_error());
    }
    let token = Owned(token);
    let mut size = 0u32;
    // SAFETY: a size query, which fails and sets `size`.
    unsafe { GetTokenInformation(token.0, TokenUser, null_mut(), 0, &raw mut size) };
    // u64s, so the buffer is aligned for TOKEN_USER and the SID it points into.
    let mut buffer = vec![0u64; (size as usize).div_ceil(8).max(1)];
    // SAFETY: a buffer of at least `size` bytes.
    let filled = unsafe {
        GetTokenInformation(
            token.0,
            TokenUser,
            buffer.as_mut_ptr().cast::<c_void>(),
            u32::try_from(buffer.len() * 8).unwrap_or(u32::MAX),
            &raw mut size,
        )
    };
    if filled == 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(buffer)
}

/// Whether the kernel object `handle` names (the home's pipe) is owned by this process's user.
/// The runtime's helper creates the pipe with the user as its owner, so nothing else passes: a
/// pipe another user created under a name `instance.json` once named is refused (D150 item 4).
pub(crate) fn owned_by_current_user(handle: RawHandle) -> io::Result<bool> {
    let mut owner: PSID = null_mut();
    let mut descriptor: PSECURITY_DESCRIPTOR = null_mut();
    // SAFETY: a valid handle opened with read access (READ_CONTROL); `owner` points into
    // `descriptor`, which is freed below.
    let status = unsafe {
        GetSecurityInfo(
            handle as HANDLE,
            SE_KERNEL_OBJECT,
            OWNER_SECURITY_INFORMATION,
            &raw mut owner,
            null_mut(),
            null_mut(),
            null_mut(),
            &raw mut descriptor,
        )
    };
    if status != 0 {
        return Err(io::Error::from_raw_os_error(
            i32::try_from(status).unwrap_or(-1),
        ));
    }
    let user = current_user();
    let equal = user.map(|buffer| {
        // SAFETY: the buffer holds a TOKEN_USER that GetTokenInformation filled.
        let token_user = unsafe { &*buffer.as_ptr().cast::<TOKEN_USER>() };
        // SAFETY: two valid SIDs: the pipe's owner and the user's.
        unsafe { EqualSid(owner, token_user.User.Sid) != 0 }
    });
    // SAFETY: the descriptor GetSecurityInfo allocated.
    unsafe { LocalFree(descriptor.cast()) };
    equal
}

/// Whether the process `pid` still runs (one that can't be opened for another user's sake runs).
pub(crate) fn process_alive(pid: u32) -> bool {
    // SAFETY: plain call; the handle, when there is one, is owned below.
    let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
    if handle.is_null() {
        // SAFETY: read right after the call it reports on.
        return unsafe { GetLastError() } == ERROR_ACCESS_DENIED;
    }
    let handle = Owned(handle);
    let mut code = 0u32;
    // SAFETY: a valid process handle with query rights.
    let read = unsafe { GetExitCodeProcess(handle.0, &raw mut code) };
    read == 0 || code == STILL_ACTIVE.cast_unsigned()
}

/// Which file `file` is: its volume's serial number and its 64-bit file index, as
/// `GetFileInformationByHandle` reports them (POSIX's device and inode).
pub(crate) fn file_id(file: &std::fs::File) -> Option<(u64, u64)> {
    use std::os::windows::io::AsRawHandle;
    // SAFETY: plain data, filled by the call below.
    let mut info: BY_HANDLE_FILE_INFORMATION = unsafe { std::mem::zeroed() };
    // SAFETY: an open file's handle, borrowed for the call; `info` is a valid output.
    let ok = unsafe { GetFileInformationByHandle(file.as_raw_handle() as HANDLE, &raw mut info) };
    (ok != 0).then(|| {
        (
            u64::from(info.dwVolumeSerialNumber),
            (u64::from(info.nFileIndexHigh) << 32) | u64::from(info.nFileIndexLow),
        )
    })
}

/// The bytes free to this user on `path`'s disk.
pub(crate) fn free_space(path: &Path) -> Option<u64> {
    let wide: Vec<u16> = path.as_os_str().encode_wide().chain([0]).collect();
    let mut free = 0u64;
    // SAFETY: a null-terminated path; one output, the others not asked for.
    let ok = unsafe { GetDiskFreeSpaceExW(wide.as_ptr(), &raw mut free, null_mut(), null_mut()) };
    (ok != 0).then_some(free)
}
