# @mostra/verify

The verify runner of [Mostra](https://github.com/mostra-dev/mostra). It is the child process that renders an artifact's pages in a warm headless Chromium and reports what it saw: errors, console and network findings, accessibility, an ARIA snapshot, screenshots at DPR 1 and a smoke test. It also compares screenshots with those of the artifact's last passing version.

It ships in the Mostra runtime bundle and runs only as a child of a Mostra supervisor, which starts it on the first `mostra verify` and owns the verdict.

Apache-2.0. It drives Chromium through `playwright-core` (Apache-2.0) and injects `axe-core` (MPL-2.0), unmodified, into the pages it checks.
