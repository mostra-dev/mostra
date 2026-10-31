//! A host's handle on its Mostra instance (HO-03, D45, D59): spawned over stdio
//! (`mostra-runtime host`, living as long as the handle) or attached to the home's daemon over
//! its socket (started when none runs). Either way one session: `mostra/initialize` with the
//! host's ports and home settings, typed calls for every method, and the instance's port calls
//! answered on the same connection.
//!
//! ```no_run
//! # async fn run() -> mostra_host::Result<()> {
//! use mostra_host::{Mostra, Options};
//!
//! let mostra = Mostra::spawn(Options::new("/var/lib/my-host/mostra").client("my-host", "1.0.0")).await?;
//! let receipt = mostra.publish("/work/inbox", Default::default()).await?;
//! let outcome = mostra
//!     .wait(receipt.artifact_id.as_str(), "submitted", Default::default())
//!     .await?;
//! mostra.close().await?;
//! # Ok(()) }
//! ```

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};

use crate::bundle::{Environment, InstallStep};
use crate::error::{Error, Result};
use crate::events::{EventStream, EventStreamOptions};
use crate::ports::{Addressing, Drafts, Identity, PortSet, Secrets, Submissions, TrustedControls};
use crate::rpc::Peer;
use crate::runtime::{Runtime, RuntimeOptions, resolve_runtime};
use crate::wire::{
    self, CapabilityLink, Diagnostic, InstanceCapabilities, InstanceInfo, Method, MutationResult,
    PublishReceipt, Results, StateGetResult, VerifyVerdict, WaitResult,
};

/// A callback for the instance's log lines.
type LogCallback = Arc<dyn Fn(&str) + Send + Sync>;

/// The host protocol revisions this crate speaks, newest last (D59, D78).
pub const REVISIONS: &[&str] = &["2026-10-10"];

/// The notifications this crate accepts.
const NOTIFICATIONS: &[&str] = &["events/notify", "artifact/progress"];

/// How long a daemon this crate starts may take to say where it listens.
const START_TIMEOUT: Duration = Duration::from_secs(30);

/// Options of [`Mostra::spawn`] and [`Mostra::attach`].
#[derive(Clone)]
pub struct Options {
    home: PathBuf,
    client: (String, String),
    ports: PortSet,
    expect_ports: bool,
    settings: serde_json::Map<String, Value>,
    runtime: RuntimeOptions,
    bind: Option<String>,
    url_host: Option<String>,
    on_log: Option<LogCallback>,
}

impl std::fmt::Debug for Options {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Options")
            .field("home", &self.home)
            .field("client", &self.client)
            .field("ports", &self.ports.names())
            .finish_non_exhaustive()
    }
}

impl Options {
    /// Options for the host's own home (D45), created 0700 by the instance when missing.
    pub fn new(home: impl Into<PathBuf>) -> Self {
        let env: Environment = std::env::vars().collect();
        Self {
            home: home.into(),
            client: (
                "mostra-host".to_owned(),
                env!("CARGO_PKG_VERSION").to_owned(),
            ),
            ports: PortSet::default(),
            expect_ports: true,
            settings: serde_json::Map::new(),
            runtime: RuntimeOptions {
                env,
                ..RuntimeOptions::default()
            },
            bind: None,
            url_host: None,
            on_log: None,
        }
    }

    /// Who the host is. The name owns its deliveries across restarts (D105): keep it stable.
    #[must_use]
    pub fn client(mut self, name: impl Into<String>, version: impl Into<String>) -> Self {
        self.client = (name.into(), version.into());
        self
    }

    /// Serves the `identity` port (D143).
    #[must_use]
    pub fn identity(mut self, port: impl Identity) -> Self {
        self.ports.identity(port);
        self
    }

    /// Serves the `addressing` port (HO-10, D158 item 6).
    #[must_use]
    pub fn addressing(mut self, port: impl Addressing) -> Self {
        self.ports.addressing(port);
        self
    }

    /// Serves the `submissions` port (D58, D105).
    #[must_use]
    pub fn submissions(mut self, port: impl Submissions) -> Self {
        self.ports.submissions(port);
        self
    }

    /// Serves the `drafts` port (IN-06).
    #[must_use]
    pub fn drafts(mut self, port: impl Drafts) -> Self {
        self.ports.drafts(port);
        self
    }

    /// Serves the `trustedControls` port (D108).
    #[must_use]
    pub fn trusted_controls(mut self, port: impl TrustedControls) -> Self {
        self.ports.trusted_controls(port);
        self
    }

    /// Serves the `secrets` port (D131).
    #[must_use]
    pub fn secrets(mut self, port: impl Secrets) -> Self {
        self.ports.secrets(port);
        self
    }

