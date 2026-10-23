//! The only module with `unsafe`: thin wrappers over the Win32 calls the helper makes. Each
//! wrapper checks its call's result and owns what the call returns (handles closed on drop,
//! `LocalAlloc`ed buffers freed), so the rest of the crate is safe Rust.
#![allow(unsafe_code)]

use std::ffi::{OsStr, c_void};
use std::io;
use std::mem::{size_of, size_of_val, zeroed};
use std::os::windows::ffi::OsStrExt;
use std::ptr::{null, null_mut};

use windows_sys::Win32::Foundation::{
    CloseHandle, ERROR_ALREADY_EXISTS, ERROR_BROKEN_PIPE, ERROR_FILE_NOT_FOUND, ERROR_HANDLE_EOF,
    ERROR_INSUFFICIENT_BUFFER, ERROR_INVALID_PARAMETER, ERROR_IO_PENDING, ERROR_MORE_DATA,
    ERROR_NO_DATA, ERROR_PIPE_BUSY, ERROR_PIPE_CONNECTED, ERROR_PIPE_NOT_CONNECTED, FILETIME,
    GENERIC_READ, GENERIC_WRITE, GetLastError, HANDLE, HANDLE_FLAG_INHERIT, INVALID_HANDLE_VALUE,
    LocalFree, STILL_ACTIVE, SetHandleInformation, WAIT_OBJECT_0, WIN32_ERROR,
};
use windows_sys::Win32::Security::Authorization::{
    ConvertSecurityDescriptorToStringSecurityDescriptorW, ConvertSidToStringSidW,
    ConvertStringSecurityDescriptorToSecurityDescriptorW, GetNamedSecurityInfoW, GetSecurityInfo,
    SDDL_REVISION_1, SE_FILE_OBJECT, SE_KERNEL_OBJECT, SetSecurityInfo,
};
use windows_sys::Win32::Security::{
    ACCESS_ALLOWED_ACE, ACE_HEADER, ACL, ACL_SIZE_INFORMATION, AclSizeInformation,
    DACL_SECURITY_INFORMATION, EqualSid, GetAce, GetAclInformation, GetLengthSid,
    GetSecurityDescriptorControl, GetTokenInformation, ImpersonateLoggedOnUser,
    LOGON32_LOGON_INTERACTIVE, LOGON32_LOGON_NETWORK, LOGON32_PROVIDER_DEFAULT, LogonUserW,
    OWNER_SECURITY_INFORMATION, PROTECTED_DACL_SECURITY_INFORMATION, PSECURITY_DESCRIPTOR, PSID,
    RevertToSelf, SE_DACL_PROTECTED, SECURITY_ATTRIBUTES, TOKEN_OWNER, TOKEN_QUERY, TOKEN_USER,
    TokenOwner, TokenUser,
};
use windows_sys::Win32::Storage::FileSystem::{
    CreateDirectoryW, CreateFileW, FILE_FLAG_BACKUP_SEMANTICS, FILE_FLAG_FIRST_PIPE_INSTANCE,
    FILE_FLAG_OPEN_REPARSE_POINT, FILE_FLAG_OVERLAPPED, FILE_LIST_DIRECTORY, FILE_SHARE_DELETE,
    FILE_SHARE_READ, FILE_SHARE_WRITE, FlushFileBuffers, OPEN_EXISTING, PIPE_ACCESS_DUPLEX,
    READ_CONTROL, ReadFile, SECURITY_IDENTIFICATION, SECURITY_SQOS_PRESENT, WRITE_DAC, WRITE_OWNER,
    WriteFile,
};
use windows_sys::Win32::System::Console::SetConsoleCtrlHandler;
use windows_sys::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, PROCESSENTRY32W, Process32FirstW, Process32NextW, TH32CS_SNAPPROCESS,
};
use windows_sys::Win32::System::IO::{GetOverlappedResult, OVERLAPPED};
use windows_sys::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    JOBOBJECT_BASIC_PROCESS_ID_LIST, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
    JobObjectBasicProcessIdList, JobObjectExtendedLimitInformation, OpenJobObjectW,
    QueryInformationJobObject, SetInformationJobObject, TerminateJobObject,
};
use windows_sys::Win32::System::Pipes::{
    ConnectNamedPipe, CreateNamedPipeW, DisconnectNamedPipe, PIPE_READMODE_BYTE,
    PIPE_REJECT_REMOTE_CLIENTS, PIPE_TYPE_BYTE, PIPE_UNLIMITED_INSTANCES, PIPE_WAIT,
};
use windows_sys::Win32::System::Threading::{
    CREATE_NO_WINDOW, CREATE_SUSPENDED, CREATE_UNICODE_ENVIRONMENT, CreateEventW, CreateProcessW,
    DeleteProcThreadAttributeList, EXTENDED_STARTUPINFO_PRESENT, GetCurrentProcess,
    GetExitCodeProcess, GetProcessTimes, GetStartupInfoW, INFINITE,
    InitializeProcThreadAttributeList, LPPROC_THREAD_ATTRIBUTE_LIST, OpenProcess, OpenProcessToken,
    PROC_THREAD_ATTRIBUTE_HANDLE_LIST, PROC_THREAD_ATTRIBUTE_JOB_LIST, PROCESS_INFORMATION,
    PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_TERMINATE, ResumeThread, STARTF_USESTDHANDLES,
    STARTUPINFOEXW, STARTUPINFOW, TerminateProcess, UpdateProcThreadAttribute, WaitForSingleObject,
};

// Constants windows-sys keeps behind features this crate doesn't otherwise need.
const ACCESS_ALLOWED_ACE_TYPE: u8 = 0;
const ACCESS_DENIED_ACE_TYPE: u8 = 1;
const JOB_OBJECT_QUERY: u32 = 0x4;
const JOB_OBJECT_TERMINATE: u32 = 0x8;

/// A null-terminated UTF-16 copy of `text`, for the `W` calls.
pub fn wide(text: &OsStr) -> Vec<u16> {
    text.encode_wide().chain(Some(0)).collect()
}

fn wide_str(text: &str) -> Vec<u16> {
    wide(OsStr::new(text))
}

fn last_error() -> io::Error {
    io::Error::last_os_error()
}

fn check(ok: i32) -> io::Result<()> {
    if ok == 0 { Err(last_error()) } else { Ok(()) }
}

fn win32(code: WIN32_ERROR) -> io::Result<()> {
    if code == 0 {
        Ok(())
    } else {
        #[allow(clippy::cast_possible_wrap)]
        Err(io::Error::from_raw_os_error(code as i32))
    }
}

