//! The runtime bundle (RT-01, H-13, D142): a release's pinned archive downloaded once, checked
//! against its pin, extracted, its files checked against `files.json`, cached by digest, and made
//! ready by the bundle's own `bin/mostra-setup` (the one implementation of the verify browser's
//! fetch and the setup marker, D142 item 2). The layout and every rule match the TypeScript SDK's
//! (INTERFACES §16), so a Rust host and a JavaScript host share one cache.
//!
//! Nothing runs from a bundle that hasn't been checked: the archive's size and SHA-256 are the
//! pinned ones before it is opened, and every file matches `files.json` (whose SHA-256
//! `bundle.json` pins) before anything in it runs.

use std::collections::{BTreeMap, BTreeSet};
use std::io::Read;
use std::path::{Component, Path, PathBuf};
use std::time::{Duration, SystemTime};

use sha2::{Digest, Sha256};

use crate::error::{Error, Result};
use crate::wire::{BundleFiles, BundleInfo, BundlePins, BundleSetup};

/// The environment the bundle manager reads: the cache, mirror and offline variables, proxies.
pub type Environment = BTreeMap<String, String>;

/// The setup marker's file name (`BUNDLE_SETUP_MARKER`).
pub const SETUP_MARKER: &str = ".mostra-setup.json";

/// `CREATE_NO_WINDOW`: a child with no console window of its own.
#[cfg(windows)]
pub(crate) const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// What Windows gives every program, which a child of the crate keeps (D150 item 9, D153):
/// Node.js aborts without `SystemRoot`, which its random-number source needs.
#[cfg(windows)]
const WINDOWS_SYSTEM_VARIABLES: &[&str] = &[
    "SystemRoot",
    "SystemDrive",
    "windir",
    "ComSpec",
    "PATHEXT",
    "TEMP",
    "TMP",
    "USERPROFILE",
    "HOMEDRIVE",
    "HOMEPATH",
    "APPDATA",
    "LOCALAPPDATA",
    "ProgramData",
    "ProgramFiles",
    "ProgramFiles(x86)",
    "ProgramW6432",
    "CommonProgramFiles",
    "CommonProgramFiles(x86)",
    "CommonProgramW6432",
    "USERNAME",
    "USERDOMAIN",
    "COMPUTERNAME",
    "OS",
    "NUMBER_OF_PROCESSORS",
    "PROCESSOR_ARCHITECTURE",
    "PROCESSOR_IDENTIFIER",
];

/// The environment of a process the crate starts: the host's, and on Windows each of the
/// system's own variables this process has that the host's lacks (matched without case, as
/// Windows matches names). They name the system's folders, nothing of the user's secrets.
#[must_use]
pub(crate) fn child_environment(env: &Environment) -> Environment {
    #[cfg_attr(not(windows), allow(unused_mut))]
    let mut out = env.clone();
    #[cfg(windows)]
    for name in WINDOWS_SYSTEM_VARIABLES {
        if out.keys().any(|key| key.eq_ignore_ascii_case(name)) {
            continue;
        }
        if let Some((key, value)) = std::env::vars_os().find_map(|(key, value)| {
            let key = key.into_string().ok()?;
            key.eq_ignore_ascii_case(name)
                .then(|| value.into_string().ok().map(|value| (key, value)))
                .flatten()
        }) {
            out.insert(key, value);
        }
    }
    out
}

/// The space an install needs beyond the archive and its files: the browser and some margin.
const BROWSER_ALLOWANCE: u64 = 500 * 1024 * 1024;

/// How old an install lock may get before another installer takes it over.
const STALE_LOCK: Duration = Duration::from_hours(1);

/// An extracted bundle and what its `bundle.json` says.
#[derive(Debug, Clone)]
pub struct Bundle {
    /// Its root directory, holding `bundle.json`.
    pub root: PathBuf,
    /// Its parsed `bundle.json`.
    pub info: BundleInfo,
}

impl Bundle {
    /// `mostra-runtime`'s launcher in the bundle.
    #[must_use]
    pub fn runtime(&self) -> PathBuf {
        self.root.join(self.info.entries.runtime.as_str())
    }

    /// The bundle's own Node.js.
    #[must_use]
    pub fn node(&self) -> PathBuf {
        self.root.join(self.info.node.path.as_str())
    }
}

/// One step of an install, for a person waiting.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InstallStep {
    /// Waiting for another installer of the same bundle.
    Lock,
    /// Downloading: bytes received and the total the pin names.
    Download {
        /// Bytes received so far.
        received: u64,
        /// The archive's size.
        total: u64,
    },
    /// Extracting the archive.
    Extract,
    /// Checking the bundle's files.
    Files,
    /// Fetching and checking the verify browser (`bin/mostra-setup`).
    Browser,
}

fn invalid(message: impl Into<String>) -> Error {
    Error::new("MOSTRA_ENV_BUNDLE_INVALID", message)
}

fn download_failed(message: impl Into<String>) -> Error {
    Error::new("MOSTRA_ENV_BUNDLE_DOWNLOAD_FAILED", message)
}

fn unavailable(message: impl Into<String>) -> Error {
    Error::new("MOSTRA_ENV_BUNDLE_UNAVAILABLE", message)
}

/// Whether `MOSTRA_OFFLINE` says Mostra is offline: any value but empty, `0`, `false` or `no`.
#[must_use]
pub fn offline(env: &Environment) -> bool {
    env.get("MOSTRA_OFFLINE").is_some_and(|value| {
        let value = value.trim().to_ascii_lowercase();
        !(value.is_empty() || value == "0" || value == "false" || value == "no")
    })
}