    /// Whether the registered ports are recorded as ports this host always provides, so
    /// submissions made while it is away wait for it (D105). Default `true`.
    #[must_use]
    pub fn expect_ports(mut self, expect: bool) -> Self {
        self.expect_ports = expect;
        self
    }

    /// A home setting of `HomeConfig` (`submission`, `submitChannels`, `dependencies`), kept in
    /// the home's `config.json` for every later client.
    #[must_use]
    pub fn setting(mut self, name: &str, value: Value) -> Self {
        self.settings.insert(name.to_owned(), value);
        self
    }

    /// An extracted runtime bundle to use instead of the pinned one.
    #[must_use]
    pub fn bundle(mut self, root: impl Into<PathBuf>) -> Self {
        self.runtime.bundle = Some(root.into());
        self
    }

    /// The instance's environment (default: this process's). Proxies, the cache and the bundle
    /// variables are read from it too, never silently from this process.
    #[must_use]
    pub fn env(mut self, env: Environment) -> Self {
        self.runtime.env = env;
        self
    }

    /// The gateway's bind address and the host name its URLs use (D99); loopback by default.
    #[must_use]
    pub fn bind(mut self, address: impl Into<String>, url_host: Option<String>) -> Self {
        self.bind = Some(address.into());
        self.url_host = url_host;
        self
    }

    /// Each line the instance logs (JSON, on its stderr), for a spawned instance.
    #[must_use]
    pub fn on_log(mut self, callback: impl Fn(&str) + Send + Sync + 'static) -> Self {
        self.on_log = Some(Arc::new(callback));
        self
    }

    /// Progress of the first download or setup of the runtime bundle.
    #[must_use]
    pub fn on_progress(mut self, callback: impl Fn(InstallStep) + Send + Sync + 'static) -> Self {
        self.runtime.progress = Some(Arc::new(callback));
        self
    }

    /// A port handler that failed or panicked: the instance got `MOSTRA_HOST_INTERNAL_ERROR`
    /// and will retry where its rules say so. Called with the method and the failure.
    #[must_use]
    pub fn on_port_error(mut self, callback: impl Fn(&str, &str) + Send + Sync + 'static) -> Self {
        self.ports.on_error(Arc::new(callback));
        self
    }

    fn home(&self) -> PathBuf {
        let home = if self.home.is_absolute() {
            self.home.clone()
        } else {
            std::env::current_dir().unwrap_or_default().join(&self.home)
        };
        // A symlinked home is the same home (D82): the instance compares real paths, spelled as
        // the system's own APIs spell them (no `\\?\` prefix on Windows).
        home.canonicalize()
            .map(crate::bundle::plain_path)
            .unwrap_or(home)
    }
}

/// How the instance ended, for a spawned one.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct InstanceExit {
    /// Its exit code: 0 after a clean stop.
    pub code: Option<i32>,
}

enum Connection {
    Spawned(Arc<tokio::sync::Mutex<Option<Child>>>),
    Attached,
}

/// An artifact or source: an ID (`art_…`) or a path (made absolute against the working
/// directory). Paths keep naming a deleted source's artifact (INTERFACES §6).
#[derive(Debug, Clone)]
pub struct Target(Value);

impl Target {
    fn reference(&self) -> Value {
        self.0.clone()
    }
}

impl From<&str> for Target {
    fn from(value: &str) -> Self {
        if value.starts_with("art_") {
            Self(json!({ "artifactId": value }))
        } else {
            Self::from(Path::new(value))
        }
    }
}

impl From<&String> for Target {
    fn from(value: &String) -> Self {
        Self::from(value.as_str())
    }
}

impl From<&Path> for Target {
    fn from(path: &Path) -> Self {
        let absolute = if path.is_absolute() {
            path.to_path_buf()
        } else {
            std::env::current_dir().unwrap_or_default().join(path)
        };
        Self(json!({ "path": absolute.to_string_lossy() }))
    }
}

impl From<&PathBuf> for Target {
    fn from(path: &PathBuf) -> Self {
        Self::from(path.as_path())
    }
}

/// Options of [`Mostra::publish`].
#[derive(Debug, Clone, Default)]
pub struct PublishOptions {
    /// Publish despite verify's errors, recording them (D41).
    pub force: bool,
    /// The submission policy this publish names (D102), as the protocol's JSON.
    pub policy: Option<Value>,
    /// A request ID: a retry with the same parameters returns the recorded receipt (H-03).
    pub request_id: Option<String>,
}

/// Options of [`Mostra::wait`].
#[derive(Debug, Clone, Default)]
pub struct WaitOptions {
    /// Wait for what happens after this cursor (default: the artifact's latest publish).
    pub after: Option<String>,
    /// How long to wait; `None` waits as long as the protocol allows.
    pub timeout: Option<Duration>,
}

/// A host's session with its instance.
pub struct Mostra {
    peer: Peer,
    session: wire::MostraInitializeResult,
    connection: Connection,
    runtime: Option<Runtime>,
    socket: Option<PathBuf>,
}