/// Whether `error` is the Win32 error `code`.
pub fn is_error(error: &io::Error, code: WIN32_ERROR) -> bool {
    #[allow(clippy::cast_possible_wrap)]
    let code = code as i32;
    error.raw_os_error() == Some(code)
}

/// A kernel handle, closed when dropped.
#[derive(Debug)]
pub struct Handle(HANDLE);

// SAFETY: a Win32 kernel handle is a process-wide value; any thread may use or close it.
unsafe impl Send for Handle {}
// SAFETY: as above; the calls this crate makes on shared handles are thread-safe.
unsafe impl Sync for Handle {}

impl Handle {
    fn owned(handle: HANDLE) -> io::Result<Handle> {
        if handle.is_null() || handle == INVALID_HANDLE_VALUE {
            Err(last_error())
        } else {
            Ok(Handle(handle))
        }
    }

    /// The raw value, for calls that borrow it.
    pub fn raw(&self) -> HANDLE {
        self.0
    }

    /// The handle as a borrowed value; valid while `self` lives.
    pub fn borrow(&self) -> RawHandle {
        RawHandle(self.0)
    }
}

impl Drop for Handle {
    fn drop(&mut self) {
        // SAFETY: the handle is owned and closed once.
        unsafe { CloseHandle(self.0) };
    }
}

/// A handle this process inherited and doesn't own the lifetime of beyond its own use, such as a
/// stdio handle from the CRT table. Closing it is explicit.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RawHandle(pub HANDLE);

// SAFETY: as for `Handle`.
unsafe impl Send for RawHandle {}
// SAFETY: as for `Handle`.
unsafe impl Sync for RawHandle {}

impl RawHandle {
    /// Whether it names nothing (null or `INVALID_HANDLE_VALUE`).
    pub fn is_invalid(self) -> bool {
        self.0.is_null() || self.0 == INVALID_HANDLE_VALUE
    }

    /// Closes it.
    pub fn close(self) {
        if !self.is_invalid() {
            // SAFETY: the caller gives up its use of the handle.
            unsafe { CloseHandle(self.0) };
        }
    }

    /// Marks it inheritable or not.
    pub fn set_inheritable(self, inherit: bool) -> io::Result<()> {
        // SAFETY: plain call on a handle value; failure is reported.
        check(unsafe {
            SetHandleInformation(
                self.0,
                HANDLE_FLAG_INHERIT,
                if inherit { HANDLE_FLAG_INHERIT } else { 0 },
            )
        })
    }
}

/// Memory returned by a call that the caller frees with `LocalFree`.
struct Local(*mut c_void);

impl Drop for Local {
    fn drop(&mut self) {
        if !self.0.is_null() {
            // SAFETY: allocated by the system with LocalAlloc, freed once.
            unsafe { LocalFree(self.0) };
        }
    }
}

fn take_wide_string(pointer: *mut u16) -> String {
    let _free = Local(pointer.cast());
    if pointer.is_null() {
        return String::new();
    }
    // SAFETY: the system returned a null-terminated UTF-16 string; read up to its terminator.
    unsafe {
        let mut length = 0;
        while *pointer.add(length) != 0 {
            length += 1;
        }
        String::from_utf16_lossy(std::slice::from_raw_parts(pointer, length))
    }
}

// ----- Security identifiers -----

/// An owned security identifier.
#[derive(Debug, Clone)]
pub struct Sid {
    // u64 storage keeps the SID's alignment requirements (4 bytes) satisfied.
    words: Vec<u64>,
}

impl Sid {
    fn copy_from(sid: PSID) -> Sid {
        // SAFETY: `sid` is a valid SID the system returned; it is copied by its own length.
        unsafe {
            let length = GetLengthSid(sid) as usize;
            let mut words = vec![0u64; length.div_ceil(8)];
            std::ptr::copy_nonoverlapping(
                sid.cast::<u8>(),
                words.as_mut_ptr().cast::<u8>(),
                length,
            );
            Sid { words }
        }
    }

    /// A pointer for calls that read it; valid while `self` lives.
    pub fn as_psid(&self) -> PSID {
        self.words.as_ptr().cast_mut().cast()
    }

    /// Its string form, such as `S-1-5-21-…`.
    pub fn to_sddl(&self) -> io::Result<String> {
        let mut text: *mut u16 = null_mut();
        // SAFETY: valid SID in, a LocalAlloc'ed string out, freed by take_wide_string.
        check(unsafe { ConvertSidToStringSidW(self.as_psid(), &raw mut text) })?;
        Ok(take_wide_string(text))
    }

    /// Whether two SIDs are equal.
    pub fn equals(&self, other: &Sid) -> bool {
        // SAFETY: both are valid SIDs this crate copied.
        unsafe { EqualSid(self.as_psid(), other.as_psid()) != 0 }
    }
}

fn token_info(class: i32) -> io::Result<Vec<u64>> {
    let mut token: HANDLE = null_mut();
    // SAFETY: opens this process's own token for querying.
    check(unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &raw mut token) })?;
    let token = Handle::owned(token)?;
    let mut length = 0u32;
    // SAFETY: size query; it fails with ERROR_INSUFFICIENT_BUFFER and sets `length`.
    let ok = unsafe { GetTokenInformation(token.raw(), class, null_mut(), 0, &raw mut length) };
    if ok == 0 {
        // SAFETY: plain call.
        let code = unsafe { GetLastError() };
        if code != ERROR_INSUFFICIENT_BUFFER {
            return Err(io::Error::from_raw_os_error(code.cast_signed()));
        }
    }
    let mut buffer = vec![0u64; (length as usize).div_ceil(8)];
    // SAFETY: the buffer holds `length` bytes and is 8-byte aligned.
    check(unsafe {
        GetTokenInformation(
            token.raw(),
            class,
            buffer.as_mut_ptr().cast(),
            length,
            &raw mut length,
        )
    })?;
    Ok(buffer)
}

/// The user this process runs as.
pub fn current_user() -> io::Result<Sid> {
    let buffer = token_info(TokenUser)?;
    // SAFETY: GetTokenInformation(TokenUser) filled the aligned buffer with a TOKEN_USER whose
    // SID points inside the buffer.
    let user = unsafe { &*buffer.as_ptr().cast::<TOKEN_USER>() };
    Ok(Sid::copy_from(user.User.Sid))
}

