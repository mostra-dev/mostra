# Reproduce a Linux failure locally

Use when a check passes on macOS but fails on the Linux CI leg (`integration (ubuntu-latest)`,
`rust (ubuntu-latest)`), or before pushing a change to process, socket or file-system behavior.
Process listings, signals and shells differ between the platforms (`dash` is `/bin/sh` on Debian
and Ubuntu).

1. **Commit first.** The container receives `git archive HEAD`, so uncommitted edits are left out.
   The Docker VM can't see `~/src`, which is why the tree goes in on stdin rather than as a mount.
2. **Run the suite in a container** that matches `.node-version`:
   ```sh
   git archive HEAD | docker run --rm -i node:24.12.0-bookworm bash -c '
     mkdir /w && cd /w && tar -xf - && git init -q
     npm i -g pnpm@12.9.0 >/dev/null 2>&1
     CI=1 LEFTHOOK=0 pnpm install --frozen-lockfile >/tmp/install.log 2>&1 || { tail -20 /tmp/install.log; exit 1; }
     pnpm --filter @mostra/protocol build && pnpm --filter @mostra/runtime build
     cd packages/runtime && npx vitest run --project integration test/integration/processes.test.ts
   '
   ```
   `git init` lets lefthook's `prepare` step find a repository. Use the package's own versions:
   the Node image tag from `.node-version` and pnpm from `packageManager` in `package.json`.
3. **Investigate inside the container.** Append commands to the script, for example
   `ps -eo pid,ppid,pgid,stat,args` after a failing test, or patch a source file with `sed` before
   the run to add temporary logging. Nothing from the container reaches your checkout.
4. **Fix and prove it.** Commit the fix, run the same command again, and run it twice when the
   failure was intermittent.

The container runs as root, so tests that need a directory owned by another user skip there; CI
runs as an ordinary user and covers them.

**Done when** the failing test passes in the container on the committed fix, and the same test
passes locally on macOS.