/// Where the cache is: `MOSTRA_CACHE_DIR`, else `~/Library/Caches/mostra` (macOS),
/// `%LOCALAPPDATA%\mostra-cache` (Windows, beside the home), else
/// `${XDG_CACHE_HOME:-~/.cache}/mostra`.
#[must_use]
pub fn cache_root(env: &Environment) -> PathBuf {
    if let Some(dir) = env.get("MOSTRA_CACHE_DIR").filter(|dir| !dir.is_empty()) {
        return PathBuf::from(dir);
    }
    if cfg!(windows) {
        let local = env
            .get("LOCALAPPDATA")
            .filter(|dir| !dir.is_empty())
            .map(PathBuf::from)
            .or_else(|| {
                env.get("USERPROFILE")
                    .filter(|dir| !dir.is_empty())
                    .map(|profile| PathBuf::from(profile).join("AppData").join("Local"))
            })
            .unwrap_or_else(|| PathBuf::from(r"C:\"));
        return local.join("mostra-cache");
    }
    let home = env
        .get("HOME")
        .filter(|home| !home.is_empty())
        .map_or_else(|| PathBuf::from("/"), PathBuf::from);
    if cfg!(target_os = "macos") {
        return home.join("Library/Caches/mostra");
    }
    match env.get("XDG_CACHE_HOME").filter(|dir| dir.starts_with('/')) {
        Some(dir) => PathBuf::from(dir).join("mostra"),
        None => home.join(".cache/mostra"),
    }
}

/// The archive name of a release's bundle for a platform (`bundleAssetName`).
#[must_use]
pub fn asset_name(version: &str, platform: &str) -> String {
    format!("mostra-{version}-{platform}.tar.gz")
}

/// Whether `path` is a plain relative path: no absolute start, no `.` or `..` segment.
fn safe_relative(path: &str) -> bool {
    !(path.is_empty() || path.starts_with('/') || path.contains('\\') || path.contains('\0'))
        && path
            .split('/')
            .all(|segment| !segment.is_empty() && segment != "." && segment != "..")
}

/// Reads `bundle.json` at `root`: `MOSTRA_ENV_BUNDLE_INVALID` when it isn't a bundle's.
///
/// # Errors
///
/// `MOSTRA_ENV_BUNDLE_INVALID`.
pub fn read_bundle(root: &Path) -> Result<Bundle> {
    let file = root.join("bundle.json");
    let text = std::fs::read_to_string(&file).map_err(|e| {
        invalid(format!(
            "{} has no readable bundle.json ({e}).",
            root.display()
        ))
    })?;
    let info: BundleInfo = serde_json::from_str(&text)
        .map_err(|_| invalid(format!("{} isn't a runtime bundle's.", file.display())))?;
    let paths = [
        info.node.path.as_str(),
        info.entries.runtime.as_str(),
        info.entries.cli.as_str(),
        info.entries.setup.as_str(),
        info.files.path.as_str(),
        info.browser.installer.as_str(),
    ];
    if !paths.iter().all(|path| safe_relative(path)) {
        return Err(invalid(format!(
            "{} names a path outside the bundle.",
            file.display()
        )));
    }
    Ok(Bundle {
        root: root.to_path_buf(),
        info,
    })
}

/// Whether a bundle platform is Windows', whose links setup makes as junctions (D153).
#[must_use]
pub fn is_windows_bundle(platform: &str) -> bool {
    platform.starts_with("win32-")
}

/// A path as Windows' own APIs spell it, without the `\\?\` prefix `canonicalize` adds, so it
/// compares with the root the bundle's setup (Node.js's `realpath.native`) records.
pub(crate) fn plain_path(path: PathBuf) -> PathBuf {
    let text = path.to_string_lossy();
    if let Some(rest) = text.strip_prefix(r"\\?\UNC\") {
        return PathBuf::from(format!(r"\\{rest}"));
    }
    match text.strip_prefix(r"\\?\") {
        Some(rest) => PathBuf::from(rest),
        None => path,
    }
}

/// The bundle's real path, as its setup marker names it.
fn real_root(root: &Path) -> Option<PathBuf> {
    root.canonicalize().ok().map(plain_path)
}

/// The setup marker, when it describes exactly this bundle. A Windows bundle's marker must also
/// name the root it sits at now: its junctions point into the root setup ran at, so a bundle
/// moved or copied since is set up again (D153).
#[must_use]
pub fn read_setup(bundle: &Bundle) -> Option<BundleSetup> {
    let text = std::fs::read_to_string(bundle.root.join(SETUP_MARKER)).ok()?;
    let marker: BundleSetup = serde_json::from_str(&text).ok()?;
    let info = &bundle.info;
    let here = !is_windows_bundle(&info.platform.to_string())
        || marker.root.as_ref().is_some_and(|root| {
            real_root(&bundle.root).is_some_and(|real| Path::new(root.as_str()) == real)
        });
    (here
        && marker.files.as_str() == info.files.sha256.as_str()
        && marker.version.as_str() == info.version.as_str()
        && marker.platform == info.platform
        && marker.browser.revision.as_str() == info.browser.revision.as_str())
    .then_some(marker)
}

/// The SHA-256 (hex) and size of a file, read as a stream.
fn hash_file(path: &Path) -> std::io::Result<(String, u64)> {
    let mut file = std::fs::File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0_u8; 256 * 1024];
    let mut size = 0_u64;
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
        size += read as u64;
    }
    Ok((hex(&hasher.finalize()), size))
}

pub(crate) fn hex(bytes: &[u8]) -> String {
    use std::fmt::Write as _;
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        let _ = write!(out, "{byte:02x}");
    }
    out
}

/// One entry of a walk: a regular file, a link, or anything else.
enum Walked {
    File { executable: bool },
    Link { target: String },
    Other,
}