/// The owner this process gives the objects it creates (the token's default owner): the user, or
/// the Administrators group for some elevated tokens.
pub fn default_owner() -> io::Result<Sid> {
    let buffer = token_info(TokenOwner)?;
    // SAFETY: as in `current_user`, for TOKEN_OWNER.
    let owner = unsafe { &*buffer.as_ptr().cast::<TOKEN_OWNER>() };
    Ok(Sid::copy_from(owner.Owner))
}

// ----- Security descriptors -----

/// A self-relative security descriptor built from SDDL.
pub struct SecurityDescriptor {
    pointer: Local,
}

// SAFETY: the descriptor is an immutable buffer the system allocated; reading it from any thread
// is safe, and it is freed once, on drop.
unsafe impl Send for SecurityDescriptor {}
// SAFETY: as above.
unsafe impl Sync for SecurityDescriptor {}

impl SecurityDescriptor {
    /// Parses SDDL, such as `D:P(A;OICI;FA;;;SY)`.
    pub fn from_sddl(sddl: &str) -> io::Result<SecurityDescriptor> {
        let text = wide_str(sddl);
        let mut descriptor: PSECURITY_DESCRIPTOR = null_mut();
        // SAFETY: valid string in; a LocalAlloc'ed descriptor out, owned by `Local`.
        check(unsafe {
            ConvertStringSecurityDescriptorToSecurityDescriptorW(
                text.as_ptr(),
                SDDL_REVISION_1,
                &raw mut descriptor,
                null_mut(),
            )
        })?;
        Ok(SecurityDescriptor {
            pointer: Local(descriptor),
        })
    }

    fn raw(&self) -> PSECURITY_DESCRIPTOR {
        self.pointer.0
    }

    /// `SECURITY_ATTRIBUTES` that apply this descriptor, not inheritable; valid while `self` lives.
    pub fn attributes(&self) -> SECURITY_ATTRIBUTES {
        SECURITY_ATTRIBUTES {
            nLength: u32::try_from(size_of::<SECURITY_ATTRIBUTES>()).unwrap_or(u32::MAX),
            lpSecurityDescriptor: self.raw(),
            bInheritHandle: 0,
        }
    }

    /// Its DACL, if it has one.
    pub fn dacl(&self) -> *mut ACL {
        use windows_sys::Win32::Security::GetSecurityDescriptorDacl;
        let mut present = 0;
        let mut defaulted = 0;
        let mut dacl: *mut ACL = null_mut();
        // SAFETY: a valid descriptor; the DACL pointer points into it.
        let ok = unsafe {
            GetSecurityDescriptorDacl(
                self.raw(),
                &raw mut present,
                &raw mut dacl,
                &raw mut defaulted,
            )
        };
        if ok == 0 || present == 0 {
            null_mut()
        } else {
            dacl
        }
    }
}

/// One entry of a DACL, as `secure-dir` judges it.
#[derive(Debug)]
pub struct Ace {
    /// Whether it allows (rather than denies or audits).
    pub allows: bool,
    /// Its flags (inheritance).
    pub flags: u8,
    /// Its access mask.
    pub mask: u32,
    /// The SID it names, in string form.
    pub sid: String,
    sid_copy: Sid,
}

impl Ace {
    /// The SID it names.
    pub fn sid(&self) -> &Sid {
        &self.sid_copy
    }
}

/// What a file or directory's security says: its owner, whether its DACL is protected from
/// inheritance, its entries, and the whole descriptor as SDDL (for logs).
pub struct FileSecurity {
    /// The owner.
    pub owner: Sid,
    /// Whether the DACL ignores the parent's inheritable entries.
    pub protected: bool,
    /// The DACL's entries.
    pub aces: Vec<Ace>,
    /// The descriptor as SDDL.
    pub sddl: String,
}

/// Reads the owner and DACL of a path.
pub fn file_security(path: &OsStr) -> io::Result<FileSecurity> {
    let name = wide(path);
    let mut owner: PSID = null_mut();
    let mut dacl: *mut ACL = null_mut();
    let mut descriptor: PSECURITY_DESCRIPTOR = null_mut();
    // SAFETY: valid name; the out pointers point into `descriptor`, which `Local` frees.
    win32(unsafe {
        GetNamedSecurityInfoW(
            name.as_ptr(),
            SE_FILE_OBJECT,
            OWNER_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION,
            &raw mut owner,
            null_mut(),
            &raw mut dacl,
            null_mut(),
            &raw mut descriptor,
        )
    })?;
    let descriptor = Local(descriptor);
    let mut control = 0u16;
    let mut revision = 0u32;
    // SAFETY: a valid descriptor.
    check(unsafe {
        GetSecurityDescriptorControl(descriptor.0, &raw mut control, &raw mut revision)
    })?;
    let mut text: *mut u16 = null_mut();
    // SAFETY: a valid descriptor; the string is freed by take_wide_string.
    check(unsafe {
        ConvertSecurityDescriptorToStringSecurityDescriptorW(
            descriptor.0,
            SDDL_REVISION_1,
            OWNER_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION,
            &raw mut text,
            null_mut(),
        )
    })?;
    let sddl = take_wide_string(text);
    Ok(FileSecurity {
        owner: Sid::copy_from(owner),
        protected: control & SE_DACL_PROTECTED != 0,
        aces: aces(dacl)?,
        sddl,
    })
}

fn aces(dacl: *mut ACL) -> io::Result<Vec<Ace>> {
    if dacl.is_null() {
        // A null DACL grants everyone everything; report it as one entry no SID matches.
        return Ok(vec![Ace {
            allows: true,
            flags: 0,
            mask: u32::MAX,
            sid: "(null DACL)".to_owned(),
            sid_copy: current_user()?,
        }]);
    }
    // SAFETY: zeroed POD for the size query.
    let mut size: ACL_SIZE_INFORMATION = unsafe { zeroed() };
    // SAFETY: a valid ACL from a descriptor.
    check(unsafe {
        GetAclInformation(
            dacl,
            (&raw mut size).cast(),
            u32::try_from(size_of::<ACL_SIZE_INFORMATION>()).unwrap_or(0),
            AclSizeInformation,
        )
    })?;
    let mut entries = Vec::new();
    for index in 0..size.AceCount {
        let mut ace: *mut c_void = null_mut();
        // SAFETY: index within AceCount; the entry points into the ACL.
        check(unsafe { GetAce(dacl, index, &raw mut ace) })?;
        if ace.is_null() {
            return Err(io::Error::other("GetAce returned no entry"));
        }
        // SAFETY: a non-null entry GetAce returned; every ACE starts with an ACE_HEADER.
        let header = unsafe { &*ace.cast::<ACE_HEADER>() };
        let kind = u32::from(header.AceType);
        // Allowed and denied ACEs share ACCESS_ALLOWED_ACE's layout: header, mask, SID.
        if kind == u32::from(ACCESS_ALLOWED_ACE_TYPE) || kind == u32::from(ACCESS_DENIED_ACE_TYPE) {
            // SAFETY: the type says this layout; the SID starts at SidStart.
            let entry = unsafe { &*ace.cast::<ACCESS_ALLOWED_ACE>() };
            let sid_pointer: PSID = (&raw const entry.SidStart).cast_mut().cast();
            let sid_copy = Sid::copy_from(sid_pointer);
            entries.push(Ace {
                allows: kind == u32::from(ACCESS_ALLOWED_ACE_TYPE),
                flags: header.AceFlags,
                mask: entry.Mask,
                sid: sid_copy.to_sddl()?,
                sid_copy,
            });
        } else {
            // Object and callback ACEs: Mostra never writes them, so their presence means the
            // DACL isn't Mostra's.
            entries.push(Ace {
                allows: true,
                flags: header.AceFlags,
                mask: u32::MAX,
                sid: format!("(ACE type {kind})"),
                sid_copy: current_user()?,
            });
        }
    }
    Ok(entries)
}

