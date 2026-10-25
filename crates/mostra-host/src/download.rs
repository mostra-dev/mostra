//! Fetching a pinned archive (RT-01, D142 item 4): streamed to disk while it is hashed, never
//! longer than the pin says, through the proxy of the environment the caller gives (never
//! silently this process's), retried on failures a retry can cure, and checked against the pin
//! before anyone reads it. `file:` mirrors are read the same way. A mirror's credentials travel as
//! Basic authorization and never appear in a message.

use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use sha2::{Digest, Sha256};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

use crate::bundle::Environment;
use crate::error::{Error, Result};

/// How long the connection may stay silent.
const STALL: Duration = Duration::from_mins(1);
/// Attempts in all, for failures a retry can cure.
const ATTEMPTS: u32 = 3;

/// How one attempt failed.
enum Failure {
    /// A retry may cure it (the network, a 5xx, 408, 429, a stall).
    Retry(String),
    /// It won't (a 4xx, a wrong size or digest, a full disk).
    Final(Error),
}

/// `url` without credentials, query or fragment, for messages. Parsed as a URL, so a password
/// holding `?`, `#` or `@` never cuts the authority short (Opus review of WP-12, finding 8); text
/// that isn't a URL prints as `<url>`.
pub(crate) fn printable(url: &str) -> String {
    let Ok(mut parsed) = url::Url::parse(url) else {
        return "<url>".to_owned();
    };
    let _ = parsed.set_username("");
    let _ = parsed.set_password(None);
    parsed.set_query(None);
    parsed.set_fragment(None);
    parsed.to_string()
}

/// The URL without its user and password, and the Basic credentials they were (decoded).
fn credentials(url: &str) -> (String, Option<(String, String)>) {
    let Ok(mut parsed) = url::Url::parse(url) else {
        return (url.to_owned(), None);
    };
    if parsed.username().is_empty() && parsed.password().is_none() {
        return (url.to_owned(), None);
    }
    let decode = |text: &str| {
        percent_encoding::percent_decode_str(text)
            .decode_utf8_lossy()
            .into_owned()
    };
    let user = decode(parsed.username());
    let password = parsed.password().map(decode).unwrap_or_default();
    let _ = parsed.set_username("");
    let _ = parsed.set_password(None);
    (parsed.to_string(), Some((user, password)))
}

fn env_value<'a>(env: &'a Environment, upper: &str) -> Option<&'a str> {
    env.get(upper)
        .or_else(|| env.get(&upper.to_ascii_lowercase()))
        .map(String::as_str)
        .filter(|value| !value.is_empty())
}

/// An HTTP client for `env`'s proxies, verifying servers against the platform's trust store.
fn client(env: &Environment) -> Result<reqwest::Client> {
    let failed = |e: String| Error::new("MOSTRA_ENV_BUNDLE_DOWNLOAD_FAILED", e);
    let provider = Arc::new(rustls::crypto::ring::default_provider());
    let tls = rustls::ClientConfig::builder_with_provider(provider)
        .with_safe_default_protocol_versions()
        .map_err(|e| failed(format!("TLS: {e}")))?;
    let tls = rustls_platform_verifier::BuilderVerifierExt::with_platform_verifier(tls)
        .map_err(|e| failed(format!("TLS: {e}")))?
        .with_no_client_auth();
    let mut builder = reqwest::Client::builder()
        .tls_backend_preconfigured(tls)
        .no_proxy()
        .connect_timeout(STALL)
        .user_agent(concat!("mostra-host/", env!("CARGO_PKG_VERSION")));
    let no_proxy = env_value(env, "NO_PROXY").and_then(reqwest::NoProxy::from_string);
    if let Some(proxy) = env_value(env, "HTTPS_PROXY") {
        let proxy = reqwest::Proxy::https(proxy)
            .map_err(|_| failed("HTTPS_PROXY isn't a URL.".to_owned()))?
            .no_proxy(no_proxy.clone());
        builder = builder.proxy(proxy);
    }
    if let Some(proxy) = env_value(env, "HTTP_PROXY") {
        let proxy = reqwest::Proxy::http(proxy)
            .map_err(|_| failed("HTTP_PROXY isn't a URL.".to_owned()))?
            .no_proxy(no_proxy);
        builder = builder.proxy(proxy);
    }
    builder
        .build()
        .map_err(|e| failed(format!("Couldn't make an HTTP client: {e}")))
}