impl std::fmt::Debug for Mostra {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Mostra")
            .field("instance", &self.session.instance)
            .finish_non_exhaustive()
    }
}

fn initialize_params(options: &Options) -> Value {
    let ports = options.ports.names();
    let mut home = options.settings.clone();
    home.insert(
        "path".into(),
        Value::String(options.home().to_string_lossy().into_owned()),
    );
    // What this host always provides, an empty list included: a host that stopped serving a port
    // clears the record, so its absence is never awaited (Opus review of WP-12, finding 7).
    if options.expect_ports {
        home.insert("ports".into(), json!(ports));
    }
    json!({
        "client": { "name": options.client.0, "version": options.client.1 },
        "revisions": REVISIONS,
        "capabilities": { "notifications": NOTIFICATIONS },
        "ports": ports,
        "home": home,
    })
}

impl Mostra {
    /// Spawns `mostra-runtime host --home <home>` on the resolved runtime and opens the session.
    /// The instance lives as long as this handle: [`Mostra::close`] ends it, and so does this
    /// process exiting (its stdin closes).
    ///
    /// # Errors
    ///
    /// The instance's own diagnostic when it can't start (`MOSTRA_HOME_LOCKED`,
    /// `MOSTRA_PLATFORM_UNSUPPORTED` …), or the runtime's (`MOSTRA_ENV_BUNDLE_*`).
    ///
    /// # Panics
    ///
    /// Never: the child's pipes are requested before they are taken.
    pub async fn spawn(options: Options) -> Result<Self> {
        let runtime = resolve_runtime(&options.runtime).await?;
        let home = options.home();
        let mut args: Vec<std::ffi::OsString> = vec![
            "host".into(),
            "--home".into(),
            home.clone().into_os_string(),
        ];
        if let Some(bind) = &options.bind {
            args.extend(["--bind".into(), bind.into()]);
        }
        if let Some(url_host) = &options.url_host {
            args.extend(["--url-host".into(), url_host.into()]);
        }
        let mut command = runtime.command(args);
        command
            .env_clear()
            .envs(crate::bundle::child_environment(&options.runtime.env))
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        // A Windows host with no console of its own (a desktop app) opens no window for it.
        #[cfg(windows)]
        command.creation_flags(crate::bundle::CREATE_NO_WINDOW);
        let mut child = command.spawn().map_err(|e| {
            Error::new(
                "MOSTRA_ENV_RUNTIME_MISSING",
                format!("The Mostra runtime couldn't be started: {e}"),
            )
        })?;
        let stdin = child.stdin.take().expect("piped");
        let stdout = child.stdout.take().expect("piped");
        let stderr = child.stderr.take().expect("piped");
        let tail = Arc::new(Mutex::new(Vec::<String>::new()));
        let on_log = options.on_log.clone();
        let keep = Arc::clone(&tail);
        tokio::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                if let Some(callback) = &on_log {
                    let callback = Arc::clone(callback);
                    let line = line.clone();
                    // A callback that panics is the host's own failure; Mostra's work goes on.
                    let _ =
                        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| callback(&line)));
                }
                let mut tail = keep
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner);
                tail.push(line);
                if tail.len() > 20 {
                    tail.remove(0);
                }
            }
        });
        let peer = Peer::start(stdout, stdin, Arc::new(options.ports.clone()));
        let child = Arc::new(tokio::sync::Mutex::new(Some(child)));
        match Self::open(&peer, &options).await {
            Ok(session) => Ok(Self {
                peer,
                session,
                connection: Connection::Spawned(child),
                runtime: Some(runtime),
                socket: None,
            }),
            Err(error) => {
                stop(&child, Duration::from_secs(2)).await;
                Err(error)
            }
        }
    }

    /// Attaches to the home's daemon over its socket, starting `mostra-runtime daemon` when none
    /// runs (it attaches itself when another starter won), and opens the session. The daemon
    /// outlives this handle; ports registered here are called only while it is open.
    ///
    /// # Errors
    ///
    /// The daemon's start diagnostic (`MOSTRA_HOME_LOCKED`, `MOSTRA_PLATFORM_UNSUPPORTED` …), the
    /// runtime's, or `MOSTRA_HOST_CONNECTION_CLOSED` when its socket can't be reached.
    ///
    /// # Panics
    ///
    /// Never: a stream exists once the daemon's socket was reached.
    pub async fn attach(options: Options) -> Result<Self> {
        let home = options.home();
        let mut runtime = None;
        let mut socket = recorded_socket(&home);
        let mut stream = match &socket {
            Some(path) => connect(path).await.ok(),
            None => None,
        };
        if stream.is_none() {
            let resolved = resolve_runtime(&options.runtime).await?;
            let started = start_daemon(&resolved, &home, &options).await?;
            stream = Some(connect(&started).await?);
            socket = Some(started);
            runtime = Some(resolved);
        }
        let (reader, writer) = stream.expect("connected above");
        // A Windows pipe has no half-close: closing the session drops both halves (D153).
        #[cfg(windows)]
        let peer = Peer::start_whole(reader, writer, Arc::new(options.ports.clone()));
        #[cfg(not(windows))]
        let peer = Peer::start(reader, writer, Arc::new(options.ports.clone()));
        let session = Self::open(&peer, &options).await;
        match session {
            Ok(session) => Ok(Self {
                peer,
                session,
                connection: Connection::Attached,
                runtime,
                socket,
            }),
            Err(error) => {
                peer.close("The session couldn't open.");
                Err(error)
            }
        }
    }

    async fn open(peer: &Peer, options: &Options) -> Result<wire::MostraInitializeResult> {
        let result = peer
            .call("mostra/initialize", initialize_params(options), None)
            .await?;
        serde_json::from_value(result).map_err(|e| {
            Error::new(
                "MOSTRA_HOST_INTERNAL_ERROR",
                format!("The instance's mostra/initialize answer doesn't read: {e}"),
            )
        })
    }

    /// The instance: release, home, platform, PID and mode.
    #[must_use]
    pub fn instance(&self) -> &InstanceInfo {
        &self.session.instance
    }

    /// What the instance serves.
    #[must_use]
    pub fn capabilities(&self) -> &InstanceCapabilities {
        &self.session.capabilities
    }

    /// The negotiated host protocol revision.
    #[must_use]
    pub fn revision(&self) -> &str {
        self.session.revision.as_str()
    }

    /// The session's warnings (an unsupported port, for example).
    #[must_use]
    pub fn warnings(&self) -> &[Diagnostic] {
        &self.session.warnings
    }

    /// The runtime this handle spawned or started, when it did.
    #[must_use]
    pub fn runtime(&self) -> Option<&Runtime> {
        self.runtime.as_ref()
    }

    /// The control socket an attached handle reached.
    #[must_use]
    pub fn socket(&self) -> Option<&Path> {
        self.socket.as_deref()
    }

    /// Calls any method by its definition, with its typed params and result.
    ///
    /// # Errors
    ///
    /// The instance's diagnostic, `MOSTRA_HOST_CONNECTION_CLOSED`, or
    /// `MOSTRA_HOST_INTERNAL_ERROR` when the answer doesn't read as the method's result.
    pub async fn call<M: Method>(&self, params: &M::Params) -> Result<M::Result> {
        let params = serde_json::to_value(params)
            .map_err(|e| Error::new("MOSTRA_HOST_INVALID_PARAMS", format!("{}: {e}", M::NAME)))?;
        let result = self.call_raw(M::NAME, params, None).await?;
        decode::<M::Result>(M::NAME, result)
    }

    /// Calls a method by name with JSON params, giving up after `timeout` (`MOSTRA_HOST_TIMEOUT`).
    ///
    /// # Errors
    ///
    /// As [`Mostra::call`].
    pub async fn call_raw(
        &self,
        method: &str,
        params: Value,
        timeout: Option<Duration>,
    ) -> Result<Value> {
        self.peer.call(method, params, timeout).await
    }

    async fn typed<T: serde::de::DeserializeOwned>(
        &self,
        method: &str,
        params: Value,
    ) -> Result<T> {
        decode(method, self.call_raw(method, params, None).await?)
    }

    /// `artifact/publish`: verifies (D41) and publishes; durable before it returns (H-07).
    ///
    /// # Errors
    ///
    /// `MOSTRA_PUBLISH_VERIFY_FAILED` and the other publish diagnostics.
    pub async fn publish(
        &self,
        source: impl Into<Target>,
        options: PublishOptions,
    ) -> Result<PublishReceipt> {
        let mut params = json!({ "source": source.into().reference() });
        if options.force {
            params["force"] = Value::Bool(true);
        }
        if let Some(policy) = options.policy {
            params["policy"] = policy;
        }
        if let Some(id) = options.request_id {
            params["requestId"] = Value::String(id);
        }
        self.typed("artifact/publish", params).await
    }

    /// `artifact/verify`: one verdict, never a publish (D138).
    ///
    /// # Errors
    ///
    /// The instance's diagnostics.
    pub async fn verify(&self, source: impl Into<Target>) -> Result<VerifyVerdict> {
        self.typed(
            "artifact/verify",
            json!({ "source": source.into().reference() }),
        )
        .await
    }

    /// `wait` (IN-10, D103): until `until` holds (`submitted`, `signal:<name>`,
    /// `state:<field>`, `event:<type>`) or the timeout passes; `still_waiting` carries the cursor
    /// to wait from next, and loses nothing.
    ///
    /// # Errors
    ///
    /// `MOSTRA_SUBMIT_POLICY_NONE` for `submitted` under policy `none`, and the connection's.
    pub async fn wait(
        &self,
        artifact: impl Into<Target>,
        until: &str,
        options: WaitOptions,
    ) -> Result<WaitResult> {
        let timeout_ms = options.timeout.map_or(2_147_483_647, |limit| {
            u64::try_from(limit.as_millis())
                .unwrap_or(u64::MAX)
                .min(2_147_483_647)
        });
        let mut params = json!({
            "artifact": artifact.into().reference(),
            "until": until,
            "timeoutMs": timeout_ms,
        });
        if let Some(after) = options.after {
            params["after"] = Value::String(after);
        }
        self.typed("wait", params).await
    }

    /// `results/get` as JSON: one submission, by default the latest (INTERFACES §8).
    ///
    /// # Errors
    ///
    /// The instance's diagnostics.
    pub async fn results(
        &self,
        artifact: impl Into<Target>,
        submission: Option<&str>,
    ) -> Result<Results> {
        let mut params = json!({ "artifact": artifact.into().reference(), "format": "json" });
        if let Some(id) = submission {
            params["submission"] = Value::String(id.to_owned());
        }
        self.typed("results/get", params).await
    }

    /// `results/get` as Markdown, for an agent to read.
    ///
    /// # Errors
    ///
    /// The instance's diagnostics.
    pub async fn results_markdown(
        &self,
        artifact: impl Into<Target>,
        submission: Option<&str>,
    ) -> Result<String> {
        let mut params = json!({ "artifact": artifact.into().reference(), "format": "md" });
        if let Some(id) = submission {
            params["submission"] = Value::String(id.to_owned());
        }
        let answer = self.call_raw("results/get", params, None).await?;
        Ok(answer["markdown"].as_str().unwrap_or_default().to_owned())
    }

    /// `state/get`: artifact-scoped fields (D63).
    ///
    /// # Errors
    ///
    /// The instance's diagnostics.
    pub async fn get_state(&self, artifact: impl Into<Target>) -> Result<StateGetResult> {
        self.typed(
            "state/get",
            json!({ "artifact": artifact.into().reference() }),
        )
        .await
    }

    /// `state/patch`: writes artifact-scoped fields through compare-and-set (D63). `ops` are the
    /// protocol's field operations; `mutation_id` makes a retry replay its result.
    ///
    /// # Errors
    ///
    /// The instance's diagnostics.
    pub async fn patch_state(
        &self,
        artifact: impl Into<Target>,
        ops: Value,
        mutation_id: &str,
        base_revision: Option<&str>,
    ) -> Result<MutationResult> {
        let mut params = json!({
            "artifact": artifact.into().reference(),
            "ops": ops,
            "mutationId": mutation_id,
            "as": "host",
        });
        if let Some(base) = base_revision {
            params["baseRevision"] = Value::String(base.to_owned());
        }
        self.typed("state/patch", params).await
    }

    /// `view/url`: a new capability link (D97); `params` adds `scopes`, `ttl`, `viewer` or
    /// `version`.
    ///
    /// # Errors
    ///
    /// The instance's diagnostics.
    pub async fn view_url(
        &self,
        artifact: impl Into<Target>,
        params: serde_json::Map<String, Value>,
    ) -> Result<CapabilityLink> {
        let mut all = params;
        all.insert("artifact".into(), artifact.into().reference());
        self.typed("view/url", Value::Object(all)).await
    }

    /// The events matching `options.filter`, page by page, in cursor order (`events/subscribe`).
    #[must_use]
    pub fn events(&self, options: EventStreamOptions) -> EventStream {
        EventStream::open(&self.peer, options)
    }

    /// Resolves when the connection to the instance has closed, with why.
    pub fn closed(&self) -> impl std::future::Future<Output = String> + Send + 'static {
        self.peer.closed()
    }

    /// Ends the session. A spawned instance is stopped: its stdin closes, it is sent SIGTERM if
    /// it hasn't exited within 10 s, and SIGKILL 5 s later (on Windows, which has no signals
    /// between processes, it is ended after the 10 s, D150 item 6). An attached daemon keeps
    /// running.
    /// It takes `&self`, so a host that shares its handle (`Arc<Mostra>`) can close it while
    /// other tasks hold it: their calls in flight, and any later ones, end with
    /// `MOSTRA_HOST_CONNECTION_CLOSED`. A second close returns `None`.
    ///
    /// # Errors
    ///
    /// Never for the instance's own exit; reserved for later releases.
    pub async fn close(&self) -> Result<Option<InstanceExit>> {
        self.peer.close("The host closed the session.");
        match &self.connection {
            Connection::Spawned(child) => Ok(stop(child, Duration::from_secs(10)).await),
            Connection::Attached => Ok(None),
        }
    }
}

