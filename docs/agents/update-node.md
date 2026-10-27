# Update Node.js

Use when Node.js publishes a release Mostra should take: a security release of the LTS line the
bundles ship (D48), or the move to the next LTS line (Node.js 26 from 2026-10-28, a deliberate
change of its own). Two pins move together: the Node.js every runtime bundle ships
(`packages/bundle/node.json`, D142 item 1) and the one the repository and CI run (`.node-version`).

1. **Check the release** at nodejs.org/dist/index.json: its date (7 days old, unless it is a
   security release: its `security` flag), its LTS line, and the changelog's notable changes.
   Record them in `docs/design/VERIFIED_FACTS.md` with the date.
2. **Pin the bundle's Node.js:** `node tools/release/node-pins.ts <version>`. It fetches
   `SHASUMS256.txt` and its signature, verifies them with `gpgv` (GnuPG) against the Node.js
   release keys at the commit the tool pins, and writes every platform's archive SHA-256. It
   refuses a signature that doesn't verify and a list missing an archive. A new release key means
   moving `RELEASE_KEYS_COMMIT` in the tool, a reviewed change. Record the signing key it prints.
3. **Move `.node-version`** to the same version. Renovate opens this one on its own (#83); the
   bundle's pin it doesn't know.
4. **A new LTS line** also moves the runtime's and the root's `engines` and the churn guidance
   (D48), and needs its own decision. `reproduce-on-linux.md` reads `.node-version` itself.
5. **Add a changeset** for `@mostra/runtime` naming the bundle's Node.js version: users get it with
   the next release.
6. **Push.** The change touches `packages/bundle/`, so the pull request rehearses the release on
   all six platforms: each bundle is built from the new archive, checked against its pin, and
   smoke-tested with no Node.js (`docs/agents/run-ci.md`).

**Done when** `node tools/release/node-pins.ts --check` passes, the pull request's six-platform
rehearsal is green, and VERIFIED_FACTS records the version, its date and its signing key.