/// Downloads `url` (`https:`, `http:` or `file:`) to `dest` and checks its size and SHA-256.
pub(crate) async fn download(
    url: &str,
    dest: &Path,
    sha256: &str,
    size: u64,
    env: &Environment,
    progress: &(dyn Fn(u64) + Send + Sync),
) -> Result<()> {
    let mut last = String::new();
    for attempt in 1..=ATTEMPTS {
        match once(url, dest, sha256, size, env, progress).await {
            Ok(()) => return Ok(()),
            Err(Failure::Final(error)) => {
                let _ = tokio::fs::remove_file(dest).await;
                return Err(error);
            }
            Err(Failure::Retry(message)) => {
                let _ = tokio::fs::remove_file(dest).await;
                last = message;
                if attempt < ATTEMPTS {
                    tokio::time::sleep(Duration::from_secs(4_u64.pow(attempt - 1))).await;
                }
            }
        }
    }
    Err(Error::new(
        "MOSTRA_ENV_BUNDLE_DOWNLOAD_FAILED",
        format!(
            "Downloading the runtime bundle from {} failed after {ATTEMPTS} attempts: {last}",
            printable(url)
        ),
    ))
}

#[allow(clippy::too_many_lines, reason = "one attempt, read straight through")]
async fn once(
    url: &str,
    dest: &Path,
    sha256: &str,
    size: u64,
    env: &Environment,
    progress: &(dyn Fn(u64) + Send + Sync),
) -> std::result::Result<(), Failure> {
    let disk = |e: std::io::Error| {
        Failure::Final(Error::new(
            "MOSTRA_ENV_BUNDLE_DOWNLOAD_FAILED",
            format!(
                "The runtime bundle couldn't be written to {}: {e}",
                dest.display()
            ),
        ))
    };
    let mut out = tokio::fs::File::create(dest).await.map_err(disk)?;
    let mut hasher = Sha256::new();
    let mut received = 0_u64;
    let too_long = || {
        Failure::Final(Error::new(
            "MOSTRA_ENV_BUNDLE_INVALID",
            format!(
                "The download from {} is longer than the pinned {size} bytes.",
                printable(url)
            ),
        ))
    };
    if url.starts_with("file:") {
        // The URL's own path, decoded as the SDK's `fileURLToPath` reads it: `file:///C:/…` on
        // Windows, `file:///…` elsewhere.
        let path = url::Url::parse(url)
            .ok()
            .and_then(|parsed| parsed.to_file_path().ok())
            .ok_or_else(|| {
                Failure::Final(Error::new(
                    "MOSTRA_ENV_BUNDLE_DOWNLOAD_FAILED",
                    format!("{} isn't a file URL of this system.", printable(url)),
                ))
            })?;
        let mut file = tokio::fs::File::open(&path).await.map_err(|e| {
            Failure::Final(Error::new(
                "MOSTRA_ENV_BUNDLE_DOWNLOAD_FAILED",
                format!("Couldn't read {}: {e}", printable(url)),
            ))
        })?;
        let mut buffer = vec![0_u8; 256 * 1024];
        loop {
            let read = file.read(&mut buffer).await.map_err(disk)?;
            if read == 0 {
                break;
            }
            received += read as u64;
            if received > size {
                return Err(too_long());
            }
            hasher.update(&buffer[..read]);
            out.write_all(&buffer[..read]).await.map_err(disk)?;
            progress(received);
        }
    } else {
        let (bare, auth) = credentials(url);
        let client = client(env).map_err(Failure::Final)?;
        let mut request = client.get(&bare);
        if let Some((user, password)) = auth {
            request = request.basic_auth(user, Some(password));
        }
        let mut response = match tokio::time::timeout(STALL, request.send()).await {
            Ok(Ok(response)) => response,
            Ok(Err(error)) => return Err(Failure::Retry(scrub(&error.to_string(), url))),
            Err(_) => return Err(Failure::Retry("no answer for 60 s".to_owned())),
        };
        let status = response.status().as_u16();
        if !(200..300).contains(&status) {
            let message = format!("{} answered HTTP {status}", printable(url));
            return Err(if status >= 500 || status == 408 || status == 429 {
                Failure::Retry(message)
            } else {
                Failure::Final(Error::new("MOSTRA_ENV_BUNDLE_DOWNLOAD_FAILED", message))
            });
        }
        loop {
            let chunk = match tokio::time::timeout(STALL, response.chunk()).await {
                Ok(Ok(Some(chunk))) => chunk,
                Ok(Ok(None)) => break,
                Ok(Err(error)) => return Err(Failure::Retry(scrub(&error.to_string(), url))),
                Err(_) => return Err(Failure::Retry("the transfer stalled for 60 s".to_owned())),
            };
            received += chunk.len() as u64;
            if received > size {
                return Err(too_long());
            }
            hasher.update(&chunk);
            out.write_all(&chunk).await.map_err(disk)?;
            progress(received);
        }
    }
    out.flush().await.map_err(disk)?;
    out.sync_all().await.map_err(disk)?;
    if received != size {
        return Err(Failure::Final(Error::new(
            "MOSTRA_ENV_BUNDLE_INVALID",
            format!(
                "The download from {} has {received} bytes, not the pinned {size}.",
                printable(url)
            ),
        )));
    }
    let actual = crate::bundle::hex(&hasher.finalize());
    if actual != sha256 {
        return Err(Failure::Final(Error::new(
            "MOSTRA_ENV_BUNDLE_INVALID",
            format!(
                "The download from {} has SHA-256 {actual}, not the pinned {sha256}.",
                printable(url)
            ),
        )));
    }
    Ok(())
}

