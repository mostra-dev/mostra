//! The crate against real instances of the runtime this checkout builds (HO-03): spawn and attach,
//! typed calls through the generated wire types, an event stream that resumes by name, a port
//! answered on the connection, and the home lock between the two process models.
//!
//! Needs `packages/runtime/dist` (`pnpm --filter @mostra/runtime build`) and Node.js on `PATH`;
//! without them every test here is skipped with a note, so `cargo test` stays usable alone. CI's
//! `rust` job builds the runtime first and sets `MOSTRA_HOST_REQUIRE_RUNTIME=1`, which turns a
//! missing runtime into a failure.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use mostra_host::ports::{Identity, Person, PortError};
use mostra_host::wire::{self, methods};
use mostra_host::{EventStreamOptions, Mostra, Options, PublishOptions, WaitOptions};
use serde_json::{Value, json};

fn runtime() -> Option<PathBuf> {
    let entry = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../packages/runtime/dist/bin.js");
    if entry.exists() {
        return Some(entry);
    }
    assert!(
        std::env::var("MOSTRA_HOST_REQUIRE_RUNTIME").is_err(),
        "MOSTRA_HOST_REQUIRE_RUNTIME is set, but {} wasn't built",
        entry.display()
    );
    eprintln!(
        "skipped: build @mostra/runtime first ({} is missing)",
        entry.display()
    );
    None
}

struct Fixture {
    _dir: tempfile::TempDir,
    home: PathBuf,
    source: PathBuf,
    env: BTreeMap<String, String>,
}

/// A home, a runtime directory short enough for a socket, and a one-file artifact.
fn fixture() -> Option<Fixture> {
    let entry = runtime()?;
    let dir = tempfile::Builder::new()
        .prefix("mh")
        .tempdir_in("/tmp")
        .unwrap();
    let home = dir.path().join("home");
    let run = dir.path().join("run");
    std::fs::create_dir_all(&run).unwrap();
    let source = dir.path().join("artifact");
    std::fs::create_dir_all(&source).unwrap();
    std::fs::write(
        source.join("page.tsx"),
        "export default function Page() {\n  return <h1>Hello from the Rust crate</h1>;\n}\n",
    )
    .unwrap();
    let mut env: BTreeMap<String, String> = std::env::vars()
        .filter(|(name, _)| !name.starts_with("MOSTRA_") && !name.starts_with("npm_config_"))
        .collect();
    env.insert(
        "MOSTRA_RUNTIME_BIN".into(),
        entry.to_string_lossy().into_owned(),
    );
    env.insert(
        "MOSTRA_RUNTIME_DIR".into(),
        run.to_string_lossy().into_owned(),
    );
    env.insert(
        "MOSTRA_CONFIG_DIR".into(),
        dir.path().join("config").to_string_lossy().into_owned(),
    );
    // Verify is proven by its own suites; these publish without its browser (D138, loud).
    env.insert("MOSTRA_TEST_UNVERIFIED_PUBLISH".into(), "1".into());
    Some(Fixture {
        _dir: dir,
        home,
        source,
        env,
    })
}

fn options(fixture: &Fixture) -> Options {
    Options::new(&fixture.home)
        .client("mostra-host-tests", "0")
        .env(fixture.env.clone())
}

