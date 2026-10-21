//! Which runtime a host runs (RT-01, D85, INTERFACES §16), in the SDK's order:
//!
//! 1. an extracted bundle the caller names, then `MOSTRA_BUNDLE`;
//! 2. `MOSTRA_RUNTIME_BIN`, a `mostra-runtime` entry (tests and development);
//! 3. the bundle this crate's release pins (`bundles.json`), from the cache or downloaded;
//! 4. a development checkout's built runtime beside this crate;
//!
//! else `MOSTRA_ENV_BUNDLE_UNAVAILABLE`. A bundle is checked before anything in it runs, and set
//! up when its marker doesn't match it. The platform gate comes first: macOS and glibc Linux on
//! arm64 and x64; anything else fails closed with `MOSTRA_PLATFORM_UNSUPPORTED` (D35, D120).

use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use crate::bundle::{self, Bundle, Environment, InstallStep};
use crate::error::{Error, Result};

/// The bundle platform of this machine (`darwin-arm64`, `linux-x64` …).
///
/// # Errors
///
/// `MOSTRA_PLATFORM_UNSUPPORTED` for Windows, other architectures and Linux without glibc.
pub fn platform() -> Result<&'static str> {
    let unsupported = |message: String| Error::new("MOSTRA_PLATFORM_UNSUPPORTED", message);
    let name = match (std::env::consts::OS, std::env::consts::ARCH) {
        ("macos", "aarch64") => "darwin-arm64",
        ("macos", "x86_64") => "darwin-x64",
        ("linux", "aarch64") => "linux-arm64",
        ("linux", "x86_64") => "linux-x64",
        (os, arch) => {
            return Err(unsupported(format!(
                "Mostra doesn't run on {os}-{arch}; it supports macOS and Linux on x64 and arm64."
            )));
        }
    };
    if name.starts_with("linux") {
        // The bundle's Node.js and browser need glibc: its dynamic loader is there, musl's isn't.
        let loader = if name == "linux-x64" {
            "/lib64/ld-linux-x86-64.so.2"
        } else {
            "/lib/ld-linux-aarch64.so.1"
        };
        if !Path::new(loader).exists() {
            return Err(unsupported(
                "Mostra's Linux bundle needs glibc, and this system has none (musl, as on Alpine Linux); it supports macOS and glibc-based Linux on x64 and arm64.".to_owned(),
            ));
        }
    }
    Ok(name)
}

/// How a runtime was found.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RuntimeSource {
    /// An extracted, checked bundle (named, or the pinned one from the cache).
    Bundle,
    /// `MOSTRA_RUNTIME_BIN`.
    Override,
    /// A development checkout's built runtime.
    Development,
}

/// A runtime to spawn.
#[derive(Debug, Clone)]
pub struct Runtime {
    /// How it was found.
    pub source: RuntimeSource,
    /// The bundle, when the runtime is one.
    pub bundle: Option<Bundle>,
    program: PathBuf,
    prefix: Vec<OsString>,
}

impl Runtime {
    /// `mostra-runtime <args…>` as a command on this runtime's Node.js.
    #[must_use]
    pub fn command<I, S>(&self, args: I) -> tokio::process::Command
    where
        I: IntoIterator<Item = S>,
        S: Into<OsString>,
    {
        let mut command = tokio::process::Command::new(&self.program);
        command.args(&self.prefix);
        command.args(args.into_iter().map(Into::into));
        command
    }

    fn of_bundle(bundle: Bundle) -> Self {
        Self {
            source: RuntimeSource::Bundle,
            program: bundle.node(),
            prefix: vec![bundle.runtime().into_os_string()],
            bundle: Some(bundle),
        }
    }

    /// A JavaScript entry runs on Node.js from `PATH`; anything else is run as it is.
    fn of_entry(source: RuntimeSource, entry: PathBuf) -> Self {
        let script = entry
            .extension()
            .is_some_and(|ext| ext == "js" || ext == "mjs" || ext == "cjs");
        if script {
            Self {
                source,
                bundle: None,
                program: PathBuf::from("node"),
                prefix: vec![entry.into_os_string()],
            }
        } else {
            Self {
                source,
                bundle: None,
                program: entry,
                prefix: Vec::new(),
            }
        }
    }
}