/// Creates a directory with `descriptor`. Returns `false` when it already existed.
pub fn create_directory(path: &OsStr, descriptor: &SecurityDescriptor) -> io::Result<bool> {
    let name = wide(path);
    let attributes = descriptor.attributes();
    // SAFETY: valid name and attributes.
    let ok = unsafe { CreateDirectoryW(name.as_ptr(), &raw const attributes) };
    if ok != 0 {
        return Ok(true);
    }
    let error = last_error();
    if is_error(&error, ERROR_ALREADY_EXISTS) {
        Ok(false)
    } else {
        Err(error)
    }
}

/// Gives one file or directory `descriptor`'s DACL (protected, so nothing is inherited from above)
/// and, with `owner`, that owner, through a handle opened on the entry itself: a reparse point
/// (a junction, a link) is changed, never what it points to, and nothing below a directory is
/// touched, unlike the named-object calls, which propagate. The owner may always change a DACL.
pub fn set_file_security(
    path: &OsStr,
    owner: Option<&Sid>,
    descriptor: &SecurityDescriptor,
) -> io::Result<()> {
    let name = wide(path);
    let mut access = READ_CONTROL | WRITE_DAC;
    let mut information = DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION;
    if owner.is_some() {
        access |= WRITE_OWNER;
        information |= OWNER_SECURITY_INFORMATION;
    }
    // SAFETY: valid name; the handle is owned and closed.
    let handle = Handle::owned(unsafe {
        CreateFileW(
            name.as_ptr(),
            access,
            FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
            null(),
            OPEN_EXISTING,
            FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT,
            null_mut(),
        )
    })?;
    // SAFETY: a valid handle with WRITE_DAC; the owner SID and DACL outlive the call.
    win32(unsafe {
        SetSecurityInfo(
            handle.raw(),
            SE_FILE_OBJECT,
            information,
            owner.map_or(null_mut(), Sid::as_psid),
            null_mut(),
            descriptor.dacl(),
            null(),
        )
    })
}

/// Opens `path` (a file, a directory or a pipe) for reading and writing as the current thread's
/// identity, then closes it; for the access probes.
pub fn try_open(path: &OsStr, directory: bool) -> io::Result<()> {
    let name = wide(path);
    let access = if directory {
        FILE_LIST_DIRECTORY
    } else {
        GENERIC_READ | GENERIC_WRITE
    };
    let flags = if directory {
        FILE_FLAG_BACKUP_SEMANTICS
    } else {
        0
    };
    // SAFETY: valid name; the handle is owned and closed.
    let handle = unsafe {
        CreateFileW(
            name.as_ptr(),
            access,
            FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
            null(),
            OPEN_EXISTING,
            flags,
            null_mut(),
        )
    };
    Handle::owned(handle).map(drop)
}

/// Opens `path` for reading only; for the probes' control check.
pub fn try_open_read(path: &OsStr) -> io::Result<()> {
    let name = wide(path);
    // SAFETY: as in `try_open`.
    let handle = unsafe {
        CreateFileW(
            name.as_ptr(),
            GENERIC_READ,
            FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
            null(),
            OPEN_EXISTING,
            FILE_FLAG_BACKUP_SEMANTICS,
            null_mut(),
        )
    };
    Handle::owned(handle).map(drop)
}

/// Runs `body` as another local user (a probe): logs on with the password, impersonates the user
/// on this thread, and reverts afterwards.
pub fn as_user<T>(user: &str, password: &str, body: impl FnOnce() -> T) -> io::Result<T> {
    let name = wide_str(user);
    let domain = wide_str(".");
    let secret = wide_str(password);
    let mut token: HANDLE = null_mut();
    // SAFETY: valid strings; the token is owned.
    let mut ok = unsafe {
        LogonUserW(
            name.as_ptr(),
            domain.as_ptr(),
            secret.as_ptr(),
            LOGON32_LOGON_INTERACTIVE,
            LOGON32_PROVIDER_DEFAULT,
            &raw mut token,
        )
    };
    if ok == 0 {
        // Servers may not grant a local logon to ordinary users; a network logon gives a token
        // whose access checks are the same for local objects.
        // SAFETY: as above.
        ok = unsafe {
            LogonUserW(
                name.as_ptr(),
                domain.as_ptr(),
                secret.as_ptr(),
                LOGON32_LOGON_NETWORK,
                LOGON32_PROVIDER_DEFAULT,
                &raw mut token,
            )
        };
    }
    check(ok)?;
    let token = Handle::owned(token)?;
    // SAFETY: a valid primary token for this thread's impersonation.
    check(unsafe { ImpersonateLoggedOnUser(token.raw()) })?;
    let result = body();
    // SAFETY: ends this thread's impersonation.
    check(unsafe { RevertToSelf() })?;
    Ok(result)
}

// ----- Processes -----

