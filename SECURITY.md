# Security policy

## Reporting a vulnerability

Report security problems privately, in either of two ways:

- through GitHub's private vulnerability reporting:
  **[Report a vulnerability](https://github.com/mostra-dev/mostra/security/advisories/new)**
  (the "Security" tab, then "Report a vulnerability");
- by email to **security@mostradev.com**.

Please don't open a public issue, discussion or pull request for a vulnerability.

Include what you can of:

- the affected package or component and its version or commit;
- what an attacker can do, and under which setup (local, tailnet share, public share);
- steps or a proof of concept to reproduce it.

We acknowledge every report within 48 hours and keep you updated until it is resolved. Fixes
are released as soon as they are ready, with a GitHub security advisory and credit to the
reporter unless you prefer otherwise. There is no bug bounty.

## Safe harbor

We won't pursue or support legal action against research done in good faith under this policy.
Good faith means: you report privately and give us reasonable time to fix the problem before
disclosing it; you access no one else's data beyond the minimum needed to show the problem, and
delete what you saw; you don't degrade the service for others; and you test only against your own
installations and accounts. If you're unsure whether something is allowed, ask at
security@mostradev.com first.

## Scope

Mostra's security model is narrow on purpose (DECISIONS D05, D06). In scope:

- anyone other than the holder of an artifact's capability URL using that artifact (for example, an
  unrelated website driving a local artifact, or a guessable or leaked token path);
- the hygiene checks of the gateway and the MCP HTTP transport: the Host allowlist, Origin checks,
  CSRF protection, token scopes, revocation and loopback binding;
- secrets reaching source, versions, exports, logs, diagnostics, events or screenshots;
- trusted controls rendering in, or being clickable from, an origin agent code controls;
- supply-chain problems in what Mostra publishes.

For Mostra Cloud, the hosted service at mostradev.com and mostrausercontent.com, which runs the
remote server, the relay and the remote MCP server from this repository behind its own operating
layer, also in scope:

- one account, organization or hosted home reaching another's artifacts, submissions, files,
  secrets or settings;
- a hosted link that can be guessed, leaks through the service, or keeps working after it was
  revoked or expired;
- a hosted artifact escaping its origin on the user-content domain: reading another artifact's
  state, cookies or storage, or drawing, covering or driving the trusted controls the service
  renders around it (sign-in, Submit, Report, the interstitial);
- the relay: a hosted artifact or its viewer running actions or live producers on the owner's
  instance beyond what the owner allowed;
- the remote MCP server and its OAuth flow: stolen or widened tokens, scope escalation, consent
  bypass, open redirects;
- sign-in, sessions and the account pages;
- getting around quotas, plan limits or billing in a way that uses or charges another account.

Out of scope:

- what agent-authored artifacts do. Mostra deliberately runs artifact code with full capability and
  adds no content or capability guardrails; an artifact that sends email or reads files is doing
  what its author wrote. A hosted artifact that phishes, spreads malware or otherwise abuses its
  viewers is an abuse report, not a vulnerability: use the Report control on the page or
  abuse@mostrausercontent.com;
- volumetric denial of service;
- social engineering of the maintainer or of other users.

On Mostra Cloud, the safe harbor above also asks you to test only with accounts and artifacts
of your own, publish nothing the service's acceptable-use policy forbids even as a test, and keep
automated testing to a rate that doesn't slow the service for others. The service's contact
details are also in https://mostradev.com/.well-known/security.txt.

## Supported versions

Mostra is pre-1.0. Security fixes land on the latest release of each package.