impl Drop for Mostra {
    /// A handle dropped without [`Mostra::close`] still ends its session, so an attached daemon
    /// stops calling ports nobody serves. A spawned instance is stopped as `close` would, in a
    /// task, when a Tokio runtime is there to run it; otherwise it is killed with its handle.
    fn drop(&mut self) {
        self.peer.close("The host dropped its handle.");
        if let Connection::Spawned(child) = &self.connection
            && let Ok(handle) = tokio::runtime::Handle::try_current()
        {
            let child = Arc::clone(child);
            handle.spawn(async move {
                stop(&child, Duration::from_secs(10)).await;
            });
        }
    }
}

fn decode<T: serde::de::DeserializeOwned>(method: &str, value: Value) -> Result<T> {
    serde_json::from_value(value).map_err(|e| {
        Error::new(
            "MOSTRA_HOST_INTERNAL_ERROR",
            format!("The answer to {method} doesn't read as its result: {e}"),
        )
    })
}

/// Stops a spawned instance: stdin is already closed by the peer, which stops it (D87, D150
/// item 6); SIGTERM after `grace`, and it is killed 5 s later (on Windows at once, after
/// `grace`: no signal reaches another process there).
async fn stop(child: &tokio::sync::Mutex<Option<Child>>, grace: Duration) -> Option<InstanceExit> {
    let mut guard = child.lock().await;
    let mut child = guard.take()?;
    drop(child.stdin.take());
    if let Ok(Ok(status)) = tokio::time::timeout(grace, child.wait()).await {
        return Some(InstanceExit {
            code: status.code(),
        });
    }
    #[cfg(unix)]
    {
        if let Some(pid) = child.id().and_then(|pid| i32::try_from(pid).ok()) {
            let _ = nix::sys::signal::kill(
                nix::unistd::Pid::from_raw(pid),
                nix::sys::signal::Signal::SIGTERM,
            );
        }
        if let Ok(Ok(status)) = tokio::time::timeout(Duration::from_secs(5), child.wait()).await {
            return Some(InstanceExit {
                code: status.code(),
            });
        }
    }
    let _ = child.kill().await;
    child.wait().await.ok().map(|status| InstanceExit {
        code: status.code(),
    })
}