/// Suspends (or resumes) every thread of a process: a test probe's frozen owner.
pub fn suspend_process(pid: u32, suspend: bool) -> io::Result<usize> {
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{
        TH32CS_SNAPTHREAD, THREADENTRY32, Thread32First, Thread32Next,
    };
    use windows_sys::Win32::System::Threading::{OpenThread, SuspendThread, THREAD_SUSPEND_RESUME};
    // SAFETY: plain call; the snapshot handle is owned.
    let snapshot = Handle::owned(unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0) })?;
    // SAFETY: zeroed POD, sized before use.
    let mut entry: THREADENTRY32 = unsafe { zeroed() };
    entry.dwSize = u32::try_from(size_of::<THREADENTRY32>()).unwrap_or(0);
    let mut count = 0;
    // SAFETY: a valid snapshot and a sized entry.
    let mut ok = unsafe { Thread32First(snapshot.raw(), &raw mut entry) };
    while ok != 0 {
        if entry.th32OwnerProcessID == pid {
            // SAFETY: plain call; the handle is owned.
            if let Ok(thread) =
                Handle::owned(unsafe { OpenThread(THREAD_SUSPEND_RESUME, 0, entry.th32ThreadID) })
            {
                // SAFETY: a valid thread handle with suspend rights.
                unsafe {
                    if suspend {
                        SuspendThread(thread.raw());
                    } else {
                        ResumeThread(thread.raw());
                    }
                }
                count += 1;
            }
        }
        // SAFETY: as above.
        ok = unsafe { Thread32Next(snapshot.raw(), &raw mut entry) };
    }
    Ok(count)
}

/// One process of a snapshot.
#[derive(Debug, Clone, Copy)]
pub struct ProcessEntry {
    /// Its ID.
    pub pid: u32,
    /// The ID of the process that created it (which may since have exited and been reused).
    pub ppid: u32,
}

/// Every process on the machine.
pub fn process_snapshot() -> io::Result<Vec<ProcessEntry>> {
    // SAFETY: plain call; the snapshot handle is owned.
    let snapshot = Handle::owned(unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) })?;
    // SAFETY: zeroed POD, sized before use.
    let mut entry: PROCESSENTRY32W = unsafe { zeroed() };
    entry.dwSize = u32::try_from(size_of::<PROCESSENTRY32W>()).unwrap_or(0);
    let mut entries = Vec::new();
    // SAFETY: a valid snapshot and a sized entry.
    let mut ok = unsafe { Process32FirstW(snapshot.raw(), &raw mut entry) };
    while ok != 0 {
        entries.push(ProcessEntry {
            pid: entry.th32ProcessID,
            ppid: entry.th32ParentProcessID,
        });
        // SAFETY: as above.
        ok = unsafe { Process32NextW(snapshot.raw(), &raw mut entry) };
    }
    Ok(entries)
}

fn filetime(time: FILETIME) -> u64 {
    (u64::from(time.dwHighDateTime) << 32) | u64::from(time.dwLowDateTime)
}

/// What a process ID names now.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Liveness {
    /// A running process created at this time (100 ns units since 1601, UTC).
    Running(u64),
    /// No running process: none has the ID, or it exited and only a handle keeps it.
    Gone,
    /// A process this user can't query (another user's, or a protected one).
    Hidden,
}

/// Opens a process with `access`, or reports why not.
fn open_process(pid: u32, access: u32) -> Result<Handle, Liveness> {
    // SAFETY: plain call; the handle is owned.
    let handle = unsafe { OpenProcess(access, 0, pid) };
    match Handle::owned(handle) {
        Ok(handle) => Ok(handle),
        Err(error) if is_error(&error, ERROR_INVALID_PARAMETER) => Err(Liveness::Gone),
        Err(_) => Err(Liveness::Hidden),
    }
}

fn liveness_of(handle: &Handle) -> Liveness {
    let mut code = 0u32;
    // SAFETY: a valid process handle with query rights.
    if unsafe { GetExitCodeProcess(handle.raw(), &raw mut code) } == 0 {
        return Liveness::Hidden;
    }
    if code != STILL_ACTIVE.cast_unsigned() {
        return Liveness::Gone;
    }
    // SAFETY: zeroed POD outputs.
    let (mut creation, mut exit, mut kernel, mut user): (FILETIME, FILETIME, FILETIME, FILETIME) =
        unsafe { (zeroed(), zeroed(), zeroed(), zeroed()) };
    // SAFETY: a valid process handle with query rights.
    let ok = unsafe {
        GetProcessTimes(
            handle.raw(),
            &raw mut creation,
            &raw mut exit,
            &raw mut kernel,
            &raw mut user,
        )
    };
    if ok == 0 {
        Liveness::Hidden
    } else {
        Liveness::Running(filetime(creation))
    }
}

/// What `pid` names now.
pub fn process_liveness(pid: u32) -> Liveness {
    match open_process(pid, PROCESS_QUERY_LIMITED_INFORMATION) {
        Ok(handle) => liveness_of(&handle),
        Err(liveness) => liveness,
    }
}

/// Ends the process `pid` if it is still the one created at `created`. Returns whether it did.
pub fn terminate_if(pid: u32, created: u64) -> io::Result<bool> {
    let access = PROCESS_TERMINATE | PROCESS_QUERY_LIMITED_INFORMATION | 0x0010_0000; // SYNCHRONIZE
    let Ok(handle) = open_process(pid, access) else {
        return Ok(false);
    };
    if liveness_of(&handle) != Liveness::Running(created) {
        return Ok(false);
    }
    // SAFETY: a valid handle with terminate rights.
    check(unsafe { TerminateProcess(handle.raw(), 1) })?;
    // SAFETY: waits for the process object to signal its end.
    unsafe { WaitForSingleObject(handle.raw(), 5000) };
    Ok(true)
}

/// Makes this process ignore Ctrl+C and Ctrl+Break from any console it shares: a gate or the
/// pipe's helper ends only through its lifeline or channel, so a console's Ctrl+C reaches the
/// supervisor's own handler, which stops its children in order (D87), never them first.
pub fn ignore_console_interrupts() {
    // SAFETY: no handler, `TRUE`: the documented way to ignore Ctrl+C for this process.
    unsafe { SetConsoleCtrlHandler(None, 1) };
}

// ----- Job objects -----

/// A Job Object.
pub struct Job(Handle);

impl Job {
    /// Creates a named job whose processes all end when its last handle closes. Fails when the
    /// name exists.
    pub fn create(name: &str, descriptor: &SecurityDescriptor) -> io::Result<Job> {
        Self::create_with(Some(name), descriptor)
    }

    /// Creates a job with no name (only its handle reaches it) whose processes all end when its
    /// last handle closes: the one a gate starts its child in.
    pub fn create_unnamed(descriptor: &SecurityDescriptor) -> io::Result<Job> {
        Self::create_with(None, descriptor)
    }

