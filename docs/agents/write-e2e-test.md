# Write an end-to-end test

Use when behavior crosses a browser, the gateway or real processes (STANDARDS, Verification
layers 3 and 4). Unit and property tests stay in each package's `test/`.

1. **Choose the layer.** Browser behavior goes in `tests/e2e/specs/` as a Playwright Test spec.
   It runs in Chromium, Firefox and WebKit, because addressing, cookies and service workers differ
   per engine (VERIFIED_FACTS).
2. **Drive the real thing.** `global-setup.ts` starts one real `mostra-runtime daemon` on a fresh
   home for the run and publishes the render fixtures; specs read it with `readRun()` and reach
   it like any host, through `Client` in `support/mostra.ts`, and like a viewer, by opening a
   receipt's capability link in the page. Publish what a new spec needs in global set-up, or
   through `Client` in the spec. Real side effects go to local fakes, such as a counting fake
   mail server, never to real services (STANDARDS).
3. **Write the hygiene negatives** next to the positive path: bad Host, bad Origin, missing token,
   missing CSRF header, revoked token (HY-01). Request-level negatives that need no engine go in
   `packages/runtime/test/hygiene/` (the `hygiene` job); keep browser specs for what only an
   engine decides: framing, cookies, `postMessage`, storage.
4. **Keep it deterministic.** Wait on observable state (`expect(locator).toBeVisible()`), never on
   timers. A flaky test is a defect to fix, not to retry.
5. **Run it locally.** Build what the run drives first: the e2e job does it through Turborepo.
   ```sh
   pnpm --filter @mostra/e2e e2e:install   # once: the three browser engines
   pnpm check --job e2e                    # builds the runtime and the shell, then runs the specs
   ```
   A spec that waits on something an engine may never deliver (a refused frame in Firefox never
   fires `load`) bounds the wait and proves the probe with a control that must pass.
6. **CI** runs the `e2e` job on macOS and Linux and keeps the traces of failed tests as an
   artifact. Add specs to `specs/`, not new jobs or workflow files.
7. **Seed it.** Add the violation the spec must catch to `packages/runtime/scripts/prove-seeds.ts`
   with `e2e: true`, and run `node packages/runtime/scripts/prove-seeds.ts --only <ID>`.

**Done when** the spec fails against a seeded defect and passes against the fix in all three
engines, and its requirement row in the progress report names the spec.
