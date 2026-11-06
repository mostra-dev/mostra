---
"@mostra/protocol": minor
"@mostra/runtime": minor
"@mostra/shell": minor
"@mostra/cli": patch
---

A remote server serves hosted pages: `mostra share <artifact> --via remote` (the host protocol's `share/start { via: "remote" }`) pushes the latest version and mints a link on the hosted home, `https://<domain>/a/<routeId>#t=…`; the shell lives on the user-content domain's apex with its session in the `X-Mostra-Shell` header (`SHELL_SESSION_HEADER`), never a cookie, and frames on the route's own label in worker mode. A respondent there sees "Your answer was sent." and no delivery state; the owner instance receives the submission through its outbox. `share/list` and `share/stop` include remote shares, and a stopped one's hosted link is revoked. `VersionPush` carries the owner's submission policy in force.