    fn create_with(name: Option<&str>, descriptor: &SecurityDescriptor) -> io::Result<Job> {
        let text = name.map(wide_str);
        let attributes = descriptor.attributes();
        // SAFETY: valid attributes and name (or none); the handle is owned.
        let handle = unsafe {
            CreateJobObjectW(
                &raw const attributes,
                text.as_ref().map_or(null(), Vec::as_ptr),
            )
        };
        // SAFETY: plain call, read right after the call it reports on.
        let existed = unsafe { GetLastError() } == ERROR_ALREADY_EXISTS;
        let job = Job(Handle::owned(handle)?);
        if existed {
            return Err(io::Error::new(
                io::ErrorKind::AlreadyExists,
                format!("the job {} already exists", name.unwrap_or("")),
            ));
        }
        // SAFETY: zeroed POD with one flag set.
        let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = unsafe { zeroed() };
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        // SAFETY: a valid job handle and a correctly sized structure.
        check(unsafe {
            SetInformationJobObject(
                job.0.raw(),
                JobObjectExtendedLimitInformation,
                (&raw const limits).cast(),
                u32::try_from(size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>()).unwrap_or(0),
            )
        })?;
        Ok(job)
    }

    /// Opens an existing named job to end it, or `None` when no job has the name.
    pub fn open(name: &str) -> io::Result<Option<Job>> {
        let text = wide_str(name);
        // SAFETY: valid name; the handle is owned.
        let handle =
            unsafe { OpenJobObjectW(JOB_OBJECT_TERMINATE | JOB_OBJECT_QUERY, 0, text.as_ptr()) };
        match Handle::owned(handle) {
            Ok(handle) => Ok(Some(Job(handle))),
            Err(error) if is_error(&error, ERROR_FILE_NOT_FOUND) => Ok(None),
            Err(error) => Err(error),
        }
    }

    /// Puts a process in the job.
    pub fn assign(&self, process: &Handle) -> io::Result<()> {
        // SAFETY: valid job and process handles.
        check(unsafe { AssignProcessToJobObject(self.0.raw(), process.raw()) })
    }

    /// Ends every process in the job.
    pub fn terminate(&self, code: u32) -> io::Result<()> {
        // SAFETY: a valid job handle with terminate rights.
        check(unsafe { TerminateJobObject(self.0.raw(), code) })
    }

    /// The IDs of the processes in the job.
    pub fn process_ids(&self) -> io::Result<Vec<u32>> {
        let mut capacity = 64usize;
        loop {
            // The structure is a header (two u32s) and an array of ULONG_PTRs.
            let words = 1 + capacity;
            let mut buffer = vec![0usize; words];
            let bytes = u32::try_from(words * size_of::<usize>()).unwrap_or(u32::MAX);
            // SAFETY: an aligned buffer of `bytes` bytes.
            let ok = unsafe {
                QueryInformationJobObject(
                    self.0.raw(),
                    JobObjectBasicProcessIdList,
                    buffer.as_mut_ptr().cast(),
                    bytes,
                    null_mut(),
                )
            };
            if ok == 0 {
                let error = last_error();
                if is_error(&error, ERROR_MORE_DATA) && capacity < 65_536 {
                    capacity *= 4;
                    continue;
                }
                return Err(error);
            }
            // SAFETY: the call filled a JOBOBJECT_BASIC_PROCESS_ID_LIST at the buffer's start.
            let list = unsafe { &*buffer.as_ptr().cast::<JOBOBJECT_BASIC_PROCESS_ID_LIST>() };
            let count = (list.NumberOfProcessIdsInList as usize).min(capacity);
            // SAFETY: `count` entries follow the header inside the buffer.
            let ids = unsafe { std::slice::from_raw_parts(list.ProcessIdList.as_ptr(), count) };
            return Ok(ids
                .iter()
                .map(|&id| u32::try_from(id).unwrap_or(0))
                .collect());
        }
    }
}

// ----- The CRT's inherited descriptor table -----

/// One entry of the C runtime's descriptor table that a parent passes in `lpReserved2` (the
/// layout libuv and the Microsoft C runtime share): its CRT flags and its handle.
#[derive(Debug, Clone, Copy)]
pub struct CrtEntry {
    /// The CRT's flags (`FOPEN` 0x01, `FPIPE` 0x08, `FDEV` 0x40 …); 0 for a closed descriptor.
    pub flags: u8,
    /// The handle.
    pub handle: RawHandle,
}

/// The descriptor table this process inherited, and its standard handles.
pub fn inherited_descriptors() -> (Vec<CrtEntry>, [RawHandle; 3]) {
    // SAFETY: zeroed POD; the call fills it.
    let mut info: STARTUPINFOW = unsafe { zeroed() };
    // SAFETY: fills a valid structure.
    unsafe { GetStartupInfoW(&raw mut info) };
    let standard = [
        RawHandle(info.hStdInput),
        RawHandle(info.hStdOutput),
        RawHandle(info.hStdError),
    ];
    let size = usize::from(info.cbReserved2);
    if info.lpReserved2.is_null() || size < 4 {
        return (Vec::new(), standard);
    }
    // SAFETY: the system hands over `cbReserved2` bytes at `lpReserved2`, read here byte-wise.
    let bytes = unsafe { std::slice::from_raw_parts(info.lpReserved2, size) };
    (parse_crt_table(bytes), standard)
}

/// Parses `[count: i32][count flag bytes][count handles]`, unaligned, ignoring what doesn't fit.
pub fn parse_crt_table(bytes: &[u8]) -> Vec<CrtEntry> {
    let Some(count) = bytes
        .get(..4)
        .map(|b| i32::from_le_bytes([b[0], b[1], b[2], b[3]]))
    else {
        return Vec::new();
    };
    let count = usize::try_from(count).unwrap_or(0);
    let width = size_of::<usize>();
    let fits = (bytes.len().saturating_sub(4)) / (1 + width);
    let count = count.min(fits);
    let mut entries = Vec::with_capacity(count);
    for index in 0..count {
        let flags = bytes[4 + index];
        let start = 4 + count + index * width;
        let mut value = [0u8; size_of::<usize>()];
        value.copy_from_slice(&bytes[start..start + width]);
        let handle = usize::from_le_bytes(value) as HANDLE;
        entries.push(CrtEntry {
            flags,
            handle: RawHandle(handle),
        });
    }
    entries
}

/// Serializes a descriptor table in the same layout.
pub fn encode_crt_table(entries: &[CrtEntry]) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(4 + entries.len() * (1 + size_of::<usize>()));
    bytes.extend_from_slice(&i32::try_from(entries.len()).unwrap_or(0).to_le_bytes());
    bytes.extend(entries.iter().map(|entry| entry.flags));
    for entry in entries {
        bytes.extend_from_slice(&(entry.handle.0 as usize).to_le_bytes());
    }
    bytes
}