/// A link's target as the manifest spells it: relative to the link's directory, `/`-separated.
/// POSIX targets are kept as written; a Windows junction's absolute target is made relative.
fn link_target(root: &Path, path: &str, written: &Path) -> String {
    if cfg!(windows) {
        let written = plain_path(written.to_path_buf());
        if written.is_absolute() {
            // A junction stores an absolute path, spelled as whoever made it spelled the bundle's
            // root: setup uses the real path, while `root` may be another spelling of it (an 8.3
            // short name, another case). Each spelling of the link's directory is tried against
            // the same spelling of the root, so neither reads as a detour out of the bundle.
            let dir = root.join(path).parent().unwrap_or(root).to_path_buf();
            let mut spellings = vec![(root.to_path_buf(), dir.clone())];
            if let Ok(real) = root.canonicalize().map(plain_path)
                && let Ok(inside) = dir.strip_prefix(root)
            {
                spellings.push((real.clone(), real.join(inside)));
            }
            for (base, from) in &spellings {
                if starts_with_folded(&written, base) {
                    return relative_path(from, &written);
                }
            }
            return relative_path(&dir, &written);
        }
        return written.to_string_lossy().replace('\\', "/");
    }
    written.to_string_lossy().into_owned()
}

/// Whether two path components are the same: without case on Windows, as it compares names.
fn same_component(a: &std::path::Component<'_>, b: &std::path::Component<'_>) -> bool {
    if cfg!(windows) {
        a.as_os_str()
            .to_string_lossy()
            .eq_ignore_ascii_case(&b.as_os_str().to_string_lossy())
    } else {
        a == b
    }
}

/// Whether `path` is `base` or lies below it, by components.
fn starts_with_folded(path: &Path, base: &Path) -> bool {
    let mut path = path.components();
    base.components().all(|part| {
        path.next()
            .is_some_and(|other| same_component(&part, &other))
    })
}

/// `to` relative to `from` (both absolute, lexically), `/`-separated.
fn relative_path(from: &Path, to: &Path) -> String {
    let from: Vec<_> = from.components().collect();
    let to: Vec<_> = to.components().collect();
    let common = from
        .iter()
        .zip(&to)
        .take_while(|(a, b)| same_component(a, b))
        .count();
    let mut parts: Vec<String> = vec!["..".to_owned(); from.len() - common];
    parts.extend(
        to[common..]
            .iter()
            .map(|part| part.as_os_str().to_string_lossy().into_owned()),
    );
    parts.join("/")
}

/// Every file and link under `root` by `/`-separated path, skipping `skip`ped paths (and below).
fn walk(root: &Path, skip: &dyn Fn(&str) -> bool) -> std::io::Result<BTreeMap<String, Walked>> {
    let mut out = BTreeMap::new();
    let mut stack = vec![String::new()];
    while let Some(dir) = stack.pop() {
        for entry in std::fs::read_dir(root.join(&dir))? {
            let entry = entry?;
            let name = entry.file_name().to_string_lossy().into_owned();
            let path = if dir.is_empty() {
                name
            } else {
                format!("{dir}/{name}")
            };
            if skip(&path) {
                continue;
            }
            let kind = entry.file_type()?;
            if kind.is_dir() {
                stack.push(path);
            } else if kind.is_symlink() {
                let target = link_target(root, &path, &std::fs::read_link(entry.path())?);
                out.insert(path, Walked::Link { target });
            } else if kind.is_file() {
                out.insert(
                    path,
                    Walked::File {
                        executable: executable(&entry.metadata()?),
                    },
                );
            } else {
                out.insert(path, Walked::Other);
            }
        }
    }
    Ok(out)
}

/// Whether a file's owner may execute it; Windows keeps no execute bit (D150 item 8).
#[cfg(unix)]
fn executable(meta: &std::fs::Metadata) -> bool {
    use std::os::unix::fs::PermissionsExt;
    meta.permissions().mode() & 0o100 != 0
}

#[cfg(not(unix))]
fn executable(_meta: &std::fs::Metadata) -> bool {
    false
}

/// Whether a link's target is relative and resolves inside the tree.
fn link_stays_inside(path: &str, target: &str) -> bool {
    if target.starts_with('/') || target.contains('\\') || target.contains(':') {
        return false;
    }
    let mut depth: i64 = 0;
    let parent: Vec<&str> = path.split('/').collect();
    let segments = parent[..parent.len() - 1]
        .iter()
        .copied()
        .chain(target.split('/'));
    for segment in segments {
        match segment {
            "" | "." => {}
            ".." => {
                depth -= 1;
                if depth < 0 {
                    return false;
                }
            }
            _ => depth += 1,
        }
    }
    true
}

/// What the tree check may find besides the listed files: the bundle's records and browsers.
fn setup_extra(path: &str) -> bool {
    path == "bundle.json"
        || path == "files.json"
        || path == "browsers"
        || path.starts_with("browsers/")
        || path == SETUP_MARKER
        || path.starts_with(&format!("{SETUP_MARKER}.tmp-"))
}

