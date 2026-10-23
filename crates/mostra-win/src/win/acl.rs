//! Owner-only access control (D44, D85, D140; RT-10): the DACLs Mostra gives its directories on
//! Windows in place of modes 0700 and 0555, and the check of a directory it reuses.

use std::ffi::OsStr;
use std::fs;
use std::io;
use std::os::windows::fs::MetadataExt;
use std::path::Path;

use super::sys::{self, FileSecurity, SecurityDescriptor, Sid};

/// `SYSTEM`, which Windows services that keep the machine running (backup, indexing, antivirus)
/// act as; it can read any file anyway, through its privileges.
const SYSTEM: &str = "S-1-5-18";
/// Access for reading and traversing only: `FILE_GENERIC_READ | FILE_GENERIC_EXECUTE`.
const READ_EXECUTE: &str = "0x1200a9";
/// `OBJECT_INHERIT_ACE | CONTAINER_INHERIT_ACE`.
const INHERIT_BOTH: u8 = 0x3;
/// `FILE_ATTRIBUTE_REPARSE_POINT`: a junction or a link, never followed by a walk.
const REPARSE_POINT: u32 = 0x400;

/// The descriptor of a directory only the user (and `SYSTEM`) can use, inherited by everything
/// created inside it.
pub fn owner_only(user: &str) -> io::Result<SecurityDescriptor> {
    SecurityDescriptor::from_sddl(&format!(
        "O:{user}D:P(A;OICI;FA;;;{user})(A;OICI;FA;;;{SYSTEM})"
    ))
}

/// The descriptor of a sealed version directory: readable and traversable, never written,
/// renamed or deleted, until it is unsealed (`DATA_MODEL` §1's 0444 files and 0555 directories).
/// The owner can always change it back, as the owner of a 0555 directory can `chmod` it.
pub fn sealed(user: &str) -> io::Result<SecurityDescriptor> {
    SecurityDescriptor::from_sddl(&format!(
        "D:P(A;OICI;{READ_EXECUTE};;;{user})(A;OICI;{READ_EXECUTE};;;{SYSTEM})"
    ))
}

/// A kernel object (a job, a pipe) only the user and `SYSTEM` can open.
pub fn owner_only_object(user: &str) -> io::Result<SecurityDescriptor> {
    SecurityDescriptor::from_sddl(&format!("O:{user}D:P(A;;GA;;;{user})(A;;GA;;;{SYSTEM})"))
}

/// What `secure_directory` did.
#[derive(Debug)]
pub enum Secured {
    /// It created the directory owner-only.
    Created,
    /// The directory already was owner-only.
    Kept,
    /// It reset a directory the user owns, which others could use, to owner-only; `from` is the
    /// descriptor it had, as SDDL.
    Tightened {
        /// The descriptor it had.
        from: String,
    },
}

/// Why `secure_directory` refused.
#[derive(Debug)]
pub enum Refused {
    /// Another account owns it (as SID).
    NotOwned {
        /// The owner's SID.
        owner: String,
    },
    /// The path isn't a directory.
    NotDirectory,
    /// The system refused an operation.
    Io(io::Error),
}

impl From<io::Error> for Refused {
    fn from(error: io::Error) -> Self {
        Refused::Io(error)
    }
}