/// `DETACHED_PROCESS` and `CREATE_NEW_PROCESS_GROUP`: a daemon with no console, which a console's
/// Ctrl+C doesn't reach.
#[cfg(windows)]
const DETACHED_PROCESS: u32 = 0x0000_0008;
#[cfg(windows)]
const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;

/// The root of the file system `path` is on (`/`, `C:\\`), which always exists.
fn file_system_root(path: &Path) -> PathBuf {
    path.ancestors()
        .last()
        .map_or_else(|| PathBuf::from("/"), Path::to_path_buf)
}

/// The socket `instance.json` records (D81), if the file exists and reads.
fn recorded_socket(home: &Path) -> Option<PathBuf> {
    let text = std::fs::read_to_string(home.join("instance.json")).ok()?;
    let record: Value = serde_json::from_str(&text).ok()?;
    record["socket"].as_str().map(PathBuf::from)
}

/// The two halves of a connection to a home's control endpoint.
type Halves = (
    Box<dyn tokio::io::AsyncRead + Send + Unpin>,
    Box<dyn tokio::io::AsyncWrite + Send + Unpin>,
);

/// Connects to the control endpoint `instance.json` names: the home's Unix socket.
#[cfg(unix)]
async fn connect(socket: &Path) -> Result<Halves> {
    match tokio::time::timeout(
        Duration::from_secs(5),
        tokio::net::UnixStream::connect(socket),
    )
    .await
    {
        Ok(Ok(stream)) => {
            let (reader, writer) = stream.into_split();
            Ok((Box::new(reader), Box::new(writer)))
        }
        Ok(Err(error)) => Err(Error::closed(format!(
            "The instance's socket {} can't be reached ({error}).",
            socket.display()
        ))),
        Err(_) => Err(Error::closed(format!(
            "The instance's socket {} didn't answer within 5 s.",
            socket.display()
        ))),
    }
}

