//! The bundle manager against synthetic bundles (RT-01, RT-12, H-13, D142, D153): a pinned archive
//! installs into the digest-keyed cache once and is reused; bytes, files or links that differ from
//! the pins are refused with nothing installed; offline only the cache serves. A synthetic bundle
//! is shaped as its platform's are: on Windows its Node.js is the one running the tests, its
//! archive holds no links, and its setup makes them junctions.

use std::collections::BTreeMap;
use std::io::Write as _;
use std::path::{Path, PathBuf};

use mostra_host::bundle::{self, Environment};
use serde_json::json;
use sha2::{Digest, Sha256};

const VERSION: &str = "9.9.9";

fn platform() -> &'static str {
    mostra_host::runtime::platform().expect("tests run on a supported platform")
}

fn hex(bytes: &[u8]) -> String {
    use std::fmt::Write as _;
    bytes.iter().fold(String::new(), |mut out, byte| {
        let _ = write!(out, "{byte:02x}");
        out
    })
}

fn sha(bytes: &[u8]) -> String {
    hex(&Sha256::digest(bytes))
}

/// The synthetic setup entry: JavaScript, run on the bundle's own Node.js as the real setup is
/// (never executed itself, so it is no executable and has no `#!` line), which makes a Windows
/// bundle's junctions and writes the marker the way the real one does.
const SETUP: &str = r#"const fs = require("node:fs"), path = require("node:path");
const root = process.argv[process.argv.indexOf("--root") + 1];
if (process.env.TEST_SETUP_SLEEP) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Number(process.env.TEST_SETUP_SLEEP) * 1000);
const info = JSON.parse(fs.readFileSync(path.join(root, "bundle.json"), "utf8"));
const real = fs.realpathSync.native(root);
if (process.platform === "win32") {
  for (const link of JSON.parse(fs.readFileSync(path.join(root, "files.json"), "utf8")).links) {
    const at = path.join(real, link.path);
    fs.rmSync(at, { force: true, recursive: false });
    fs.symlinkSync(path.resolve(path.dirname(at), link.target), at, "junction");
  }
}
fs.writeFileSync(path.join(root, ".mostra-setup.json"), JSON.stringify({ schemaVersion: 1, version: info.version, platform: info.platform, files: info.files.sha256, browser: { revision: "1" }, at: "2026-10-21T00:00:00.000Z", root: real }));
console.log(JSON.stringify({ status: "ok" }));
"#;

/// The synthetic bundle's Node.js: a launcher of the `node` on `PATH` (POSIX), or that Node.js
/// itself (Windows, which runs no script as a program).
fn node() -> (&'static str, Vec<u8>, bool) {
    if cfg!(windows) {
        let path = std::env::var_os("PATH").unwrap_or_default();
        let node = std::env::split_paths(&path)
            .map(|dir| dir.join("node.exe"))
            .find(|candidate| candidate.is_file())
            .expect("the Windows tests need Node.js on PATH");
        ("node/node.exe", std::fs::read(node).unwrap(), false)
    } else {
        (
            "node/bin/node",
            b"#!/bin/sh\nexec node \"$@\"\n".to_vec(),
            true,
        )
    }
}

/// A synthetic bundle's files.
fn files() -> Vec<(&'static str, Vec<u8>, bool)> {
    vec![
        ("lib/setup.js", SETUP.as_bytes().to_vec(), false),
        ("lib/runtime.js", b"// the runtime\n".to_vec(), false),
        ("lib/sub/x.js", b"// behind a link\n".to_vec(), false),
        node(),
    ]
}

