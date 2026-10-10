# Write an end-to-end test

Use when behavior crosses a browser, the gateway or real processes (STANDARDS, Verification
layers 3 and 4). Unit and property tests stay in each package's `test/`.

1. **Choose the layer.** Browser behavior goes in `tests/e2e/specs/` as a Playwright Test spec.
   It runs in Chromium, Firefox and WebKit, because addressing, cookies and service workers differ
   per engine (VERIFIED_FACTS).
2. **Drive the real thing.** Start the real gateway and supervisor in a temporary Mostra home and
   go through the public interface a viewer, agent or host uses. Real side effects go to local
   fakes, such as a counting fake mail server, never to real services (STANDARDS).
3. **Write the hygiene negatives** next to the positive path: bad Host, bad Origin, missing token,
   missing CSRF header, revoked token (HY-01).
4. **Keep it deterministic.** Wait on observable state (`expect(locator).toBeVisible()`), never on
   timers. A flaky test is a defect to fix, not to retry.
5. **Run it locally.**
   ```sh
   pnpm --filter @mostra/e2e e2e:install   # once: the three browser engines
   pnpm --filter @mostra/e2e e2e
   ```
6. **Wire it into CI** through the `e2e` job of REPO_STANDARDS §6, added to the existing workflow
   by the first package with browser suites (WP-05), not as a new workflow file.

**Done when** the spec fails against a seeded defect and passes against the fix in all three
engines, and its requirement row in the progress report names the spec.
