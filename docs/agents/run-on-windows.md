# Run a check on Windows

Use when a change touches anything the platform layer owns (`packages/runtime/src/platform`,
`crates/mostra-win`), or when a Windows CI leg (`unit (windows-latest)`, `integration
(windows-11-arm)` …) fails. No Mostra machine runs Windows: GitHub's Windows runners are the only
place Windows behavior is observed, so the loop is a push and a CI run.

1. **Check that it builds for Windows locally.** The helper compiles and lints for both Windows
   targets from macOS or Linux:
   ```sh
   rustup target add x86_64-pc-windows-msvc aarch64-pc-windows-msvc
   cargo clippy -p mostra-win --target x86_64-pc-windows-msvc --all-targets -- -D warnings
   cargo clippy -p mostra-win --target aarch64-pc-windows-msvc --all-targets -- -D warnings
   ```
   TypeScript has no Windows build; `pnpm --filter @mostra/runtime exec tsc -b` covers it.
2. **Make the Windows path explicit in tests.** Use `WINDOWS` from `test/support.ts`: give a POSIX
   check a Windows variant (`describe.runIf(WINDOWS)`) that proves the same guarantee the Windows
   way, or skip it with a comment naming where Windows covers it. Never let a Windows-only check
   skip silently on Windows: a missing prerequisite (the second user, the helper) is a failure.
3. **Push and read the leg.** The `windows` job runs `pnpm check --job unit|hygiene|integration`
   with `MOSTRA_TEST_GROUP` set to one of the Windows groups in
   `packages/runtime/vitest.config.ts` (they partition every runtime suite, one machine each;
   `windows-clients` is the CLI's, the SDK's, `create-mostra`'s and the kit's) and a second local user (`MOSTRA_TEST_OTHER_USER`,
   `MOSTRA_TEST_OTHER_PASSWORD`); the `windows-gateway` leg also turns the firewall and its audit
   on. The `e2e` job runs the browser suites there too, the `rust` and `conformance` jobs the
   crate and the kit's Rust reference host, and the release rehearsal builds and smoke-tests the
   Windows bundles. A new suite joins exactly one Windows group.
   Read a failing leg's log with `gh run view <run> --log-failed`, or the whole job with
   `gh api repos/mostra-dev/mostra/actions/jobs/<job>/logs`.
4. **Observe Windows behavior you depend on** before building on it: the helper's
   `mostra-win-probe` (`as-user`, `suspend`, `resume`, `group` and `ctrl-break`) and a short script in a test are how the
   facts in VERIFIED_FACTS (WP-W1) were seen. Record each new fact there with the run that showed it.
5. **Replay Windows seeds on a Windows runner.** A seed with `platform: "win32"` in
   `packages/runtime/scripts/prove-seeds.ts` runs only there:
   `gh workflow run windows-seeds.yml --ref <branch> -f only=RT-10` (and `-f os=windows-11-arm`
   for arm64), then record the run in the report. Every seed must end "seeded: red" and
   "restored: green"; a seed that doesn't compile prints Cargo's error and fails the run.

Windows differs in kind: no signals between processes (stop a daemon with `mostra/shutdown`), no
process groups (each child has a Job Object), no modes (owner-only access lists), files in use
can't be removed or renamed (and antivirus holds new files open for a moment), the execute bit
doesn't exist, and names compare without case. The runner's user is an administrator with UAC
off, so a check that a privilege is missing can't be made there.

**Done when** both Windows legs (`windows-latest`, `windows-11-arm`) pass on the pushed commit,
the macOS and Linux legs still pass, and any Windows seed you added or moved is red then green in
a `windows-seeds.yml` run.
