---
"@mostra/runtime": patch
---

A daemon whose home has a login service installed never exits for lack of work, whoever started
it; the systemd unit escapes newlines and `%` in paths.