/// Options of [`resolve_runtime`].
#[derive(Clone, Default)]
pub struct RuntimeOptions {
    /// An extracted bundle to use, ahead of everything else.
    pub bundle: Option<PathBuf>,
    /// The environment: `MOSTRA_BUNDLE`, `MOSTRA_RUNTIME_BIN`, the cache's variables, proxies.
    pub env: Environment,
    /// Progress of a download or setup.
    pub progress: Option<Arc<dyn Fn(InstallStep) + Send + Sync>>,
}

impl std::fmt::Debug for RuntimeOptions {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("RuntimeOptions")
            .field("bundle", &self.bundle)
            .finish_non_exhaustive()
    }
}

/// A development checkout's runtime beside this crate: `packages/runtime/dist/bin.js`.
fn development() -> Option<PathBuf> {
    let entry = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../packages/runtime/dist/bin.js");
    entry
        .exists()
        .then(|| entry.canonicalize().unwrap_or(entry))
}

/// A named bundle, checked and set up when its marker doesn't match it.
async fn from_bundle(root: &Path, options: &RuntimeOptions) -> Result<Runtime> {
    let bundle = bundle::read_bundle(root)?;
    if bundle::read_setup(&bundle).is_none() {
        let progress = |step| {
            if let Some(progress) = &options.progress {
                progress(step);
            }
        };
        progress(InstallStep::Files);
        let checking = bundle.clone();
        tokio::task::spawn_blocking(move || bundle::check_files(&checking))
            .await
            .map_err(|e| Error::new("MOSTRA_ENV_BUNDLE_INVALID", e.to_string()))??;
        progress(InstallStep::Browser);
        bundle::setup(&bundle, &options.env).await?;
    }
    Ok(Runtime::of_bundle(bundle::read_bundle(root)?))
}

/// Finds the runtime to spawn, downloading and setting up the pinned bundle when nothing nearer
/// exists.
///
/// # Errors
///
/// `MOSTRA_PLATFORM_UNSUPPORTED`, `MOSTRA_ENV_RUNTIME_MISSING` (a `MOSTRA_RUNTIME_BIN` that
/// doesn't exist), `MOSTRA_ENV_BUNDLE_UNAVAILABLE`, `MOSTRA_ENV_BUNDLE_INVALID` or
/// `MOSTRA_ENV_BUNDLE_DOWNLOAD_FAILED`.
pub async fn resolve_runtime(options: &RuntimeOptions) -> Result<Runtime> {
    let platform = platform()?;
    let named = options.bundle.clone().or_else(|| {
        options
            .env
            .get("MOSTRA_BUNDLE")
            .filter(|path| !path.is_empty())
            .map(PathBuf::from)
    });
    if let Some(root) = named {
        return from_bundle(&root, options).await;
    }
    if let Some(entry) = options
        .env
        .get("MOSTRA_RUNTIME_BIN")
        .filter(|path| !path.is_empty())
    {
        let entry = PathBuf::from(entry);
        if !entry.exists() {
            return Err(Error::new(
                "MOSTRA_ENV_RUNTIME_MISSING",
                format!(
                    "MOSTRA_RUNTIME_BIN names {}, which doesn't exist.",
                    entry.display()
                ),
            ));
        }
        return Ok(Runtime::of_entry(RuntimeSource::Override, entry));
    }
    if let Some(pins) = bundle::release_pins() {
        let progress = options.progress.clone();
        let report = move |step| {
            if let Some(progress) = &progress {
                progress(step);
            }
        };
        let bundle = bundle::install_pinned(&pins, platform, &options.env, &report).await?;
        return Ok(Runtime::of_bundle(bundle));
    }
    if let Some(entry) = development() {
        return Ok(Runtime::of_entry(RuntimeSource::Development, entry));
    }
    Err(Error::new(
        "MOSTRA_ENV_BUNDLE_UNAVAILABLE",
        "This build of mostra-host pins no runtime bundle and has no runtime beside it; set MOSTRA_BUNDLE to an extracted bundle.",
    ))
}