/// `SECURITY_IDENTIFICATION`: the pipe's server may learn who the client is, never act as it.
#[cfg(windows)]
const SECURITY_IDENTIFICATION: u32 = 0x0001_0000;

/// `ERROR_PIPE_BUSY`: every instance of the pipe is taken for a moment.
#[cfg(windows)]
const ERROR_PIPE_BUSY: i32 = 231;

/// Connects to the control endpoint `instance.json` names: the home's named pipe on Windows,
/// opened so its server can't act as this process (`SECURITY_IDENTIFICATION`), and refused
/// unless its owner is this user, before a byte is sent: another user may create a pipe under a
/// name `instance.json` still names while no instance serves it (D150 item 4, D151 item 2), as
/// `mostra-win connect` refuses it for the TypeScript clients.
#[cfg(windows)]
async fn connect(pipe: &Path) -> Result<Halves> {
    use std::os::windows::io::AsRawHandle as _;
    let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
    let client = loop {
        match tokio::net::windows::named_pipe::ClientOptions::new()
            .security_qos_flags(SECURITY_IDENTIFICATION)
            .open(pipe)
        {
            Ok(client) => break client,
            Err(error)
                if error.raw_os_error() == Some(ERROR_PIPE_BUSY)
                    && tokio::time::Instant::now() < deadline =>
            {
                tokio::time::sleep(Duration::from_millis(50)).await;
            }
            Err(error) => {
                return Err(Error::closed(format!(
                    "The instance's pipe {} can't be reached ({error}).",
                    pipe.display()
                )));
            }
        }
    };
    match crate::windows::owned_by_current_user(client.as_raw_handle()) {
        Ok(true) => {}
        Ok(false) => {
            return Err(Error::closed(format!(
                "The instance's pipe {} belongs to another user, so it isn't this home's.",
                pipe.display()
            )));
        }
        Err(error) => {
            return Err(Error::closed(format!(
                "The owner of the instance's pipe {} can't be read ({error}).",
                pipe.display()
            )));
        }
    }
    let (reader, writer) = tokio::io::split(client);
    Ok((Box::new(reader), Box::new(writer)))
}

