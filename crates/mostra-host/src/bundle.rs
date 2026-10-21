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

/// Where the cache is: `MOSTRA_CACHE_DIR`, else `~/Library/Caches/mostra` (macOS), else
/// `${XDG_CACHE_HOME:-~/.cache}/mostra`.
#[must_use]
pub fn cache_root(env: &Environment) -> PathBuf {
    if let Some(dir) = env.get("MOSTRA_CACHE_DIR").filter(|dir| !dir.is_empty()) {
        return PathBuf::from(dir);
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

/// The setup marker, when it describes exactly this bundle.
#[must_use]
pub fn read_setup(bundle: &Bundle) -> Option<BundleSetup> {
    let text = std::fs::read_to_string(bundle.root.join(SETUP_MARKER)).ok()?;
    let marker: BundleSetup = serde_json::from_str(&text).ok()?;
    let info = &bundle.info;
    (marker.files.as_str() == info.files.sha256.as_str()
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

/// Every file and link under `root` by `/`-separated path, skipping `skip`ped paths (and below).
fn walk(root: &Path, skip: &dyn Fn(&str) -> bool) -> std::io::Result<BTreeMap<String, Walked>> {
    use std::os::unix::fs::PermissionsExt;
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
                let target = std::fs::read_link(entry.path())?
                    .to_string_lossy()
                    .into_owned();
                out.insert(path, Walked::Link { target });
            } else if kind.is_file() {
                let mode = entry.metadata()?.permissions().mode();
                out.insert(
                    path,
                    Walked::File {
                        executable: mode & 0o100 != 0,
                    },
                );
            } else {
                out.insert(path, Walked::Other);
            }
        }
    }
    Ok(out)
}

/// Whether a link's target is relative and resolves inside the tree.
fn link_stays_inside(path: &str, target: &str) -> bool {
    if target.starts_with('/') {
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
/// its size, SHA-256 and execute bit; each link with its target, staying inside; nothing else
/// besides the setup extras. Reports at most 20 problems.
fn check_tree(root: &Path, manifest: &BundleFiles) -> std::io::Result<Vec<String>> {
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
    for (path, link) in &links {
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

/// Checks the bundle's files against `files.json`, which `bundle.json` pins by SHA-256.
///
/// # Errors
///
/// `MOSTRA_ENV_BUNDLE_INVALID` naming what differs.
pub fn check_files(bundle: &Bundle) -> Result<()> {
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
    let problems = check_tree(&bundle.root, &manifest).map_err(|e| {
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

/// Makes a checked bundle ready: runs its own `bin/mostra-setup --root <bundle>`, which fetches
/// and checks the verify browser and writes the setup marker (D142 item 2).
///
/// # Errors
///
/// The setup's own diagnostic (`MOSTRA_ENV_BUNDLE_DOWNLOAD_FAILED`, `MOSTRA_ENV_BUNDLE_INVALID`,
/// `MOSTRA_ENV_BUNDLE_UNAVAILABLE` offline), or `MOSTRA_ENV_RUNTIME_MISSING` when it can't run.
pub async fn setup(bundle: &Bundle, env: &Environment) -> Result<BundleSetup> {
    let program = bundle.root.join(bundle.info.entries.setup.as_str());
    let output = tokio::process::Command::new(&program)
        .arg("--root")
        .arg(&bundle.root)
        .env_clear()
        .envs(env)
        .stdin(std::process::Stdio::null())
        .output()
        .await
        .map_err(|e| {
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
            match read_bundle(&dir).and_then(|bundle| check_files(&bundle).map(|()| bundle)) {
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
    lock.release();
    outcome
}

fn ready_at(dir: &Path) -> Option<Bundle> {
    let bundle = read_bundle(dir).ok()?;
    read_setup(&bundle).map(|_| bundle)
}

fn create_private_dir(dir: &Path) -> Result<()> {
    use std::os::unix::fs::DirBuilderExt;
    std::fs::DirBuilder::new()
        .recursive(true)
        .mode(0o700)
        .create(dir)
        .map_err(|e| download_failed(format!("Couldn't create {}: {e}", dir.display())))
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
    if let Ok(stats) = nix::sys::statvfs::statvfs(bundles) {
        let free = u64::from(stats.blocks_available()) * stats.fragment_size();
        if free < needed {
            #[allow(clippy::cast_precision_loss, reason = "a readable size")]
            let gib = |bytes: u64| format!("{:.1} GiB", bytes as f64 / 1024_f64.powi(3));
            return Err(download_failed(format!(
                "The runtime bundle needs about {} free in {}, and {} is free (the disk is full).",
                gib(needed),
                bundles.display(),
                gib(free)
            )));
        }
    }
    let scratch = bundles.join(format!(".tmp-{}-{}", std::process::id(), random_hex()));
    create_private_dir(&scratch)?;
    let result = async {
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
        tokio::task::spawn_blocking(move || extract(&archive_path, &root_path, &top))
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
        tokio::task::spawn_blocking(move || check_files(&checking))
            .await
            .map_err(|e| invalid(format!("Checking the bundle failed: {e}")))??;
        match std::fs::rename(&root, dir) {
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
    let _ = std::fs::remove_dir_all(&scratch);
    result
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
/// exist: only regular files, directories and symbolic links, all under `top`, nothing written
/// through a link. The tree is checked against `files.json` afterwards.
fn extract(archive: &Path, into: &Path, top: &str) -> Result<()> {
    use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
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
                .mode(if mode & 0o100 == 0 { 0o644 } else { 0o755 })
                .open(&dest)
                .map_err(written)?;
            std::io::copy(&mut entry, &mut out).map_err(written)?;
            out.set_permissions(std::fs::Permissions::from_mode(if mode & 0o100 == 0 {
                0o644
            } else {
                0o755
            }))
            .map_err(written)?;
        } else if kind.is_symlink() {
            let target = entry
                .link_name()
                .map_err(unreadable)?
                .ok_or_else(|| invalid(format!("{display} is a link without a target.")))?;
            std::os::unix::fs::symlink(&target, &dest).map_err(written)?;
        } else {
            return Err(invalid(format!(
                "The runtime bundle's archive holds an entry a bundle never has: {display} ({kind:?})."
            )));
        }
    }
    Ok(())
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

fn alive(pid: i32) -> bool {
    match nix::sys::signal::kill(nix::unistd::Pid::from_raw(pid), None) {
        Ok(()) | Err(nix::errno::Errno::EPERM) => true,
        Err(_) => false,
    }
}

/// The install lock: an exclusive create holding the owner's PID and a token. A lock whose owner
/// is gone, or older than an hour, is taken over. It only saves a second download: the scratch
/// directory and its rename keep the cache correct whatever happens to it.
struct Lock {
    path: PathBuf,
    token: String,
}

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
                    return Ok(Self {
                        path: path.to_path_buf(),
                        token,
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
            if Self::stale(path) {
                let aside = path.with_extension(format!("stale-{}", random_hex()));
                if std::fs::rename(path, &aside).is_ok() {
                    let _ = std::fs::remove_file(&aside);
                }
                continue;
            }
            tokio::time::sleep(Duration::from_millis(250)).await;
        }
    }

    fn stale(path: &Path) -> bool {
        let Ok(meta) = std::fs::metadata(path) else {
            return true;
        };
        let old = meta
            .modified()
            .ok()
            .and_then(|at| at.elapsed().ok())
            .is_some_and(|age| age > STALE_LOCK);
        let owner = std::fs::read_to_string(path)
            .ok()
            .and_then(|text| text.split_whitespace().next()?.parse::<i32>().ok());
        old || owner.is_some_and(|pid| pid > 0 && !alive(pid))
    }

    fn release(self) {
        let mine = std::fs::read_to_string(&self.path).is_ok_and(|text| text.contains(&self.token));
        if mine {
            let _ = std::fs::remove_file(&self.path);
        }
    }
}