#[tokio::test(flavor = "multi_thread")]
#[allow(
    clippy::too_many_lines,
    reason = "one end-to-end story: spawn, call, stream, resume"
)]
async fn a_spawned_instance_answers_typed_calls_and_resumes_a_named_event_stream() {
    let Some(fixture) = fixture() else { return };
    let mostra = Mostra::spawn(options(&fixture)).await.unwrap();
    assert_eq!(mostra.revision(), "2026-10-10");
    assert_eq!(mostra.instance().mode.as_str(), "host");
    assert_eq!(
        Path::new(&mostra.instance().home),
        fixture.home.canonicalize().unwrap()
    );
    assert!(
        mostra
            .capabilities()
            .ports
            .iter()
            .any(|port| port.as_str() == "identity")
    );

    let receipt = mostra
        .publish(&fixture.source.join("page.tsx"), PublishOptions::default())
        .await
        .unwrap();
    assert!(
        receipt
            .url
            .as_deref()
            .is_some_and(|url| url.contains("#t="))
    );
    let artifact = receipt.artifact_id.to_string();
    let detail = mostra
        .call::<methods::ArtifactGet>(
            &serde_json::from_value(json!({ "artifact": { "artifactId": artifact } })).unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(detail.versions.len(), 1);

    // A wait that times out loses nothing and says where to wait from next.
    let waited = mostra
        .wait(
            artifact.as_str(),
            "state:done",
            WaitOptions {
                timeout: Some(Duration::from_millis(0)),
                ..WaitOptions::default()
            },
        )
        .await
        .unwrap();
    assert!(matches!(waited, wire::WaitResult::StillWaiting { .. }));

    // A named stream sees state changes in order, acknowledges what it handled, and a later
    // stream of the same name resumes after it.
    let filter: wire::EventFilter =
        serde_json::from_value(json!({ "types": ["state.changed"] })).unwrap();
    let mut events = mostra.events(EventStreamOptions {
        filter: Some(filter.clone()),
        name: Some("rust-host".into()),
        ..EventStreamOptions::default()
    });
    let first = tokio::spawn(async move {
        let page = events.next().await.unwrap().unwrap();
        (events, page)
    });
    tokio::time::sleep(Duration::from_millis(300)).await;
    let patched = mostra
        .patch_state(
            artifact.as_str(),
            json!([{ "id": "count", "value": 1 }]),
            "mut_01JB8Z3QF6S7W3N8D5K2C4V9XA",
            None,
        )
        .await
        .unwrap();
    assert_eq!(patched.revision.as_str(), "1");
    let (mut events, page) = tokio::time::timeout(Duration::from_secs(10), first)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(page.events.len(), 1);
    assert_eq!(page.events[0].type_, "state.changed");
    // Asking for the next page acknowledges this one; then the stream ends.
    let next = tokio::time::timeout(Duration::from_millis(300), events.next()).await;
    assert!(next.is_err(), "no second page yet");
    events.close().await.unwrap();
    mostra
        .patch_state(
            artifact.as_str(),
            json!([{ "id": "count", "value": 2 }]),
            "mut_01JB8Z3QF6S7W3N8D5K2C4V9XB",
            None,
        )
        .await
        .unwrap();
    let mut resumed = mostra.events(EventStreamOptions {
        filter: Some(filter),
        name: Some("rust-host".into()),
        ..EventStreamOptions::default()
    });
    let page = tokio::time::timeout(Duration::from_secs(10), resumed.next())
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    let values: Vec<Value> = page
        .events
        .iter()
        .map(|event| event.payload["changes"][0]["value"].clone())
        .collect();
    assert_eq!(
        values,
        vec![json!(2)],
        "resumes after the acknowledged page, no repeat"
    );
    resumed.close().await.unwrap();

    let state = mostra.get_state(artifact.as_str()).await.unwrap();
    assert_eq!(state.fields["count"].value, json!(2));
    // Closing ends the instance through its stdin, at once: never by the SIGTERM that follows a
    // 10 s grace (the writer used to outlive the close, keeping stdin open).
    let closing = std::time::Instant::now();
    let exit = mostra.close().await.unwrap();
    assert_eq!(exit.and_then(|exit| exit.code), Some(0));
    assert!(
        closing.elapsed() < Duration::from_secs(5),
        "the instance took {:?} to stop",
        closing.elapsed()
    );
    let after = mostra.get_state(artifact.as_str()).await.unwrap_err();
    assert_eq!(after.code(), "MOSTRA_HOST_CONNECTION_CLOSED");
    assert!(mostra.close().await.unwrap().is_none(), "a second close");
}

struct Names(Arc<Mutex<Vec<wire::PortIdentityResolveParams>>>);

impl Identity for Names {
    async fn resolve(
        &self,
        request: wire::PortIdentityResolveParams,
    ) -> Result<Option<Person>, PortError> {
        let user = request.headers.get("x-forwarded-user").cloned();
        self.0.lock().unwrap().push(request);
        Ok(user.map(|user| Person::new(user).named("Ada")))
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn a_port_trait_answers_the_instance_on_the_same_connection() {
    let Some(fixture) = fixture() else { return };
    let seen = Arc::new(Mutex::new(Vec::new()));
    let mostra = Mostra::spawn(options(&fixture).identity(Names(Arc::clone(&seen))))
        .await
        .unwrap();
    assert!(mostra.warnings().is_empty(), "{:?}", mostra.warnings());
    let receipt = mostra
        .publish(&fixture.source.join("page.tsx"), PublishOptions::default())
        .await
        .unwrap();
    let link = mostra
        .view_url(receipt.artifact_id.as_str(), serde_json::Map::new())
        .await
        .unwrap();
    let url = reqwest::Url::parse(&link.url).unwrap();
    let secret = url.fragment().unwrap().trim_start_matches("t=").to_owned();
    let origin = url.origin().ascii_serialization();
    // The test's own client: plain HTTP to loopback, but reqwest wants a provider to build.
    let _ = rustls::crypto::ring::default_provider().install_default();
    let client = reqwest::Client::new();
    let exchange = client
        .post(format!("{origin}{}/_mostra/session", url.path()))
        .header("origin", &origin)
        .header("content-type", "application/json")
        .header("sec-fetch-site", "same-origin")
        .header("x-forwarded-user", "ada@example.com")
        .body(json!({ "token": secret }).to_string())
        .send()
        .await
        .unwrap();
    assert_eq!(exchange.status().as_u16(), 200);
    let seen = seen.lock().unwrap().clone();
    assert_eq!(seen.len(), 1);
    assert_eq!(seen[0].via.as_str(), "local");
    assert_eq!(seen[0].headers["x-forwarded-user"], "ada@example.com");
    assert!(!seen[0].headers.contains_key("cookie"));
    mostra.close().await.unwrap();
}

#[tokio::test(flavor = "multi_thread")]
async fn attach_starts_the_daemon_once_and_a_spawn_then_meets_its_lock() {
    let Some(fixture) = fixture() else { return };
    let first = Mostra::attach(options(&fixture)).await.unwrap();
    assert_eq!(first.instance().mode.as_str(), "daemon");
    let second = Mostra::attach(options(&fixture)).await.unwrap();
    assert_eq!(
        first.instance().pid,
        second.instance().pid,
        "one supervisor per home"
    );
    assert_eq!(first.socket(), second.socket());

    let locked = Mostra::spawn(options(&fixture)).await.unwrap_err();
    assert_eq!(locked.code(), "MOSTRA_HOME_LOCKED", "{locked}");

    second.close().await.unwrap();
    first
        .call_raw("mostra/shutdown", json!({}), Some(Duration::from_secs(10)))
        .await
        .unwrap();
    let reason = tokio::time::timeout(Duration::from_secs(10), first.closed())
        .await
        .unwrap();
    assert!(!reason.is_empty());
}

/// An attach that starts the daemon passes on its bind and URL host (D99), and a handle dropped
/// without `close()` still ends its session, so the daemon stops counting (and calling) a host
/// that is gone (GPT review of WP-12, findings 4 and 5).
#[tokio::test(flavor = "multi_thread")]
async fn attach_starts_the_daemon_with_its_bind_and_a_dropped_handle_leaves() {
    let Some(fixture) = fixture() else { return };
    let first = Mostra::attach(options(&fixture).bind("127.0.0.1", Some("localhost".into())))
        .await
        .unwrap();
    let receipt = first
        .publish(&fixture.source.join("page.tsx"), PublishOptions::default())
        .await
        .unwrap();
    let link = first
        .view_url(receipt.artifact_id.as_str(), serde_json::Map::new())
        .await
        .unwrap();
    assert!(
        link.url.as_str().starts_with("http://localhost:"),
        "the daemon's links use the URL host the attach asked for: {}",
        link.url.as_str()
    );
    let watcher = Mostra::attach(options(&fixture)).await.unwrap();
    let connections = |status: &Value| status["connections"].as_u64().unwrap_or_default();
    let status = watcher
        .call_raw("instance/status", json!({}), None)
        .await
        .unwrap();
    assert_eq!(status["gateway"]["bind"], "127.0.0.1");
    assert_eq!(connections(&status), 2);
    drop(first);
    let mut left = false;
    for _ in 0..50 {
        let status = watcher
            .call_raw("instance/status", json!({}), None)
            .await
            .unwrap();
        if connections(&status) == 1 {
            left = true;
            break;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    assert!(left, "the dropped handle's session stayed open");
    watcher
        .call_raw("mostra/shutdown", json!({}), Some(Duration::from_secs(10)))
        .await
        .unwrap();
}