/// Builds `mostra-<version>-<platform>.tar.gz`; `tamper` edits the tree after `files.json` is
/// written, `extra` adds tar entries (kind, path, link target).
fn archive(
    dir: &Path,
    tamper: impl Fn(&mut Vec<(&'static str, Vec<u8>, bool)>),
    links: &[(&str, &str)],
) -> (PathBuf, String, u64) {
    let top = format!("mostra-{VERSION}-{}", platform());
    let listed = files();
    let manifest = json!({
        "schemaVersion": 1,
        "files": listed.iter().map(|(path, bytes, executable)| json!({
            "path": path, "size": bytes.len(), "sha256": sha(bytes), "executable": executable,
        })).collect::<Vec<_>>(),
        "links": links.iter().map(|(path, target)| json!({ "path": path, "target": target })).collect::<Vec<_>>(),
    });
    let manifest_text = serde_json::to_vec_pretty(&manifest).unwrap();
    let info = json!({
        "schemaVersion": 1,
        "name": "mostra-runtime-bundle",
        "version": VERSION,
        "platform": platform(),
        "node": { "version": "24.21.0", "path": node().0 },
        "entries": { "runtime": "lib/runtime.js", "cli": "lib/runtime.js", "setup": "lib/setup.js" },
        "files": { "path": "files.json", "sha256": sha(&manifest_text) },
        "browser": {
            "name": "chromium-headless-shell", "revision": "1", "browserVersion": "1.0",
            "installer": "lib/runtime.js", "files": []
        }
    });
    let mut tree = listed;
    tamper(&mut tree);
    let name = format!("{top}.tar.gz");
    let path = dir.join(&name);
    let encoder = flate2::write::GzEncoder::new(
        std::fs::File::create(&path).unwrap(),
        flate2::Compression::fast(),
    );
    let mut tar = tar::Builder::new(encoder);
    let mut add = |path: &str, bytes: &[u8], mode: u32| {
        let mut header = tar::Header::new_gnu();
        header.set_size(bytes.len() as u64);
        header.set_mode(mode);
        header.set_cksum();
        tar.append_data(&mut header, format!("{top}/{path}"), bytes)
            .unwrap();
    };
    add("bundle.json", &serde_json::to_vec(&info).unwrap(), 0o644);
    add("files.json", &manifest_text, 0o644);
    for (file, bytes, executable) in &tree {
        add(file, bytes, if *executable { 0o755 } else { 0o644 });
    }
    // A Windows archive holds no links (D153), unless a test plants one (`plant_link`).
    for (link, target) in links.iter().filter(|_| !cfg!(windows) || plant_link()) {
        let mut header = tar::Header::new_gnu();
        header.set_entry_type(tar::EntryType::Symlink);
        header.set_size(0);
        header.set_mode(0o777);
        tar.append_link(&mut header, format!("{top}/{link}"), target)
            .unwrap();
    }
    tar.into_inner().unwrap().finish().unwrap().flush().unwrap();
    let bytes = std::fs::read(&path).unwrap();
    (path, sha(&bytes), bytes.len() as u64)
}

thread_local! {
    static PLANT: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
}

/// Whether the archive being built carries its links even on Windows (a tampered archive).
fn plant_link() -> bool {
    PLANT.with(std::cell::Cell::get)
}

/// A link the archive carries (a file's on POSIX, a directory's on Windows, as each platform's
/// bundles have them).
fn alias() -> (&'static str, &'static str) {
    if cfg!(windows) {
        ("lib/alias", "sub")
    } else {
        ("lib/alias.js", "runtime.js")
    }
}

fn pins(sha256: &str, size: u64) -> mostra_host::wire::BundlePins {
    let mut assets = serde_json::Map::new();
    assets.insert(
        platform().to_owned(),
        json!({
            "file": format!("mostra-{VERSION}-{}.tar.gz", platform()),
            "sha256": sha256, "size": size, "unpackedSize": 4096,
        }),
    );
    serde_json::from_value(json!({
        "schemaVersion": 1,
        "version": VERSION,
        "release": "https://example.invalid/never-used",
        "assets": assets,
    }))
    .unwrap()
}

fn env(cache: &Path, mirror: &Path) -> Environment {
    let mut env = BTreeMap::new();
    env.insert(
        "MOSTRA_CACHE_DIR".into(),
        cache.to_string_lossy().into_owned(),
    );
    env.insert(
        "MOSTRA_BUNDLE_MIRROR".into(),
        // The SDK's form: a file URL of the directory (`file:///C:/…` on Windows).
        url::Url::from_directory_path(mirror)
            .unwrap()
            .as_str()
            .trim_end_matches('/')
            .to_owned(),
    );
    env.insert("PATH".into(), std::env::var("PATH").unwrap_or_default());
    env
}

#[tokio::test]
async fn a_pinned_bundle_installs_once_into_the_digest_keyed_cache() {
    let work = tempfile::tempdir().unwrap();
    let (archive, digest, size) = archive(work.path(), |_| {}, &[alias()]);
    let cache = work.path().join("cache");
    let env = env(&cache, work.path());
    let steps = std::sync::Mutex::new(Vec::new());
    let installed = bundle::install_pinned(&pins(&digest, size), platform(), &env, &|step| {
        steps.lock().unwrap().push(format!("{step:?}"));
    })
    .await
    .unwrap();
    assert_eq!(installed.root, cache.join("bundles").join(&digest));
    assert!(
        bundle::read_setup(&installed).is_some(),
        "the bundle is ready"
    );
    let link = installed.root.join(alias().0);
    assert!(std::fs::symlink_metadata(&link).unwrap().is_symlink());
    if cfg!(windows) {
        // Its setup made it a junction into the bundle's own directory (D153).
        assert!(link.join("x.js").is_file());
    }
    let steps = steps.into_inner().unwrap();
    assert!(steps.iter().any(|step| step.starts_with("Download")));
    // Nothing is downloaded again: the mirror's archive is gone, the cache answers.
    std::fs::remove_file(&archive).unwrap();
    let again = bundle::install_pinned(&pins(&digest, size), platform(), &env, &|_| {})
        .await
        .unwrap();
    assert_eq!(again.root, installed.root);
    // Offline, the cache still answers; a bundle it lacks is MOSTRA_ENV_BUNDLE_UNAVAILABLE.
    let mut offline = env.clone();
    offline.insert("MOSTRA_OFFLINE".into(), "1".into());
    bundle::install_pinned(&pins(&digest, size), platform(), &offline, &|_| {})
        .await
        .unwrap();
    let missing =
        bundle::install_pinned(&pins(&"0".repeat(64), size), platform(), &offline, &|_| {})
            .await
            .unwrap_err();
    assert_eq!(missing.code(), "MOSTRA_ENV_BUNDLE_UNAVAILABLE");
}

#[tokio::test]
async fn bytes_files_or_links_that_differ_from_the_pins_install_nothing() {
    let work = tempfile::tempdir().unwrap();
    let cache = work.path().join("cache");
    let env = env(&cache, work.path());
    let bundles = cache.join("bundles");
    let leftovers = || {
        std::fs::read_dir(&bundles)
            .map(|dir| {
                dir.flatten()
                    .map(|e| e.file_name().to_string_lossy().into_owned())
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default()
            .into_iter()
            .filter(|name| {
                !std::path::Path::new(name)
                    .extension()
                    .is_some_and(|extension| extension.eq_ignore_ascii_case("lock"))
            })
            .collect::<Vec<_>>()
    };

    // An archive whose SHA-256 isn't the pinned one.
    let (_, digest, size) = archive(work.path(), |_| {}, &[]);
    let wrong = bundle::install_pinned(&pins(&"a".repeat(64), size), platform(), &env, &|_| {})
        .await
        .unwrap_err();
    assert_eq!(wrong.code(), "MOSTRA_ENV_BUNDLE_INVALID", "{wrong}");
    assert!(wrong.message().contains("SHA-256"));
    assert_eq!(leftovers(), Vec::<String>::new());
    // A size that isn't the pinned one.
    let short = bundle::install_pinned(&pins(&digest, size - 1), platform(), &env, &|_| {})
        .await
        .unwrap_err();
    assert_eq!(short.code(), "MOSTRA_ENV_BUNDLE_INVALID");

    // A pinned archive whose file differs from files.json: refused after extraction, before the
    // rename, and nothing is left in the cache.
    let (_, digest, size) = archive(
        work.path(),
        |tree| tree[1].1 = b"// changed after files.json\n".to_vec(),
        &[],
    );
    let tampered = bundle::install_pinned(&pins(&digest, size), platform(), &env, &|_| {})
        .await
        .unwrap_err();
    assert_eq!(tampered.code(), "MOSTRA_ENV_BUNDLE_INVALID");
    assert!(tampered.message().contains("lib/runtime.js"), "{tampered}");
    assert_eq!(leftovers(), Vec::<String>::new());

    // A link leaving the bundle (on Windows any link in the archive: a Windows archive holds none).
    PLANT.with(|plant| plant.set(true));
    let (_, digest, size) = archive(
        work.path(),
        |_| {},
        &[("lib/escape", "../../../etc/passwd")],
    );
    PLANT.with(|plant| plant.set(false));
    let escaping = bundle::install_pinned(&pins(&digest, size), platform(), &env, &|_| {})
        .await
        .unwrap_err();
    assert_eq!(escaping.code(), "MOSTRA_ENV_BUNDLE_INVALID");
    let why = if cfg!(windows) {
        "never has"
    } else {
        "outside"
    };
    assert!(escaping.message().contains(why), "{escaping}");
    assert_eq!(leftovers(), Vec::<String>::new());

    // Pins naming another file than the release's archive for this platform are refused
    // before any I/O: the name becomes a path in the cache's scratch directory.
    let mut renamed = serde_json::to_value(pins(&digest, size)).unwrap();
    renamed["assets"][platform()]["file"] = json!(format!("mostra-1.0.0-{}.tar.gz", platform()));
    let renamed = serde_json::from_value(renamed).unwrap();
    let refused = bundle::install_pinned(&renamed, platform(), &env, &|_| {})
        .await
        .unwrap_err();
    assert_eq!(refused.code(), "MOSTRA_ENV_BUNDLE_INVALID");
    assert_eq!(leftovers(), Vec::<String>::new());
}

/// An install the host gives up part-way (a timeout, a `select!`) releases its lock and removes
/// its scratch, so the next install of that bundle goes ahead at once instead of waiting an hour
/// for a lock whose owner (this live process) never comes back (GPT review of WP-12, finding 3).
#[tokio::test]
async fn an_install_given_up_part_way_holds_nothing_up() {
    let work = tempfile::tempdir().unwrap();
    let (_, digest, size) = archive(work.path(), |_| {}, &[]);
    let cache = work.path().join("cache");
    let mut slow = env(&cache, work.path());
    slow.insert("TEST_SETUP_SLEEP".into(), "30".into());
    let given_up = tokio::time::timeout(
        std::time::Duration::from_millis(1500),
        bundle::install_pinned(&pins(&digest, size), platform(), &slow, &|_| {}),
    )
    .await;
    assert!(given_up.is_err(), "the slow setup finished");
    let bundles = cache.join("bundles");
    let left: Vec<String> = std::fs::read_dir(&bundles)
        .unwrap()
        .flatten()
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .filter(|name| {
            name.starts_with(".tmp-")
                || std::path::Path::new(name)
                    .extension()
                    .is_some_and(|extension| extension.eq_ignore_ascii_case("lock"))
        })
        .collect();
    assert_eq!(
        left,
        Vec::<String>::new(),
        "a lock or scratch outlived the install"
    );
    // What this bounds is the wait for a lock the given-up install kept, which lasts an hour (a
    // live owner's lock is stale only then): two minutes tells the two apart even where one
    // install takes a quarter of a minute, as on Windows arm64, whose synthetic bundle carries a
    // real 80 MB `node.exe`.
    let again = tokio::time::timeout(
        std::time::Duration::from_mins(2),
        bundle::install_pinned(
            &pins(&digest, size),
            platform(),
            &env(&cache, work.path()),
            &|_| {},
        ),
    )
    .await
    .expect("the next install waited for the given-up one's lock")
    .unwrap();
    assert!(bundle::read_setup(&again).is_some());
}