/// The variables whose values are paths, as the runtime, the SDK and the CLI read them; the
/// CLI's list (`packages/cli/src/detached.ts`, which a test there keeps complete).
const PATH_VARIABLES: &[&str] = &[
    "MOSTRA_HOME",
    "MOSTRA_RUNTIME_DIR",
    "MOSTRA_CONFIG_DIR",
    "MOSTRA_CACHE_DIR",
    "MOSTRA_BUNDLE",
    "MOSTRA_RUNTIME_BIN",
    "MOSTRA_SHELL_DIR",
    "MOSTRA_WARM_DIR",
    "MOSTRA_WORKER_ENTRY",
    "MOSTRA_VERIFY_ENTRY",
    "MOSTRA_WIN_HELPER",
    "MOSTRA_TEST_WORKER_HOST",
    "MOSTRA_TEST_BUNDLE_PINS",
    "MOSTRA_TAILSCALE",
    "MOSTRA_CLOUDFLARED",
    "MOSTRA_TEST_TUNNELS",
];

/// `env` with every relative path variable made absolute against this process's directory, for
/// a daemon that runs in its file system's root (D151 item 3; GPT review of WP-W3).
fn detached_environment(env: &Environment) -> Environment {
    let mut out = env.clone();
    for name in PATH_VARIABLES {
        if let Some(value) = out.get_mut(*name)
            && !value.is_empty()
            && !Path::new(value.as_str()).is_absolute()
            && let Ok(absolute) = std::path::absolute(value.as_str())
        {
            *value = absolute.to_string_lossy().into_owned();
        }
    }
    out
}

/// Starts the home's daemon, detached, and reads the one line it prints: where it listens, or
/// why it couldn't start. A daemon another starter won prints `attached` and exits.
/// Starts the home's daemon with this handle's bind and URL host (D99: neither is remembered, so
/// they apply to the daemon this call starts; one already running keeps its own).
async fn start_daemon(runtime: &Runtime, home: &Path, options: &Options) -> Result<PathBuf> {
    let mut args: Vec<std::ffi::OsString> = vec![
        "daemon".into(),
        "--home".into(),
        home.as_os_str().to_owned(),
    ];
    if let Some(bind) = &options.bind {
        args.extend(["--bind".into(), bind.into()]);
    }
    if let Some(url_host) = &options.url_host {
        args.extend(["--url-host".into(), url_host.into()]);
    }
    let mut command: Command = runtime.command(args);
    command
        .env_clear()
        .envs(crate::bundle::child_environment(&detached_environment(
            &options.runtime.env,
        )))
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        // The daemon outlives this process by up to 30 idle minutes: it runs in its home's file
        // system root, never this process's directory, which Windows wouldn't let anyone rename
        // or remove while it runs (D151 item 3).
        .current_dir(file_system_root(home));
    #[cfg(unix)]
    command.process_group(0);
    // Detached from this process's console, in a console group of its own, as the CLI starts it.
    #[cfg(windows)]
    command.creation_flags(DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP);
    let mut child = command.spawn().map_err(|e| {
        Error::new(
            "MOSTRA_ENV_RUNTIME_MISSING",
            format!("The Mostra runtime couldn't be started: {e}"),
        )
    })?;
    let stdout = child.stdout.take().expect("piped");
    let read = async {
        let mut lines = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            if let Ok(parsed) = serde_json::from_str::<Value>(&line) {
                return Some(parsed);
            }
        }
        None
    };
    let line = tokio::time::timeout(START_TIMEOUT, read)
        .await
        .map_err(|_| {
            Error::new(
                "MOSTRA_HOST_TIMEOUT",
                "The home's daemon didn't start within 30 s.",
            )
        })?;
    // The daemon runs on in its own process group; tokio reaps it if it ever exits while this
    // process lives.
    drop(child);
    let Some(line) = line else {
        return Err(Error::closed(
            "The home's daemon exited before it said where it listens.",
        ));
    };
    if line["status"] == "failed" {
        return Err(
            match serde_json::from_value::<Diagnostic>(line["diagnostic"].clone()) {
                Ok(diagnostic) => Error::from_diagnostic(diagnostic, None),
                Err(_) => Error::new(
                    "MOSTRA_HOST_INTERNAL_ERROR",
                    "The home's daemon failed to start.",
                ),
            },
        );
    }
    line["socket"]
        .as_str()
        .map(PathBuf::from)
        .ok_or_else(|| Error::closed("The home's daemon didn't say where it listens."))
}