/// Checks the tree under `root` against `manifest`: each listed file present and regular, with
/// its size, SHA-256 and execute bit; each link with its target, staying inside (unless `links`
/// is false: a Windows bundle's junctions, which its setup makes, D153); nothing else besides the
/// setup extras. Reports at most 20 problems.
fn check_tree(
    root: &Path,
    manifest: &BundleFiles,
    links_too: bool,
) -> std::io::Result<Vec<String>> {
    let mut problems = Vec::new();
    let files: BTreeMap<&str, _> = manifest
        .files
        .iter()
        .map(|entry| (entry.path.as_str(), entry))
        .collect();
    let links: BTreeMap<&str, _> = manifest
        .links
        .iter()
        .map(|entry| (entry.path.as_str(), entry))
        .collect();
    for path in files.keys().chain(links.keys()) {
        if !safe_relative(path) {
            problems.push(format!("{path}: not a plain relative path"));
        }
    }
    if !problems.is_empty() {
        return Ok(problems);
    }
    let mut listed_dirs = BTreeSet::new();
    for path in files.keys().chain(links.keys()) {
        let segments: Vec<&str> = path.split('/').collect();
        for end in 1..segments.len() {
            listed_dirs.insert(segments[..end].join("/"));
        }
    }
    let skip = |path: &str| {
        setup_extra(path)
            && !files.contains_key(path)
            && !links.contains_key(path)
            && !listed_dirs.contains(path)
    };
    let found = walk(root, &skip)?;
    for path in found.keys() {
        if !files.contains_key(path.as_str()) && !links.contains_key(path.as_str()) {
            problems.push(format!("{path}: not in the bundle's file list"));
        }
    }
    for (path, link) in links.iter().filter(|_| links_too) {
        match found.get(*path) {
            Some(Walked::Link { target }) if target == link.target.as_str() => {
                if !link_stays_inside(path, target) {
                    problems.push(format!("{path}: links outside the bundle"));
                }
            }
            Some(Walked::Link { target }) => {
                problems.push(format!(
                    "{path}: links to {target}, not {}",
                    link.target.as_str()
                ));
            }
            _ => problems.push(format!("{path}: missing link")),
        }
    }
    for (path, entry) in &files {
        match found.get(*path) {
            Some(Walked::File { executable }) => {
                if *executable != entry.executable {
                    problems.push(format!(
                        "{path}: {}",
                        if entry.executable {
                            "not executable"
                        } else {
                            "executable"
                        }
                    ));
                    continue;
                }
                let (sha256, size) = hash_file(&root.join(path))?;
                if i64::try_from(size).ok() != Some(entry.size) {
                    problems.push(format!("{path}: {size} bytes, not {}", entry.size));
                } else if sha256 != entry.sha256.as_str() {
                    problems.push(format!("{path}: its SHA-256 differs"));
                }
            }
            _ => problems.push(format!("{path}: missing file")),
        }
        if problems.len() >= 20 {
            break;
        }
    }
    problems.truncate(20);
    Ok(problems)
}

/// Checks the bundle's files against `files.json`, which `bundle.json` pins by SHA-256, and its
/// links; a Windows bundle's only once its setup made them (D153).
///
/// # Errors
///
/// `MOSTRA_ENV_BUNDLE_INVALID` naming what differs.
pub fn check_files(bundle: &Bundle) -> Result<()> {
    check(bundle, true)
}

/// The files, and the links when the bundle's archive carries them (every bundle but Windows').
pub(crate) fn check_as_extracted(bundle: &Bundle) -> Result<()> {
    check(
        bundle,
        !is_windows_bundle(&bundle.info.platform.to_string()),
    )
}

fn check(bundle: &Bundle, links: bool) -> Result<()> {
    let info = &bundle.info;
    let listing = bundle.root.join(info.files.path.as_str());
    let (sha256, _) = hash_file(&listing).unwrap_or_default();
    if sha256 != info.files.sha256.as_str() {
        return Err(invalid(format!(
            "{} doesn't match the SHA-256 that bundle.json pins.",
            info.files.path.as_str()
        )));
    }
    let manifest: BundleFiles = std::fs::read_to_string(&listing)
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .ok_or_else(|| {
            invalid(format!(
                "{} isn't a bundle's file list.",
                info.files.path.as_str()
            ))
        })?;
    let problems = check_tree(&bundle.root, &manifest, links).map_err(|e| {
        invalid(format!(
            "The runtime bundle at {} can't be read: {e}",
            bundle.root.display()
        ))
    })?;
    if problems.is_empty() {
        Ok(())
    } else {
        Err(invalid(format!(
            "Mostra {}'s runtime bundle for {} differs from its file list: {}.",
            info.version.as_str(),
            info.platform,
            problems.join("; ")
        )))
    }
}

/// Makes a checked bundle ready: runs its own setup entry (`bundle.json`'s `entries.setup`) on the
/// bundle's own Node.js, `--root <bundle>`, which makes a Windows bundle's junctions, fetches and
/// checks the verify browser and writes the setup marker (D142 item 2, D153). Node.js is the
/// bundle's: the entry's `#!/usr/bin/env node` would ask the machine for one it may not have.
///
/// # Errors
///
/// The setup's own diagnostic (`MOSTRA_ENV_BUNDLE_DOWNLOAD_FAILED`, `MOSTRA_ENV_BUNDLE_INVALID`,
/// `MOSTRA_ENV_BUNDLE_UNAVAILABLE` offline), or `MOSTRA_ENV_RUNTIME_MISSING` when it can't run.
pub async fn setup(bundle: &Bundle, env: &Environment) -> Result<BundleSetup> {
    let program = bundle.node();
    let entry = bundle.root.join(bundle.info.entries.setup.as_str());
    let mut command = tokio::process::Command::new(&program);
    command
        .arg(&entry)
        .arg("--root")
        .arg(&bundle.root)
        .env_clear()
        .envs(child_environment(env))
        .stdin(std::process::Stdio::null())
        // A host that gives up the install stops its setup too.
        .kill_on_drop(true);
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);
    let output = command.output().await.map_err(|e| {
        Error::new(
            "MOSTRA_ENV_RUNTIME_MISSING",
            format!("Couldn't run {}: {e}", program.display()),
        )
    })?;
    let line = String::from_utf8_lossy(&output.stdout);
    let answer: serde_json::Value = line
        .lines()
        .rev()
        .find_map(|line| serde_json::from_str(line).ok())
        .unwrap_or(serde_json::Value::Null);
    if answer["status"] == "ok" {
        return read_setup(bundle).ok_or_else(|| {
            invalid("The bundle's setup finished without a marker that matches it.")
        });
    }
    match serde_json::from_value::<crate::wire::Diagnostic>(answer["diagnostic"].clone()) {
        Ok(diagnostic) => Err(Error::from_diagnostic(diagnostic, None)),
        Err(_) => Err(download_failed(format!(
            "The bundle's setup failed ({}).",
            output.status
        ))),
    }
}

