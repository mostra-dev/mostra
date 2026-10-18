---
"@mostra/runtime": minor
"@mostra/shell": minor
---

Serve the CLI's methods (D140): `view/default`, one-time launch tickets (`view/launch`, exchanged
by the shell from `#l=`), `instance/check`, and `gc/run`, which keeps every version a submission,
view, run, session, live value, review set, field, live pinned link, baseline or follow names, and
collects the rest as tombstones (`version_collected`, migration 9) along with unused snapshots, lock
layouts, store packages and verify caches, serialized with publish, verify and installs. A home
that a host spawned or configured is marked `hostConfigured` in `config.json`.

Serve `mostra dev` (`dev/start`, `dev/stop`, `dev/notify`, D140 item 12): a development preview of
unpublished source in its own sandbox, with Vite's hot updates through the gateway's checks, server
code that runs for real and restarts when it changes, and submissions reported to the session and
delivered nowhere. The shell marks it "Development preview, not published".