/// The control pipe's owner rule on Windows (D150 item 4, WP-W3): the crate talks only to a pipe
/// its own user owns.
#[cfg(all(test, windows))]
mod windows_tests {
    use std::io::BufRead as _;

    use super::{Path, connect};

    #[tokio::test]
    async fn connects_to_a_pipe_its_own_user_owns() {
        let name = format!(r"\\.\pipe\mostra-host-own-{}", std::process::id());
        let server = tokio::net::windows::named_pipe::ServerOptions::new()
            .first_pipe_instance(true)
            .create(&name)
            .unwrap();
        let serving = tokio::spawn(async move { server.connect().await.map(|()| server) });
        assert!(connect(Path::new(&name)).await.is_ok());
        serving.await.unwrap().unwrap();
    }

    #[tokio::test]
    async fn refuses_a_pipe_another_user_created_under_the_name() {
        let (Ok(user), Ok(password)) = (
            std::env::var("MOSTRA_TEST_OTHER_USER"),
            std::env::var("MOSTRA_TEST_OTHER_PASSWORD"),
        ) else {
            assert!(
                std::env::var("MOSTRA_HOST_REQUIRE_RUNTIME").is_err(),
                "CI names a second local user for this check"
            );
            eprintln!("skipped: no second local user (MOSTRA_TEST_OTHER_USER)");
            return;
        };
        let probe =
            Path::new(env!("CARGO_MANIFEST_DIR")).join("../../target/release/mostra-win-probe.exe");
        let name = format!("mostra-host-squat-{}", std::process::id());
        let mut squatter = std::process::Command::new(&probe)
            .args(["squat", &user, &password, &name])
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .spawn()
            .unwrap_or_else(|e| panic!("{}: {e}", probe.display()));
        let mut line = String::new();
        std::io::BufReader::new(squatter.stdout.take().unwrap())
            .read_line(&mut line)
            .unwrap();
        assert!(line.contains("\"ok\":true"), "the squatter said {line}");
        let refused = connect(Path::new(&format!(r"\\.\pipe\{name}")))
            .await
            .err()
            .expect("a pipe another user owns is refused");
        assert_eq!(refused.code(), "MOSTRA_HOST_CONNECTION_CLOSED");
        assert!(refused.message().contains("another user"), "{refused}");
        drop(squatter.stdin.take());
        squatter.wait().unwrap();
    }
}

#[cfg(test)]
mod path_variable_tests {
    use super::*;

    /// The daemon's path variables are the CLI's, which a test there keeps complete.
    #[test]
    fn the_path_variables_are_the_clis() {
        let cli = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../packages/cli/src/detached.ts");
        let Ok(text) = std::fs::read_to_string(&cli) else {
            return; // not a checkout (the packaged crate)
        };
        let start = text.find("PATH_VARIABLES").expect("the CLI's list");
        let end = start + text[start..].find("];").expect("its end");
        let theirs: Vec<&str> = text[start..end]
            .split('"')
            .filter(|part| part.starts_with("MOSTRA_"))
            .collect();
        assert_eq!(PATH_VARIABLES, theirs.as_slice());
    }

    #[test]
    fn a_relative_path_variable_is_made_absolute_and_nothing_else_changes() {
        let mut env = Environment::new();
        env.insert("MOSTRA_RUNTIME_BIN".into(), "rel/bin.js".into());
        env.insert("MOSTRA_HOME".into(), String::new());
        env.insert("OTHER".into(), "rel/kept".into());
        let out = detached_environment(&env);
        assert!(Path::new(&out["MOSTRA_RUNTIME_BIN"]).is_absolute());
        assert!(out["MOSTRA_RUNTIME_BIN"].ends_with("bin.js"));
        assert_eq!(out["MOSTRA_HOME"], "");
        assert_eq!(out["OTHER"], "rel/kept");
    }
}
