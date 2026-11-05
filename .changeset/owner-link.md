---
"@mostra/protocol": minor
"@mostra/react": minor
"@mostra/runtime": minor
---

An instance signs in to a remote server by the device grant (`remote/login`, `remote/login.wait`, `remote/logout`, `remote/status`), keeps its refresh token in the home, dials the server's binding and keeps it. Submissions its hosted home delivers are stored with their IDs, digest and snapshot and reach this instance's own hosts through its outbox; events of the artifacts it owns are copied once each, with `origin`. `useViewer().source` and `ViewerKind` gain `account` and `anonymous`, `EventRecord` and `Results.submission` gain `origin`, and a delivery envelope may carry the stored `snapshot` and its `cursor`.