/// A process created suspended.
pub struct Suspended {
    /// Its process handle.
    pub process: Handle,
    /// Its main thread, still suspended.
    pub thread: Handle,
    /// Its ID.
    pub pid: u32,
}

impl Suspended {
    /// Lets its main thread run.
    pub fn resume(&self) -> io::Result<()> {
        // SAFETY: a valid thread handle.
        if unsafe { ResumeThread(self.thread.raw()) } == u32::MAX {
            Err(last_error())
        } else {
            Ok(())
        }
    }
}

/// Sets one attribute of an initialized list to `values`, which must outlive the list's use.
fn set_attribute(
    list: LPPROC_THREAD_ATTRIBUTE_LIST,
    attribute: u32,
    values: &[HANDLE],
) -> io::Result<()> {
    // SAFETY: an initialized list with room for the attribute; `values` outlives its use (the
    // CreateProcessW call it is for), as the caller keeps it.
    check(unsafe {
        UpdateProcThreadAttribute(
            list,
            0,
            attribute as usize,
            values.as_ptr().cast(),
            size_of_val(values),
            null_mut(),
            null(),
        )
    })
}

/// Creates `application` suspended, with no window of its own, the given standard handles and
/// descriptor table, inheriting exactly `inherit` (deduplicated, made inheritable first), and
/// inside `job` from its first instant (`PROC_THREAD_ATTRIBUTE_JOB_LIST`), so no moment exists in
/// which the child is in no job of its creator's.
pub fn create_suspended(
    application: &OsStr,
    command_line: &OsStr,
    standard: [RawHandle; 3],
    table: &[CrtEntry],
    inherit: &[RawHandle],
    job: &Job,
) -> io::Result<Suspended> {
    let application = wide(application);
    let mut command_line = wide(command_line);
    let mut handles: Vec<HANDLE> = Vec::new();
    for handle in inherit {
        if !handle.is_invalid() && !handles.contains(&handle.0) {
            handle.set_inheritable(true)?;
            handles.push(handle.0);
        }
    }
    let mut table_bytes = encode_crt_table(table);

    // SAFETY: zeroed POD, filled below.
    let mut info: STARTUPINFOEXW = unsafe { zeroed() };
    info.StartupInfo.cb = u32::try_from(size_of::<STARTUPINFOEXW>()).unwrap_or(0);
    info.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
    info.StartupInfo.hStdInput = standard[0].0;
    info.StartupInfo.hStdOutput = standard[1].0;
    info.StartupInfo.hStdError = standard[2].0;
    if !table.is_empty() {
        info.StartupInfo.cbReserved2 = u16::try_from(table_bytes.len()).map_err(|_| {
            io::Error::new(
                io::ErrorKind::InvalidInput,
                "the descriptor table is too large",
            )
        })?;
        info.StartupInfo.lpReserved2 = table_bytes.as_mut_ptr();
    }

    // Two attributes: the child's job, and the handles it inherits (when it inherits any).
    let jobs: [HANDLE; 1] = [job.0.raw()];
    let mut size = 0usize;
    // SAFETY: size query; it fails and sets `size`.
    unsafe { InitializeProcThreadAttributeList(null_mut(), 2, 0, &raw mut size) };
    let mut attribute_storage: Vec<u64> = vec![0u64; size.div_ceil(8)];
    let attributes: LPPROC_THREAD_ATTRIBUTE_LIST = attribute_storage.as_mut_ptr().cast();
    // SAFETY: a buffer of `size` bytes.
    check(unsafe { InitializeProcThreadAttributeList(attributes, 2, 0, &raw mut size) })?;
    // The child is in `job` from its first instant (Opus review of WP-W1).
    let mut updated = set_attribute(attributes, PROC_THREAD_ATTRIBUTE_JOB_LIST, &jobs);
    if updated.is_ok() && !handles.is_empty() {
        updated = set_attribute(attributes, PROC_THREAD_ATTRIBUTE_HANDLE_LIST, &handles);
    }
    if let Err(error) = updated {
        // SAFETY: initialized above.
        unsafe { DeleteProcThreadAttributeList(attributes) };
        return Err(error);
    }
    info.lpAttributeList = attributes;

    // SAFETY: zeroed POD output.
    let mut process: PROCESS_INFORMATION = unsafe { zeroed() };
    let flags = CREATE_SUSPENDED
        | CREATE_UNICODE_ENVIRONMENT
        | CREATE_NO_WINDOW
        | EXTENDED_STARTUPINFO_PRESENT;
    // SAFETY: every pointer is valid for the call; the environment and directory are inherited.
    let created = check(unsafe {
        CreateProcessW(
            application.as_ptr(),
            command_line.as_mut_ptr(),
            null(),
            null(),
            i32::from(!handles.is_empty()),
            flags,
            null(),
            null(),
            (&raw const info).cast(),
            &raw mut process,
        )
    });
    // SAFETY: initialized above, no longer used.
    unsafe { DeleteProcThreadAttributeList(attributes) };
    drop(attribute_storage);
    created?;
    Ok(Suspended {
        process: Handle::owned(process.hProcess)?,
        thread: Handle::owned(process.hThread)?,
        pid: process.dwProcessId,
    })
}

/// The creation time of a process this process holds a handle to.
pub fn creation_time(process: &Handle) -> io::Result<u64> {
    match liveness_of(process) {
        Liveness::Running(created) => Ok(created),
        _ => Err(io::Error::other("the process isn't running")),
    }
}

/// Waits for a process to exit and returns its exit code.
pub fn wait_exit(process: &Handle) -> io::Result<u32> {
    // SAFETY: a valid process handle.
    if unsafe { WaitForSingleObject(process.raw(), INFINITE) } != WAIT_OBJECT_0 {
        return Err(last_error());
    }
    let mut code = 0u32;
    // SAFETY: as above.
    check(unsafe { GetExitCodeProcess(process.raw(), &raw mut code) })?;
    Ok(code)
}

// ----- Overlapped I/O on pipes -----

/// A manual-reset event for one overlapped operation at a time.
struct Event(Handle);

impl Event {
    fn new() -> io::Result<Event> {
        // SAFETY: plain call; the handle is owned.
        Ok(Event(Handle::owned(unsafe {
            CreateEventW(null(), 1, 0, null())
        })?))
    }

    fn overlapped(&self) -> OVERLAPPED {
        // SAFETY: zeroed POD with the event set.
        let mut overlapped: OVERLAPPED = unsafe { zeroed() };
        overlapped.hEvent = self.0.raw();
        overlapped
    }
}

