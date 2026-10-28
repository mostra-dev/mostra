# WP-13 progress: sharing and remote viewing

**Status:** In progress. Owns HY-04, HY-05, HY-07 and HO-10 ([specification](../design/work-packages/WP-13.md)).

## Baseline

| | |
|---|---|
| Branch | `wp/13-sharing`, fast-forwarded to `origin/main` (a stale local branch of that name pointed at `814859a`, with no commits of its own) |
| Starting `HEAD` | `a9758a4` (`origin/main`, 2026-10-28: "docs: MT-02b's closeout, Mostra 0.6.2, WP-13 next (#97)") |
| `git status` | clean |
| CI on the starting commit | the nightly of 2026-10-28 (run 40667329008) passed; MT-02b's `ci:full` run 40714401277 passed every leg on its last attempt (PROGRESS-MT-02b); #97's merge-queue run 40753624394 met #98 (below) |
| `pnpm check` | running at the time of writing; the result is recorded below when it ends |
| Predecessors | WP-W3 done ([PROGRESS-WP-W3](PROGRESS-WP-W3.md) on `origin/main`); MT-02 and MT-02b done, released as Mostra 0.6.2 |
| Milestone `WP-13` | #98 (a telemetry lock race in `@mostra/cli`, seen on Windows arm64 in #97's merge-queue run) |
| Local toolchain | Node 24.22.1 (`.node-version`), pnpm 12.14.0, macOS 26.2 arm64; `cloudflared` 2026.10.3 at `/opt/homebrew/bin/cloudflared`; no `tailscale` |
