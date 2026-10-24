---
"@mostra/sdk": minor
---

Adds `connectControl`, which opens a home's control endpoint as a client: its Unix socket, or on Windows its owner-only pipe through the runtime's helper, refusing a pipe another user created under the name, found beside the runtime the caller resolved.