/// The pins this build of the crate carries (`bundles.json`, written by the release before
/// `cargo publish`), or `None` in a development checkout.
#[must_use]
pub fn release_pins() -> Option<BundlePins> {
    // `build.rs` embeds the crate's `bundles.json` when the release wrote one.
    const PINS: Option<&str> = include!(concat!(env!("OUT_DIR"), "/pins.rs"));
    PINS.and_then(|text| serde_json::from_str(text).ok())
}

/// The pinned bundle for `platform`, ready to run: from the cache when it is there and ready,
/// else installed. `MOSTRA_BUNDLE_MIRROR` replaces the release URL (files keep their names).
///
/// # Errors
///
/// `MOSTRA_ENV_BUNDLE_UNAVAILABLE` (offline without it, or no bundle for the platform),
/// `MOSTRA_ENV_BUNDLE_INVALID` (bytes, files or links that differ from the pins), or
/// `MOSTRA_ENV_BUNDLE_DOWNLOAD_FAILED` (the network, a proxy, the disk).
pub async fn install_pinned(
    pins: &BundlePins,
    platform: &str,
    env: &Environment,
    progress: &(dyn Fn(InstallStep) + Send + Sync),
) -> Result<Bundle> {
    let version = pins.version.as_str();
    let asset = pins
        .assets
        .iter()
        .find(|(name, _)| name.as_str() == platform)
        .map(|(_, asset)| asset)
        .ok_or_else(|| {
            unavailable(format!(
                "Mostra {version} has no runtime bundle for {platform}."
            ))
        })?;
    // Checked before any I/O: the name becomes a path, the digest a directory.
    let expected_name = asset_name(version, platform);
    if asset.file.as_str() != expected_name
        || asset.sha256.len() != 64
        || !asset.sha256.chars().all(|c| c.is_ascii_hexdigit())
    {
        return Err(invalid(format!(
            "The pins name {} for {platform}, not Mostra {version}'s archive {expected_name}.",
            asset.file.as_str()
        )));
    }
    let bundles = cache_root(env).join("bundles");
    let dir = bundles.join(asset.sha256.as_str());
    if let Some(ready) = ready_at(&dir) {
        return Ok(ready);
    }
    if offline(env) {
        return Err(unavailable(format!(
            "Mostra {version}'s runtime bundle isn't in the cache ({}), and MOSTRA_OFFLINE keeps Mostra from fetching it.",
            dir.display()
        )));
    }
    create_private_dir(&bundles)?;
    progress(InstallStep::Lock);
    let lock = Lock::take(&bundles.join(format!("{}.lock", asset.sha256.as_str()))).await?;
    let outcome = async {
        if let Some(ready) = ready_at(&dir) {
            return Ok(ready);
        }
        sweep(&bundles);
        if dir.exists() {
            // A bundle whose setup didn't finish: only its own files decide a new download.
            // A Windows bundle's junctions are its setup's to make (D153).
            match read_bundle(&dir).and_then(|bundle| check_as_extracted(&bundle).map(|()| bundle))
            {
                Ok(bundle) => {
                    progress(InstallStep::Browser);
                    setup(&bundle, env).await?;
                    return read_bundle(&dir);
                }
                Err(error) if error.code() == "MOSTRA_ENV_BUNDLE_INVALID" => {
                    let _ = std::fs::remove_dir_all(&dir);
                }
                Err(error) => return Err(error),
            }
        }
        fetch_into(pins, asset, platform, &dir, &bundles, env, progress).await?;
        let bundle = read_bundle(&dir)?;
        progress(InstallStep::Browser);
        setup(&bundle, env).await?;
        read_bundle(&dir)
    }
    .await;
    // The lock is released when `lock` drops: here, or wherever a host gives up the install (a
    // `select!`, a timeout), so a dropped install never holds the next one up for an hour.
    drop(lock);
    outcome
}

fn ready_at(dir: &Path) -> Option<Bundle> {
    let bundle = read_bundle(dir).ok()?;
    read_setup(&bundle).map(|_| bundle)
}

fn create_private_dir(dir: &Path) -> Result<()> {
    let mut builder = std::fs::DirBuilder::new();
    builder.recursive(true);
    // On Windows the cache sits in the user's profile, whose access list admits only the user,
    // the system and administrators.
    #[cfg(unix)]
    std::os::unix::fs::DirBuilderExt::mode(&mut builder, 0o700);
    builder
        .create(dir)
        .map_err(|e| download_failed(format!("Couldn't create {}: {e}", dir.display())))
}

/// Renames `from` to `to`. On Windows a file an antivirus scan or the indexer holds for a moment
/// refuses the rename though nothing is wrong, so it is tried again with backoff for up to 3 s,
/// as the runtime's and the SDK's renames are (D150 item 8); a refusal that lasts is returned.
async fn rename_into_place(from: &Path, to: &Path) -> std::io::Result<()> {
    let deadline = std::time::Instant::now() + Duration::from_secs(3);
    let mut wait = Duration::from_millis(25);
    loop {
        match std::fs::rename(from, to) {
            Ok(()) => return Ok(()),
            Err(error)
                if cfg!(windows)
                    && error.kind() == std::io::ErrorKind::PermissionDenied
                    && !to.exists()
                    && std::time::Instant::now() < deadline =>
            {
                tokio::time::sleep(wait).await;
                wait = (wait * 2).min(Duration::from_millis(400));
            }
            Err(error) => return Err(error),
        }
    }
}

/// The bytes free on `dir`'s file system, when the system says.
#[cfg(unix)]
fn free_space(dir: &Path) -> Option<u64> {
    let stats = nix::sys::statvfs::statvfs(dir).ok()?;
    // `blocks_available` is a u32 on macOS and a u64 on Linux.
    #[allow(clippy::useless_conversion, reason = "u32 on macOS, u64 on Linux")]
    let free = u64::from(stats.blocks_available()).saturating_mul(stats.fragment_size());
    Some(free)
}

