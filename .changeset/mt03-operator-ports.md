---
"@mostra/protocol": minor
"@mostra/runtime": minor
---

The remote server's operator ports do what INTERFACES §18.6 says, and give an operator more to go on (all additive within `OPERATOR_REVISION` `2026-11-08`):

- `limits` is asked for a hosted page's relayed actions: `run` before a run is recorded, `run.wait` before it waits for an absent owner, `call` before a plain call is relayed. A refusal answers the operator's message (403 `MOSTRA_REMOTE_LIMIT_REACHED`, or 503 `MOSTRA_REMOTE_QUEUE_FULL` for `run.wait`) with nothing recorded or relayed and the link's relayed-action rate given back; a request that joins a recorded run, or a duplicate sent meanwhile, is never asked; no answer lets the action through; and a pause, a revoked link or a closed page during the wait refuses the action then.
- A link's `idleExpiry` is judged from its last use before the visit that asks (its views and its other sessions' activity), so a fresh visit to an idle link answers 410 and a page open and in use keeps its link.
- GitHub sign-ins carry `publicRepos`, `publicGists` and `followers` in `SignInIdentity.facts`; an `oidc` entry of `identityProviders` may name `claims` (at most 8, never `__proto__`, `constructor` or `prototype`) that go into `facts` under their names.
- The sender line's verifier is recorded on each sign-in identity when its provider names the person, so renaming or retiring a configured provider changes no verified name (a label with control or format characters verifies nothing), and `IdentityProvider.verifies: { label }` lets a provider the operator module supplies verify names.
- Metering adds `bytes.held`, the client bytes a home holds, sent when it changes (falling when content is removed, 0 once when nothing is left) and for every home once a day; a window's counters go out in batches of at most 1,000.
- `LimitQuery.versionId` names the version on `version.push` and `storage`, the same in every round of one push.
