---
"@mostra/cli": patch
---

Telemetry events from Windows (`os: "win32"`) are queued: the event schema refused them, so a Windows CLI with telemetry on recorded nothing.