#[cfg(windows)]
fn free_space(dir: &Path) -> Option<u64> {
    crate::windows::free_space(dir)
}

/// Downloads, extracts and checks the archive, then renames it into `dir`.
async fn fetch_into(
    pins: &BundlePins,
    asset: &crate::wire::BundleAsset,
    platform: &str,
    dir: &Path,
    bundles: &Path,
    env: &Environment,
    progress: &(dyn Fn(InstallStep) + Send + Sync),
) -> Result<()> {
    let needed = asset.size.get() + asset.unpacked_size.get() + BROWSER_ALLOWANCE;
    if let Some(free) = free_space(bundles)
        && free < needed
    {
        #[allow(clippy::cast_precision_loss, reason = "a readable size")]
        let gib = |bytes: u64| format!("{:.1} GiB", bytes as f64 / 1024_f64.powi(3));
        return Err(download_failed(format!(
            "The runtime bundle needs about {} free in {}, and {} is free (the disk is full).",
            gib(needed),
            bundles.display(),
            gib(free)
        )));
    }
    let scratch = Scratch(bundles.join(format!(".tmp-{}-{}", std::process::id(), random_hex())));
    create_private_dir(&scratch.0)?;
    let scratch_dir = scratch.0.clone();
    let result = async {
        let scratch = &scratch_dir;
        let archive = scratch.join(asset.file.as_str());
        let base = env
            .get("MOSTRA_BUNDLE_MIRROR")
            .filter(|base| !base.is_empty())
            .cloned()
            .unwrap_or_else(|| pins.release.clone());
        let url = format!("{}/{}", base.trim_end_matches('/'), asset.file.as_str());
        crate::download::download(
            &url,
            &archive,
            asset.sha256.as_str(),
            asset.size.get(),
            env,
            &|received| {
                progress(InstallStep::Download {
                    received,
                    total: asset.size.get(),
                });
            },
        )
        .await?;
        progress(InstallStep::Extract);
        let root = scratch.join("root");
        let top = asset.file.trim_end_matches(".tar.gz").to_owned();
        let (archive_path, root_path) = (archive.clone(), root.clone());
        // A Windows archive holds no links (D153): one that does is refused.
        let links = !is_windows_bundle(platform);
        tokio::task::spawn_blocking(move || extract(&archive_path, &root_path, &top, links))
            .await
            .map_err(|e| download_failed(format!("Extracting the bundle failed: {e}")))??;
        let _ = std::fs::remove_file(&archive);
        let bundle = read_bundle(&root)?;
        if bundle.info.version.as_str() != pins.version.as_str()
            || bundle.info.platform.as_str() != platform
        {
            return Err(invalid(format!(
                "The archive holds Mostra {} for {}, not {} for {platform}.",
                bundle.info.version.as_str(),
                bundle.info.platform,
                pins.version.as_str()
            )));
        }
        progress(InstallStep::Files);
        let checking = bundle.clone();
        tokio::task::spawn_blocking(move || check_as_extracted(&checking))
            .await
            .map_err(|e| invalid(format!("Checking the bundle failed: {e}")))??;
        match rename_into_place(&root, dir).await {
            Ok(()) => Ok(()),
            // Another installer finished first: its directory, checked before its rename, is used.
            Err(_) if dir.exists() => Ok(()),
            Err(error) => Err(download_failed(format!(
                "Couldn't move the bundle into {}: {error}",
                dir.display()
            ))),
        }
    }
    .await;
    drop(scratch);
    result
}

/// A scratch directory, removed when it drops: after the rename, after a failure, or when a host
/// gives up the install part-way (its PID is alive, so `sweep` wouldn't take it).
struct Scratch(PathBuf);

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn random_hex() -> String {
    let nanos = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let mut hasher = Sha256::new();
    hasher.update(nanos.to_le_bytes());
    hasher.update(std::process::id().to_le_bytes());
    hex(&hasher.finalize()[..6])
}

/// Extracts `archive` (a `.tar.gz` with one top directory `top`) into `into`, which must not
/// exist: only regular files, directories and (when `links`) symbolic links, all under `top`,
/// nothing written through a link. The tree is checked against `files.json` afterwards.
fn extract(archive: &Path, into: &Path, top: &str, links: bool) -> Result<()> {
    let file = std::fs::File::open(archive)
        .map_err(|e| download_failed(format!("Couldn't read the archive: {e}")))?;
    let mut tar = tar::Archive::new(flate2::read::GzDecoder::new(file));
    std::fs::create_dir(into).map_err(|e| download_failed(format!("Couldn't extract: {e}")))?;
    let unreadable = |e: std::io::Error| {
        invalid(format!(
            "The runtime bundle's archive couldn't be read: {e}"
        ))
    };
    for entry in tar.entries().map_err(unreadable)? {
        let mut entry = entry.map_err(unreadable)?;
        let kind = entry.header().entry_type();
        let path = entry.path().map_err(unreadable)?.into_owned();
        let display = path.display().to_string();
        let mut components = path.components();
        let inside = matches!(components.next(), Some(Component::Normal(first)) if first == top);
        let rest: PathBuf = components.collect();
        let plain = rest
            .components()
            .all(|component| matches!(component, Component::Normal(_)));
        if !inside || !plain {
            return Err(invalid(format!(
                "The runtime bundle's archive holds an entry outside its directory: {display}."
            )));
        }
        if rest.as_os_str().is_empty() {
            continue;
        }
        let dest = into.join(&rest);
        // Nothing is written through a link: every parent is a real directory under `into`.
        let mut parent = into.to_path_buf();
        for component in rest.parent().into_iter().flat_map(Path::components) {
            parent.push(component);
            match std::fs::symlink_metadata(&parent) {
                Ok(meta) if meta.is_dir() => {}
                Ok(_) => {
                    return Err(invalid(format!(
                        "The runtime bundle's archive writes through a link: {display}."
                    )));
                }
                Err(_) => std::fs::create_dir(&parent)
                    .map_err(|e| download_failed(format!("Couldn't extract {display}: {e}")))?,
            }
        }
        let written =
            |e: std::io::Error| download_failed(format!("Couldn't extract {display}: {e}"));
        if kind.is_dir() {
            match std::fs::symlink_metadata(&dest) {
                Ok(meta) if meta.is_dir() => {}
                Ok(_) => {
                    return Err(invalid(format!(
                        "{display} is both a directory and a file."
                    )));
                }
                Err(_) => std::fs::create_dir(&dest).map_err(written)?,
            }
        } else if kind.is_file() {
            let mode = entry.header().mode().map_err(unreadable)?;
            let mut out = std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&dest)
                .map_err(written)?;
            std::io::copy(&mut entry, &mut out).map_err(written)?;
            set_mode(&out, mode).map_err(written)?;
        } else if kind.is_symlink() && links {
            let target = entry
                .link_name()
                .map_err(unreadable)?
                .ok_or_else(|| invalid(format!("{display} is a link without a target.")))?;
            make_link(&target, &dest).map_err(written)?;
        } else {
            return Err(invalid(format!(
                "The runtime bundle's archive holds an entry a bundle never has: {display} ({kind:?})."
            )));
        }
    }
    Ok(())
}

