---
code: MOSTRA_REMOTE_LOGIN_FAILED
severity: error
phase: host
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_REMOTE_LOGIN_FAILED

Signing in to a remote server failed. Severity: error. Phase: host.

## What it means

Signing this home in to a remote server didn't finish: the code expired, the person refused it, the server refused the client, or the binding's access token was refused (revoked, expired, or for another server). Nothing of the home changed; artifacts it owns on that server stay its own.

## How to fix it

Sign in to the server again and approve the code on the page it names. A refusal you didn't expect means the sign-in was revoked on the server.

## Hint

Sign in to the server again, and approve the code on its page within ten minutes.
