//! Errors: every failure carries a stable diagnostic code (INTERFACES §13), so a host switches
//! on [`Error::code`], never on the message. Failures the instance reports keep its whole
//! [`Diagnostic`]; failures on this side (a closed connection, a timeout, a bundle that differs
//! from its pin) use the catalog's codes for them.

use std::fmt;

use crate::wire::Diagnostic;

/// A failed call, spawn, attach or install.
#[derive(Debug, Clone)]
pub struct Error {
    code: String,
    message: String,
    hint: Option<String>,
    rpc_code: Option<i64>,
    diagnostic: Option<Box<Diagnostic>>,
}

/// `Result` with this crate's [`Error`].
pub type Result<T, E = Error> = std::result::Result<T, E>;

impl Error {
    /// An error of `code` with `message`.
    pub(crate) fn new(code: &str, message: impl Into<String>) -> Self {
        Self {
            code: code.to_owned(),
            message: message.into(),
            hint: None,
            rpc_code: None,
            diagnostic: None,
        }
    }

    /// With a hint: what the caller can do.
    #[must_use]
    pub(crate) fn with_hint(mut self, hint: impl Into<String>) -> Self {
        self.hint = Some(hint.into());
        self
    }

    /// The instance's own diagnostic, from a JSON-RPC error.
    pub(crate) fn from_diagnostic(diagnostic: Diagnostic, rpc_code: Option<i64>) -> Self {
        Self {
            code: diagnostic.code.to_string(),
            message: diagnostic.message.clone(),
            hint: diagnostic.hint.clone(),
            rpc_code,
            diagnostic: Some(Box::new(diagnostic)),
        }
    }

    /// The connection to the instance ended (`MOSTRA_HOST_CONNECTION_CLOSED`).
    pub(crate) fn closed(message: impl Into<String>) -> Self {
        Self::new("MOSTRA_HOST_CONNECTION_CLOSED", message)
            .with_hint("Reconnect, then retry the request with the same request ID.")
    }

    /// The diagnostic code, such as `MOSTRA_HOME_LOCKED`.
    #[must_use]
    pub fn code(&self) -> &str {
        &self.code
    }

    /// What went wrong.
    #[must_use]
    pub fn message(&self) -> &str {
        &self.message
    }

    /// What to do about it, when known.
    #[must_use]
    pub fn hint(&self) -> Option<&str> {
        self.hint.as_deref()
    }

    /// The JSON-RPC error code, for errors the instance sent (-32000 for most diagnostics).
    #[must_use]
    pub fn rpc_code(&self) -> Option<i64> {
        self.rpc_code
    }

    /// The instance's diagnostic, for errors it sent.
    #[must_use]
    pub fn diagnostic(&self) -> Option<&Diagnostic> {
        self.diagnostic.as_deref()
    }
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for Error {}