/// A file's mode as the archive says, 0755 or 0644 (POSIX); Windows keeps no execute bit.
#[cfg(unix)]
fn set_mode(file: &std::fs::File, mode: u32) -> std::io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    file.set_permissions(std::fs::Permissions::from_mode(if mode & 0o100 == 0 {
        0o644
    } else {
        0o755
    }))
}

#[cfg(not(unix))]
fn set_mode(_file: &std::fs::File, _mode: u32) -> std::io::Result<()> {
    Ok(())
}

/// A symbolic link from an archive (POSIX bundles only: a Windows archive holds none, D153).
#[cfg(unix)]
fn make_link(target: &Path, at: &Path) -> std::io::Result<()> {
    std::os::unix::fs::symlink(target, at)
}

#[cfg(not(unix))]
fn make_link(_target: &Path, _at: &Path) -> std::io::Result<()> {
    Err(std::io::Error::other(
        "a Windows bundle's links are made by its setup",
    ))
}

/// Removes scratch directories an interrupted install left, when their process is gone.
fn sweep(bundles: &Path) {
    let Ok(entries) = std::fs::read_dir(bundles) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        let Some(rest) = name.strip_prefix(".tmp-") else {
            continue;
        };
        let pid = rest
            .split('-')
            .next()
            .and_then(|pid| pid.parse::<i32>().ok());
        if pid.is_some_and(|pid| !alive(pid)) {
            let _ = std::fs::remove_dir_all(entry.path());
        }
    }
}

#[cfg(unix)]
fn alive(pid: i32) -> bool {
    match nix::sys::signal::kill(nix::unistd::Pid::from_raw(pid), None) {
        Ok(()) | Err(nix::errno::Errno::EPERM) => true,
        Err(_) => false,
    }
}

#[cfg(windows)]
fn alive(pid: i32) -> bool {
    u32::try_from(pid).is_ok_and(crate::windows::process_alive)
}

/// Which file an open file is: its device and inode on POSIX; on Windows its volume's serial
/// number and its file index (`GetFileInformationByHandle`), which the standard library keeps
/// unstable. Creation times can't stand in: NTFS gives a file made under a name just deleted the
/// old file's creation time (tunneling), which a lock file another installer made a moment later
/// would then share.
#[cfg(unix)]
fn file_id(file: &std::fs::File) -> Option<(u64, u64)> {
    use std::os::unix::fs::MetadataExt as _;
    file.metadata().ok().map(|meta| (meta.dev(), meta.ino()))
}

#[cfg(windows)]
fn file_id(file: &std::fs::File) -> Option<(u64, u64)> {
    crate::windows::file_id(file)
}

/// The install lock, shared with `@mostra/sdk`'s installer (D142 item 4): an exclusive create
/// holding the owner's PID and a token. A lock whose owner is gone, or untouched for an hour, is
/// taken over: it is judged through one descriptor, moved aside, and removed only if the file moved
/// is the one judged (a fresh lock another installer took meanwhile is put back), so two
/// installers never both take one over (Opus review of WP-12, finding 10). The holder touches the
/// lock every minute, so an install that runs longer than an hour is never taken from a live
/// owner. It only saves a second download: the scratch directory and its rename keep the cache
/// correct whatever happens to it.
struct Lock {
    path: PathBuf,
    token: String,
    refresh: tokio::task::JoinHandle<()>,
}

/// How often a held lock is touched.
const LOCK_TOUCH: Duration = Duration::from_mins(1);

impl Lock {
    async fn take(path: &Path) -> Result<Self> {
        use std::io::Write as _;
        let token = random_hex();
        loop {
            match std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(path)
            {
                Ok(mut file) => {
                    let _ = writeln!(file, "{} {token}", std::process::id());
                    let touched = path.to_path_buf();
                    let mine = token.clone();
                    let refresh = tokio::spawn(async move {
                        loop {
                            tokio::time::sleep(LOCK_TOUCH).await;
                            let held = std::fs::read_to_string(&touched)
                                .is_ok_and(|text| text.contains(&mine));
                            if !held {
                                return;
                            }
                            if let Ok(file) = std::fs::OpenOptions::new().write(true).open(&touched)
                            {
                                let _ = file.set_modified(SystemTime::now());
                            }
                        }
                    });
                    return Ok(Self {
                        path: path.to_path_buf(),
                        token,
                        refresh,
                    });
                }
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
                Err(error) => {
                    return Err(download_failed(format!(
                        "Couldn't take the install lock {}: {error}",
                        path.display()
                    )));
                }
            }
            if Self::take_over_if_stale(path) {
                continue;
            }
            tokio::time::sleep(Duration::from_millis(250)).await;
        }
    }

