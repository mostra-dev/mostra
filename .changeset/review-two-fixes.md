---
"@mostra/runtime": patch
"@mostra/shell": patch
---

A suspended account's refresh is refused for now (403 `temporarily_unavailable`), never as a sign-out; a hosted submit takes its rates before the operator's `limits` is asked and gets them back when the operator refuses; `rateLimits.perIp.requests` is applied to every request; the development device form checks the code before it resolves anyone; a hosted shell whose session isn't stored offers no sign-in.
