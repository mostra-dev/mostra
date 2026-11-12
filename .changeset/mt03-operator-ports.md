---
"@mostra/protocol": minor
"@mostra/runtime": minor
---

The remote server's operator ports do what INTERFACES §18.6 says, and give an operator more to go on (all additive within `OPERATOR_REVISION` `2026-11-08`):

- `limits` is asked for a hosted page's relayed actions: `run` before a run is recorded, `run.wait` before it waits for an absent owner, `call` before a plain call is relayed. A refusal answers the operator's message (403 `MOSTRA_REMOTE_LIMIT_REACHED`, or 503 `MOSTRA_REMOTE_QUEUE_FULL` for `run.wait`) with nothing recorded or relayed and the link's relayed-action rate given back; a request that joins a recorded run is never asked, and no answer lets the action through.
- A link's `idleExpiry` is judged from its last view before the visit that asks, so a fresh visit to an idle link answers 410.
- GitHub sign-ins carry `publicRepos`, `publicGists` and `followers` in `SignInIdentity.facts`; an `oidc` entry of `identityProviders` may name `claims` (at most 8) that go into `facts` under their names.
- The sender line's verifier is recorded on each sign-in identity when its provider names the person, so renaming or retiring a configured provider changes no verified name, and `IdentityProvider.verifies: { label }` lets a provider the operator module supplies verify names.
- Metering adds `bytes.held`, each home's held client bytes at a window's end, which falls when content is removed.
- `LimitQuery.versionId` names the version on `version.push` and `storage`, the same in every round of one push.