    /// Removes the lock at `path` when it is stale and says whether it did (or it was gone).
    fn take_over_if_stale(path: &Path) -> bool {
        match Self::judge(path) {
            Judged::Gone => true,
            Judged::Live => false,
            Judged::Stale(id) => {
                Self::remove_judged(path, &id);
                true
            }
        }
    }

    /// Reads and judges the lock through one descriptor.
    fn judge(path: &Path) -> Judged {
        let Ok(mut file) = std::fs::File::open(path) else {
            return Judged::Gone;
        };
        let (Ok(meta), Some(id)) = (file.metadata(), file_id(&file)) else {
            return Judged::Live;
        };
        let mut text = String::new();
        let _ = file.read_to_string(&mut text);
        drop(file);
        let old = meta
            .modified()
            .ok()
            .and_then(|at| at.elapsed().ok())
            .is_some_and(|age| age > STALE_LOCK);
        let owner = text
            .split_whitespace()
            .next()
            .and_then(|pid| pid.parse::<i32>().ok());
        if old || owner.is_some_and(|pid| pid > 0 && !alive(pid)) {
            Judged::Stale(id)
        } else {
            Judged::Live
        }
    }

    /// Moves the lock aside and removes it only if it is the file `judged` describes: a fresh lock
    /// another installer took since is put back, unless a newer one exists.
    fn remove_judged(path: &Path, judged: &(u64, u64)) {
        let aside = path.with_extension(format!("lock.stale-{}", random_hex()));
        if std::fs::rename(path, &aside).is_err() {
            return; // someone else moved or removed it
        }
        let moved = std::fs::File::open(&aside)
            .ok()
            .and_then(|file| file_id(&file));
        if moved.is_some_and(|moved| moved != *judged) {
            let _ = std::fs::hard_link(&aside, path);
        }
        let _ = std::fs::remove_file(&aside);
    }
}

/// What a lock was judged to be.
enum Judged {
    Gone,
    Live,
    /// Stale, and which file was judged (`file_id`).
    Stale((u64, u64)),
}

impl Drop for Lock {
    /// Released by moving it aside and removing it only if it is still this holder's own (a
    /// takeover replaced it otherwise), so a release never removes another installer's lock.
    fn drop(&mut self) {
        self.refresh.abort();
        let aside = self
            .path
            .with_extension(format!("lock.done-{}", random_hex()));
        if std::fs::rename(&self.path, &aside).is_err() {
            return;
        }
        let mine = std::fs::read_to_string(&aside).is_ok_and(|text| text.contains(&self.token));
        if !mine {
            let _ = std::fs::hard_link(&aside, &self.path);
        }
        let _ = std::fs::remove_file(&aside);
    }
}

#[cfg(test)]
mod lock_tests {
    use super::{Judged, Lock};
    use std::time::{Duration, SystemTime};

    /// A dead process's ID, for a lock whose owner is gone.
    fn dead_pid() -> u32 {
        let mut child = std::process::Command::new("true").spawn().unwrap();
        let pid = child.id();
        child.wait().unwrap();
        pid
    }

    /// Two installers judge one stale lock; the first takes it over and takes its own lock; the
    /// second's move must not remove that fresh lock (Opus review of WP-12, finding 10).
    #[test]
    fn a_takeover_never_removes_a_fresh_lock() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("digest.lock");
        std::fs::write(&path, format!("{} dead\n", dead_pid())).unwrap();
        let Judged::Stale(judged_by_second) = Lock::judge(&path) else {
            panic!("a lock of a dead owner is stale");
        };
        // The first installer takes it over and creates its own (a new file).
        let Judged::Stale(judged_by_first) = Lock::judge(&path) else {
            panic!("stale");
        };
        Lock::remove_judged(&path, &judged_by_first);
        std::fs::write(&path, format!("{} fresh\n", std::process::id())).unwrap();
        // The second installer acts on its old judgement.
        Lock::remove_judged(&path, &judged_by_second);
        assert_eq!(
            std::fs::read_to_string(&path).unwrap(),
            format!("{} fresh\n", std::process::id()),
            "the fresh lock was removed"
        );
        let left: Vec<_> = std::fs::read_dir(dir.path()).unwrap().flatten().collect();
        assert_eq!(left.len(), 1, "an aside file was left");
    }

    /// A held lock is touched while its install runs, so it never looks an hour old; a release
    /// leaves a lock that isn't its own (Opus review of WP-12, finding 10).
    #[tokio::test(start_paused = true)]
    async fn a_held_lock_stays_fresh_and_releases_only_itself() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("digest.lock");
        let lock = Lock::take(&path).await.unwrap();
        let old = SystemTime::now() - Duration::from_hours(2);
        std::fs::File::options()
            .write(true)
            .open(&path)
            .unwrap()
            .set_modified(old)
            .unwrap();
        assert!(matches!(Lock::judge(&path), Judged::Stale(_)));
        tokio::time::sleep(super::LOCK_TOUCH + Duration::from_secs(1)).await;
        for _ in 0..50 {
            tokio::task::yield_now().await;
        }
        assert!(
            matches!(Lock::judge(&path), Judged::Live),
            "the lock wasn't touched"
        );
        // Another installer's lock replaced it (a takeover): releasing leaves that one.
        std::fs::remove_file(&path).unwrap();
        std::fs::write(&path, "1 another\n").unwrap();
        drop(lock);
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "1 another\n");
    }
}
