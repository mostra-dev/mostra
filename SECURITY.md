# Security policy

## Reporting a vulnerability

Report security problems privately through GitHub's private vulnerability reporting:
**[Report a vulnerability](https://github.com/mostra-dev/mostra/security/advisories/new)**
(the "Security" tab, then "Report a vulnerability"). Please don't open a public issue,
discussion or pull request for a vulnerability.

Include what you can of:

- the affected package or component and its version or commit;
- what an attacker can do, and under which setup (local, tailnet share, public share);
- steps or a proof of concept to reproduce it.

The maintainer acknowledges a report within 7 days and keeps you updated until it is resolved.
Fixes are released as soon as they are ready, with a GitHub security advisory and credit to the
reporter unless you prefer otherwise.

## Scope

Mostra's security model is narrow on purpose (DECISIONS D05, D06). In scope:

- anyone other than the holder of an artifact's capability URL using that artifact (for example, an
  unrelated website driving a local artifact, or a guessable or leaked token path);
- the hygiene checks of the gateway and the MCP HTTP transport: the Host allowlist, Origin checks,
  CSRF protection, token scopes, revocation and loopback binding;
- secrets reaching source, versions, exports, logs, diagnostics, events or screenshots;
- trusted controls rendering in, or being clickable from, an origin agent code controls;
- supply-chain problems in what Mostra publishes.

Out of scope: what agent-authored artifacts do. Mostra deliberately runs artifact code with full
capability and adds no content or capability guardrails; an artifact that sends email or reads
files is doing what its author wrote.

## Supported versions

Mostra is pre-1.0. Security fixes land on the latest release of each package.