fn finish(handle: HANDLE, overlapped: &OVERLAPPED, started: i32) -> io::Result<u32> {
    if started == 0 {
        let error = last_error();
        if !is_error(&error, ERROR_IO_PENDING) {
            return Err(error);
        }
    }
    let mut transferred = 0u32;
    // SAFETY: the operation was started with this OVERLAPPED, which outlives the wait.
    check(unsafe { GetOverlappedResult(handle, overlapped, &raw mut transferred, 1) })?;
    Ok(transferred)
}

fn ended(error: &io::Error) -> bool {
    [
        ERROR_BROKEN_PIPE,
        ERROR_HANDLE_EOF,
        ERROR_PIPE_NOT_CONNECTED,
        ERROR_NO_DATA,
    ]
    .iter()
    .any(|&code| is_error(error, code))
}

/// Reads from a pipe (overlapped or not) into `buffer`; `Ok(0)` when the other end closed.
pub fn pipe_read(handle: RawHandle, buffer: &mut [u8]) -> io::Result<usize> {
    let handle = handle.0;
    let event = Event::new()?;
    let mut overlapped = event.overlapped();
    let length = u32::try_from(buffer.len()).unwrap_or(u32::MAX);
    // SAFETY: the buffer and OVERLAPPED outlive the wait in `finish`.
    let started = unsafe {
        ReadFile(
            handle,
            buffer.as_mut_ptr(),
            length,
            null_mut(),
            &raw mut overlapped,
        )
    };
    match finish(handle, &overlapped, started) {
        Ok(read) => Ok(read as usize),
        Err(error) if ended(&error) => Ok(0),
        Err(error) => Err(error),
    }
}

/// Writes all of `data` to a pipe (overlapped or not).
pub fn pipe_write_all(handle: RawHandle, mut data: &[u8]) -> io::Result<()> {
    let handle = handle.0;
    let event = Event::new()?;
    while !data.is_empty() {
        let mut overlapped = event.overlapped();
        let length = u32::try_from(data.len()).unwrap_or(u32::MAX);
        // SAFETY: the data and OVERLAPPED outlive the wait in `finish`.
        let started = unsafe {
            WriteFile(
                handle,
                data.as_ptr(),
                length,
                null_mut(),
                &raw mut overlapped,
            )
        };
        let written = finish(handle, &overlapped, started)? as usize;
        if written == 0 {
            return Err(io::Error::new(
                io::ErrorKind::WriteZero,
                "the pipe took no bytes",
            ));
        }
        data = &data[written..];
    }
    Ok(())
}

/// Opens the client end of a pipe for reading and writing (overlapped), allowing the server to
/// identify this process but never to act as it (`SECURITY_IDENTIFICATION`), since the server isn't
/// trusted until its owner is checked. A busy pipe is waited for up to 5 s.
pub fn open_pipe_client(full: &str) -> io::Result<Handle> {
    let name = wide_str(full);
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
    loop {
        // SAFETY: valid name; the handle is owned and closed.
        let handle = unsafe {
            CreateFileW(
                name.as_ptr(),
                GENERIC_READ | GENERIC_WRITE,
                0,
                null(),
                OPEN_EXISTING,
                FILE_FLAG_OVERLAPPED | SECURITY_SQOS_PRESENT | SECURITY_IDENTIFICATION,
                null_mut(),
            )
        };
        match Handle::owned(handle) {
            Ok(handle) => return Ok(handle),
            Err(error)
                if is_error(&error, ERROR_PIPE_BUSY) && std::time::Instant::now() < deadline =>
            {
                std::thread::sleep(std::time::Duration::from_millis(50));
            }
            Err(error) => return Err(error),
        }
    }
}

/// The owner of the kernel object (a pipe) a handle reaches.
pub fn object_owner(handle: &Handle) -> io::Result<Sid> {
    let mut owner: PSID = null_mut();
    let mut descriptor: PSECURITY_DESCRIPTOR = null_mut();
    // SAFETY: a valid handle; the owner points into `descriptor`, which `Local` frees after the
    // SID is copied out.
    win32(unsafe {
        GetSecurityInfo(
            handle.raw(),
            SE_KERNEL_OBJECT,
            OWNER_SECURITY_INFORMATION,
            &raw mut owner,
            null_mut(),
            null_mut(),
            null_mut(),
            &raw mut descriptor,
        )
    })?;
    let descriptor = Local(descriptor);
    let sid = Sid::copy_from(owner);
    drop(descriptor);
    Ok(sid)
}

/// Creates one instance of an owner-only named pipe that refuses remote clients. The first
/// instance of a name fails when the name exists, so nobody else's pipe is ever served as ours.
pub fn create_pipe_instance(
    name: &str,
    first: bool,
    descriptor: &SecurityDescriptor,
) -> io::Result<Handle> {
    let text = wide_str(name);
    let attributes = descriptor.attributes();
    let open = PIPE_ACCESS_DUPLEX
        | FILE_FLAG_OVERLAPPED
        | if first {
            FILE_FLAG_FIRST_PIPE_INSTANCE
        } else {
            0
        };
    let mode = PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT | PIPE_REJECT_REMOTE_CLIENTS;
    // SAFETY: valid name and attributes; the handle is owned.
    let handle = unsafe {
        CreateNamedPipeW(
            text.as_ptr(),
            open,
            mode,
            PIPE_UNLIMITED_INSTANCES,
            65_536,
            65_536,
            0,
            &raw const attributes,
        )
    };
    Handle::owned(handle)
}

/// Waits for a client to connect to a pipe instance.
pub fn pipe_accept(pipe: &Handle) -> io::Result<()> {
    let event = Event::new()?;
    let mut overlapped = event.overlapped();
    // SAFETY: the OVERLAPPED outlives the wait.
    let started = unsafe { ConnectNamedPipe(pipe.raw(), &raw mut overlapped) };
    if started == 0 {
        let error = last_error();
        if is_error(&error, ERROR_PIPE_CONNECTED) {
            return Ok(());
        }
        if !is_error(&error, ERROR_IO_PENDING) {
            return Err(error);
        }
    }
    finish(pipe.raw(), &overlapped, 1).map(drop)
}

/// Lets the client read what was written, then ends the connection.
pub fn pipe_close(pipe: &Handle) {
    // SAFETY: valid pipe handle; errors only mean the client is already gone.
    unsafe {
        FlushFileBuffers(pipe.raw());
        DisconnectNamedPipe(pipe.raw());
    }
}