/// `text` with every URL in it reduced to its printable form (an error names the request's URL,
/// without credentials but with its query, which may hold a signed mirror's secret: Opus review
/// of WP-12, finding 8), and `url`'s user and password removed wherever else they appear.
fn scrub(text: &str, url: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(start) = ["https://", "http://", "file://"]
        .iter()
        .filter_map(|scheme| rest.find(scheme))
        .min()
    {
        out.push_str(&rest[..start]);
        let tail = &rest[start..];
        let end = tail
            .find(|c: char| {
                c.is_whitespace() || matches!(c, ')' | '"' | '\'' | '<' | '>' | ',' | ']')
            })
            .unwrap_or(tail.len());
        out.push_str(&printable(&tail[..end]));
        rest = &tail[end..];
    }
    out.push_str(rest);
    if let (_, Some((user, password))) = credentials(url) {
        for secret in [password, user] {
            if secret.len() >= 3 {
                out = out.replace(&secret, "***");
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::{credentials, printable};

    /// A signed mirror's query, a password holding `#`, `?` or `@`, and the request URL an error
    /// repeats without the user never reach a message (Opus review of WP-12, finding 8).
    #[test]
    fn no_secret_of_a_mirror_reaches_a_message() {
        let url = "https://ci:p%23w%3Fx%40y@mirror.example/x/a.tar.gz?X-Amz-Signature=SECRET#frag";
        let error = "error sending request for url \
            (https://mirror.example/x/a.tar.gz?X-Amz-Signature=SECRET): connection refused";
        let message = super::scrub(error, url);
        assert!(!message.contains("SECRET"), "{message}");
        assert!(
            message.contains("https://mirror.example/x/a.tar.gz)"),
            "{message}"
        );
        assert_eq!(printable(url), "https://mirror.example/x/a.tar.gz");
        let raw = "https://ci:pw#with?marks@mirror.example/x";
        assert!(!printable(raw).contains("marks"), "{}", printable(raw));
        assert!(!printable(raw).contains("pw"), "{}", printable(raw));
        let (bare, auth) = credentials(url);
        assert_eq!(
            bare,
            "https://mirror.example/x/a.tar.gz?X-Amz-Signature=SECRET#frag"
        );
        assert_eq!(auth, Some(("ci".to_owned(), "p#w?x@y".to_owned())));
    }

    #[test]
    fn credentials_never_reach_a_message() {
        let url = "https://ci:s3cret@mirror.example/mostra/a.tar.gz?token=abc";
        assert_eq!(printable(url), "https://mirror.example/mostra/a.tar.gz");
        let (bare, auth) = credentials("https://ci:s%33cret@mirror.example/mostra/a.tar.gz");
        assert_eq!(bare, "https://mirror.example/mostra/a.tar.gz");
        assert_eq!(auth, Some(("ci".to_owned(), "s3cret".to_owned())));
    }
}