/// Makes `path` a directory only the user (and `SYSTEM`) can use (D85 on Windows): creates it
/// owner-only when missing (its missing parents get the parent's defaults), refuses one another
/// account owns, and resets one the user owns that grants anyone else anything, with everything
/// below it, so every file inside inherits the owner-only entries. Windows lets any user open a
/// file by its path without access to the directories above it (the "bypass traverse checking"
/// right everyone has), so a directory's own entries alone would not keep its files private.
pub fn secure_directory(path: &Path) -> Result<Secured, Refused> {
    let user = sys::current_user()?;
    let user_sddl = user.to_sddl()?;
    let descriptor = owner_only(&user_sddl)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    if sys::create_directory(path.as_os_str(), &descriptor)? {
        return Ok(Secured::Created);
    }
    if !fs::metadata(path)?.is_dir() {
        return Err(Refused::NotDirectory);
    }
    let security = sys::file_security(path.as_os_str())?;
    if !owned_by_user(&security, &user)? {
        return Err(Refused::NotOwned {
            owner: security.owner.to_sddl()?,
        });
    }
    if owner_only_dacl(&security, &user_sddl) {
        return Ok(Secured::Kept);
    }
    // The directory itself, then every entry below that grants anyone but the user and `SYSTEM`
    // anything. Entries already that narrow keep their lists: a sealed version stays sealed
    // (Opus review of WP-W1). Links are never followed out of the home.
    sys::set_file_security(path.as_os_str(), Some(&user), &descriptor)?;
    walk(path, &mut |entry| {
        let security = sys::file_security(entry.as_os_str())?;
        if narrow(&security, &user_sddl) {
            return Ok(());
        }
        sys::set_file_security(entry.as_os_str(), None, &descriptor)
    })?;
    Ok(Secured::Tightened {
        from: security.sddl,
    })
}

/// Calls `visit` on every entry below `dir`, depth first, descending into directories but never
/// through a reparse point (a junction into the warm set, a link): the walk stays in the tree.
/// An entry removed meanwhile is skipped.
fn walk(dir: &Path, visit: &mut dyn FnMut(&Path) -> io::Result<()>) -> io::Result<()> {
    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error),
    };
    for entry in entries {
        let entry = entry?;
        // A directory entry's metadata describes the entry itself, never its target.
        let metadata = match entry.metadata() {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == io::ErrorKind::NotFound => continue,
            Err(error) => return Err(error),
        };
        if metadata.file_attributes() & REPARSE_POINT != 0 {
            continue;
        }
        let path = entry.path();
        match visit(&path) {
            Err(error) if error.kind() == io::ErrorKind::NotFound => continue,
            result => result?,
        }
        if metadata.is_dir() {
            walk(&path, visit)?;
        }
    }
    Ok(())
}

/// Whether an entry's list grants nothing to anyone but the user and `SYSTEM`.
fn narrow(security: &FileSecurity, user_sddl: &str) -> bool {
    security
        .aces
        .iter()
        .all(|ace| !ace.allows || ace.sid == user_sddl || ace.sid == SYSTEM)
}

/// Whether the user owns the object: as its own SID, or as the default owner its token gives the
/// objects it creates (an elevated administrator's token may give the Administrators group).
fn owned_by_user(security: &FileSecurity, user: &Sid) -> io::Result<bool> {
    if user.equals(&security.owner) {
        return Ok(true);
    }
    Ok(sys::default_owner()?.equals(&security.owner))
}

/// Whether a DACL grants only the user and `SYSTEM`, and passes that on to everything inside.
pub fn owner_only_dacl(security: &FileSecurity, user_sddl: &str) -> bool {
    security.protected
        && security.aces.iter().all(|ace| {
            !ace.allows
                || ((ace.sid == user_sddl || ace.sid == SYSTEM)
                    && ace.flags & INHERIT_BOTH == INHERIT_BOTH)
        })
}

/// Seals a version directory: everything in it becomes read-only for everyone (`seal`), or
/// owner-only and writable again (`unseal`), for gc and the repair of a damaged version. Every
/// entry gets the list itself, so the walk never follows a junction out of the tree (a build's
/// `node_modules` farm points into the warm set).
pub fn reset_version(path: &OsStr, seal: bool) -> io::Result<()> {
    let user = sys::current_user()?.to_sddl()?;
    let descriptor = if seal {
        sealed(&user)?
    } else {
        owner_only(&user)?
    };
    let root = Path::new(path);
    if fs::symlink_metadata(root)?.file_attributes() & REPARSE_POINT != 0 {
        return Err(io::Error::other(
            "refusing to seal or unseal through a link",
        ));
    }
    // Unsealing goes from the top down, so each directory may be entered again; sealing from the
    // bottom up is the same set of calls, since the owner may always change a list.
    sys::set_file_security(path, None, &descriptor)?;
    walk(root, &mut |entry| {
        sys::set_file_security(entry.as_os_str(), None, &descriptor)
    })
}
