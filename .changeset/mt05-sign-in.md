---
"@mostra/runtime": minor
---

Who signs in to a remote server, and what an idle one writes (all additive within `OPERATOR_REVISION` `2026-11-08`):

- **GitHub sign-in now asks for `user:email`**, read-only access to the person's email addresses. GitHub's own consent screen says so, and people who signed in with GitHub before are asked once more for it. The sign-in then carries the primary address GitHub marks verified, even one the person keeps private, as `SignInIdentity.email` with `emailVerified: true`, so an operator can reach the people who sign in. Without a verified primary address it carries the public address as before, or none; a person who declines the scope on GitHub's screen, or an address list GitHub can't answer in a few seconds, still signs in.
- **`operatorClients`** in the server's configuration names the operator's own Client ID Metadata Document clients (`[{ clientId, name }]`): the consent page names each as the server's own app, by the name the operator gives it, rather than as an app naming itself, and still asks each person once.
- **An idle hosted home writes nothing.** Its high-water marks are written when it opens and closes, and in between only when a mark moved, rather than every 10 s, so a WAL replicator such as Litestream has nothing to ship from a server whose linked owners are idle.
