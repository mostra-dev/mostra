# WP-03 progress: builder, versions and publish

**Status:** Done. Accepted by Mirza on 2026-10-11, merged to `main` as `87487b5`, finalized after the merge (work-packages/README.md §4).

## Baseline

| | |
|---|---|
| Branch | `wp/03-builder`, created from `origin/main` |
| Starting `HEAD` | `79216c4` (`origin/main` at session start, 2026-10-11: "docs(progress): finalize the WP-02 report (#9)") |
| `git status` | clean |
| `pnpm check` | green: format-lint, types, unit, integration, build, boundaries, api, licenses, rust, docs and commits all pass (38 s, macOS arm64) |
| Predecessors | WP-02 done ([PROGRESS-WP-02](PROGRESS-WP-02.md) on `origin/main`); no `RECOVERY-WP-03-*.md` |
| Local toolchain | Node 24.12.0, pnpm 12.9.0, macOS arm64 |
| Pull request | [#10](https://github.com/mostra-dev/mostra/pull/10), merged |

## What was built

- **`@mostra/protocol`:** the artifact manifest (`ArtifactManifest`, INTERFACES §2.2) and its known keys; `SourceRef`, `ArtifactRef`, `ArtifactSummary`, `ArtifactDetail`, `VersionSummary` and `PublishReceipt` (with `url` optional, D90); the methods `artifact/create`, `artifact/publish`, `artifact/list` and `artifact/get`; 20 diagnostic codes in the MANIFEST, BUILD, ACTION, PUBLISH, ARTIFACT (new, D92), HOME, TARGET and ENV areas, with docs pages.
- **`@mostra/react`** (new): `defineArtifact`, an identity function whose argument Mostra reads statically, and `createServerReference`, the client side of a server function, which rejects with `MOSTRA_TARGET_UNAVAILABLE` until WP-08 gives it a transport.
- **`@mostra/warm`** (new, unpublished, D91): the warm set's dependencies (React 19.3, React DOM, React Router 8, Tailwind CSS 4.3, `@mostra/react`) and no code. Builds link their `node_modules` to it, so artifacts need no `package.json` and share one React.
- **`@mostra/runtime`:**
  - `builder`: the internal `RenderMode` contract with SPA as its implementation, the warm set lookup, and the builder child (`builder/child/`), the only process that loads Vite. Per build it runs Vite 8 with React, MDX 3 (frontmatter and GitHub-flavoured Markdown), Tailwind 4 and two plugins of its own: MDX compilation and the `"use server"` client-stub transform. It generates the client entry (the page, or the `pages/` routes inside the entry's layout) and, when the artifact has server code, a server bundle (`server/entry.mjs`, `functions` by ID and `live`). A static scan writes the registry: actions with their `dryRun()` opt-ins (including through module-level helpers and namespace imports), live sources, pages, terminals and demos. Crashes and the 180 s limit become `MOSTRA_BUILD_CRASHED` and `MOSTRA_BUILD_TIMEOUT`.
  - `publish`: source resolution (single `.tsx`/`.jsx`/`.mdx` files and directories with one `index` entry), ignore rules (`node_modules`, `.git`, `.mostra`, editor and Finder files, `.mostraignore`), symlink following with loop detection, NFC paths, the staging snapshot hashed from its copy, deterministic ustar/PAX archives compressed with zstd, `sourceDigest`, `envDigest`, `outputDigest` and the version ID (D89), static manifest extraction with Oxc and YAML, the publish pipeline with per-path and per-artifact queues, undo of a failed publish's store files, `requestId` replay recorded in the commit's transaction, and the `artifact/*` handlers.
  - `registry`: artifacts, versions and source bindings in the ledger; identity (manifest `id` wins, a moved source rebinds, a copy that still claims the `id` is `MOSTRA_PUBLISH_ID_CONFLICT`); republishing an earlier version's exact source makes it the latest again; the sealed (read-only) version store; recovery at start that empties staging and removes version directories and snapshots without a row.
  - `interaction`: the event log's append path, so the receipt's cursor is the real `version.published` event (D90).
  - Ledger migration 2: `artifact`, `source_binding`, `version` (with an UPDATE-refusing trigger), `event` (append-only trigger) and `request`.
  - `processes`: every child starts behind a `/bin/sh` gate that `exec`s the command only after its `child` row is written (issue #7, D93).
  - `faults.ts`: `MOSTRA_TEST_FAULTS` fault points (`throw` or SIGKILL) for tests; the native parser loads on first use so the platform gate still answers first.
- **Repository machinery:** the diagnostic generator keeps the code union valid when two areas are new; the license audit reads the deprecated `licenses` array; dependency-cruiser no longer excludes npm packages that live in `dist/` (the WP-01 vite rule never fired before), with new rules keeping the bundler, the builder child's modules and native modules out of the supervisor; the `integration` CI job installs the Playwright Chromium headless shell; `prove-seeds.ts` carries WP-03's seeds.

## Decisions taken in the package

M14 and D89 to D93 (recorded on this branch): the artifact ID joins the version ID's hash; `PublishReceipt.url` is optional until WP-05; the warm set is the `@mostra/warm` package; the `ARTIFACT` diagnostic area; issue #7 and the check boundaries of D93, with follow-ups written into the WP-04 to WP-10 specifications. Within those, recorded in INTERFACES §2.1, §2.2, §6, §11 and DATA_MODEL §1 to §3:

- **Conventions:** entries, the `pages/` routes (`index`, nested folders, `[param]`, `[...rest]`), the entry's default export as the layout when `pages/` exists, the `@/` alias to the artifact root, Tailwind 4 in every build, `"use server"` modules exporting only async functions, function IDs `<module path>#<export>`.
- **Manifests:** `defineArtifact` from `@mostra/react`; `as const` and `satisfies` allowed; a manifest that is present needs a `title`; `id` is an `art_` ULID; no manifest means defaults with a title from the directory's name.
- **Identity:** the binding path is the real path; a manifest `id` wins over a path binding; a move rebinds and a copy conflicts.
- **Digests:** the exact listing format, `.DS_Store` and backup files ignored, symlinks followed, hashes of the staging copy; `kitVersion` and `browserProtocolRevision` are `null` until WP-18 and WP-07.
- **Store:** `cache/staging/` for publishes in progress; version directories sealed read-only; `request` rows for `requestId` replay.
- **Builds:** one builder child per build with a minimal environment (`PATH`, `HOME`, `TMPDIR`, `NODE_ENV`) and an `envPrefix` no variable has, so nothing in the supervisor's environment can reach a bundle; MDX through `@mdx-js/mdx` in a small plugin rather than `@mdx-js/rollup`, which would install a second bundler.

## Evidence

| ID | State | Check | Command | Result |
|---|---|---|---|---|
| AU-01 | verified | A plain React page with no Mostra import or manifest, a single MDX page and a directory artifact publish through a real `mostra-runtime daemon` and render in Chromium from their version directories: Tailwind styles apply, state updates, MDX tables and components render, frontmatter stays out of the page, no console or page errors. The verify part of this check is WP-09's (D93) | `pnpm --filter @mostra/runtime test:integration` (`render.test.ts`, `publish.test.ts`); CI run [38165573375](https://github.com/mostra-dev/mostra/actions/runs/38165573375) `integration` on Linux and macOS; `prove-seeds.ts --only AU-01` | 4 render and 3 build tests green on both platforms; seed (Tailwind dropped from builds) red, green when restored |
| AU-02 | verified | `page.tsx`, `page.mdx` and a directory with `pages/` (index, nested `[id]` route, settings), a layout, components through `@/`, JSON data, `public/` assets, CSS, a `"use server"` module and `live.ts` each publish and render; deep links render inside the layout; the server function's body is only in `server/entry.mjs`, the client has its ID, for server modules of every script extension (`.cts` included); the registry lists routes, actions with `dryRun` and live sources | same; `scan.test.ts`; `prove-seeds.ts --only AU-02` | green; seed (server modules reach the browser unchanged) red, green when restored |
| AU-03 | verified | Fixtures have no `package.json` or config; every file's size and mtime under the authoring directory are identical before and after publishing | `publish.test.ts` ("writing nothing", directory case); `prove-seeds.ts --only AU-03` | green; seed (publish writes a cache file into the artifact) red, green when restored |
| AU-04 | verified | Title, description, family, links, policy and the latest manifest round-trip through `artifact/get` (by ID and by path) and `artifact/list` (with a family filter); `mode` is `spa` when omitted; a host's publish policy overrides the manifest's request; every field is read by the extractor unit test. The results part is WP-06's (D93) | `publish.test.ts` (metadata round-trips), `manifest.test.ts`; `prove-seeds.ts --only AU-04` | green; seed (description dropped) red, green when restored |
| AU-07 | verified | Ten non-literal shapes (variable, call, spread, computed key, template placeholder, shorthand, method, non-literal argument, non-`defineArtifact` value, array hole) each give `MOSTRA_MANIFEST_NOT_LITERAL` at the exact line and column, also through `artifact/publish`; the RT-02 audit shows extraction loads no artifact module and a trap that writes a marker when executed never runs; a moved source keeps its ID and a copy claiming it fails with `MOSTRA_PUBLISH_ID_CONFLICT` naming both paths | `manifest.test.ts`, `publish.test.ts` (identity), `audit.test.ts`; `prove-seeds.ts --only AU-07` | green; seeds (evaluation accepted, copy takes the ID over) red, green when restored |
| VR-01 | verified | Digest unit tests: byte, rename, added file and execute bit change `sourceDigest`; order doesn't; every `envDigest` field changes it; the artifact, source and environment each change the version ID, with a known answer computed independently in Python. Integration: the same source publishes as `reused: true` with the same receipt; a change makes version 2; each ignored path (eight kinds) leaves the version unchanged; two artifacts with identical files get two versions (D89); the recorded `outputDigest` equals a listing of the stored, sealed tree built from DATA_MODEL §2's rules alone; an import from outside the artifact is refused, because no digest would cover it; a package, `tsconfig.json` or PostCSS config above the home is neither used nor run | `digest.test.ts`, `source.test.ts`, `publish.test.ts`; `prove-seeds.ts --only VR-01` | green; seeds (artifact left out of the hash, `node_modules` included, outside imports built, slashed output paths, execute bits listed, packages from above the home, the build root's tsconfig and the PostCSS guards removed) red, green when restored. The first run of the second seed stayed green and exposed a test that couldn't tell ignored from included files; the test was strengthened |
| VR-02 | verified | A fault at each of six publish steps (after snapshot, digests, build, archive, promote, and inside the commit), as SIGKILL and as a thrown error, leaves no visible version; a crash's leftovers (staging, archives, version directories) are removed at the next start, and a failure's at once; a crash right after the commit keeps the version and the retry is `reused`; a `requestId` retried after that crash replays the committed receipt; an `artifact/create` retried after a crash between recording its result and writing its entry finishes the entry; a builder killed or hung gives `MOSTRA_BUILD_CRASHED` or `MOSTRA_BUILD_TIMEOUT` and publishes nothing | `publish-faults.test.ts`; CI run [38165573375](https://github.com/mostra-dev/mostra/actions/runs/38165573375); `prove-seeds.ts --only VR-02` | 17 tests green on both platforms; seeds (no undo, no recovery, receipt not recorded with the commit, a retried create left unfinished) red, green when restored |
| VR-11 | verified | After the authoring directory is deleted, `artifact/get` by ID and by the old path return the same detail, the version's files are readable, and the source archive in `sources/` decompresses to a tree whose listing digest equals the version's `sourceDigest`; republishing from the artifact ID says `MOSTRA_ARTIFACT_SOURCE_MISSING`. The archive is a deterministic tar that the system `tar` extracts byte for byte. Results and regression baselines are WP-06's and WP-09's (D93) | `publish.test.ts` (outlive their source), `source.test.ts`; `prove-seeds.ts --only VR-11` | green; seed (no snapshot kept) red, green when restored |
| RT-02 | verified | A real daemon with Node's module hooks recording every loaded module hosts three artifacts (a trapped directory, MDX, a created one) through create, publish, a failing publish, list and get: no module under any artifact, staging or version path, no `.tsx`/`.jsx`/`.mdx`, and no Vite, Rolldown, MDX or Tailwind module loaded; the hook saw the supervisor's own native modules; the trap marker was never written, and a control proves the trap writes when run. Verify and action calls join the audit with WP-09 and WP-08 (D93). Boundary rules keep the bundler, the builder child's modules and native modules out of the supervisor's imports | `audit.test.ts`; `tools/test/gates.test.ts` (boundaries); `prove-seeds.ts --only RT-02` | green; seeds (supervisor imports an artifact module; supervisor imports Vite, a builder-child module and `oxc-parser`) red, green when restored |

Issue #7 (D93) is closed by `reaping.test.ts` ("a child is recorded before it runs"): a supervisor SIGKILLed between spawning a child and recording it leaves no running gate, no marker from the command and no `child` row; seed (no gate) red, green when restored. The write-once triggers on `version` and `event` are proven in `ledger.test.ts`.

## Independent review (D80)

- **GPT-6.1-Sol** through `codex review --base origin/main` (codex-cli 0.162.1, OpenAI, ChatGPT sign-in), effort high, 2026-10-11, on `63d3223`: 2,528,993 input tokens (2,391,168 cached), 16,925 output tokens (9,907 reasoning). A GPT-only run, announced before it started (D34).
- **GitHub Copilot** posted no review on the draft pull request (as on WP-02).
- **Claude Opus 5.5** reviewed the package after the GPT fixes, with Mirza's approval; see below.
- **CodeQL** flagged two check-then-read file races (`js/file-system-race`, warnings). Both were fixed by reading without a prior check; the alerts are closed.

All ten GPT findings held up. Each is fixed in `b2f118a` with a regression test, and each test was shown red on the old behaviour (`prove-seeds.ts --only review-N`; finding 9 in a Linux container, since macOS file systems ignore the normalization difference):

| # | Finding | Fix and test |
|---|---|---|
| 1 (P1) | A build error quoting an import with capability material (`?t=…`) reached the host unredacted | The protocol server redacts the message, hint and fix text of every diagnostic it returns, with the instance's `Redactor`. `publish.test.ts` finding 1 |
| 2 | A file's failed `fsync` during sealing was swallowed like an unsupported directory sync | `fsyncPath` tolerates only a directory's unsupported sync; a file's failure fails the publish. `store.test.ts` |
| 3 | The source archive's rename and a new `sources/<artifact>/` directory weren't synced before the receipt | The containing directories are synced after the rename and the creation. Inspection (a power cut isn't testable here) |
| 4 | `artifact/create` retried after a crash between writing the entry and recording the result failed with `MOSTRA_ARTIFACT_DIR_NOT_EMPTY` | The result is recorded first, then the entry written; a retry finishes it, completing a write cut short and leaving an author's edits alone; creates are serialized. `publish-faults.test.ts` (fault point `create:after-record`) |
| 5 | An absolute import of a file outside the artifact built, outside every digest | A `mostra:confine` plugin refuses any relative or absolute import from an artifact file that resolves outside the artifact (`MOSTRA_BUILD_UNRESOLVED`, "outside the artifact"); packages still come from the warm set. `publish.test.ts` finding 5 |
| 6 | `registry.json` was listed as `/registry.json` in the output digest | Paths are relative to the version directory |
| 7 | The output digest listed execute bits that sealing removes | The listing records the sealed tree's modes, so it can be recomputed from the stored version. `publish.test.ts` findings 6 and 7 (an independent listing of the stored tree) |
| 8 | `(async () => …) satisfies F`, `as`, `!` and aliases were rejected as server exports | Erased TypeScript wrappers are unwrapped and identifiers followed before the async check and the `dryRun()` scan; overload signatures and `declare`d exports are skipped. `scan.test.ts` |
| 9 | A single file with a non-NFC name failed on Linux | The entry is read by its on-disk path; the snapshot keeps the NFC name. `publish.test.ts` finding 9, red on the old code in `node:24.12.0-bookworm` |
| 10 | Exported enums and namespaces in a `"use server"` module were silently skipped | They are values at run time, so they are `MOSTRA_ACTION_EXPORT_INVALID` with their location. `scan.test.ts` |

While answering finding 5, build messages turned out to carry terminal colour codes; diagnostics now strip them.

### Claude Opus 5.5 review

Mirza approved an Opus review (D80) and ran it with his Claude cloud credits: Claude Opus 5.5 through Claude Code, 2026-10-11, on `1113b45`. It ran the protocol, React and runtime builds and the unit, integration and render suites in a Linux container (as root), and reproduced findings 1, 2, 3 and 5 against a real `mostra-runtime daemon`. Its summary is the last conversation comment on [#10](https://github.com/mostra-dev/mostra/pull/10). Token use was billed to Mirza's credits and isn't reported here.

All nine findings hold. Each is fixed with a regression test that fails on the code before the fix: an `OLD` run with the fix stashed, and for 1 to 3 a seeded proof (`prove-seeds.ts --only claude-N`).

| # | Finding | Fix and test |
|---|---|---|
| 1 (P1) | Build inputs from directories above the home reached versions outside every digest: a `node_modules` package, a `tsconfig.json`, and a PostCSS config that the build even ran | A package import from an artifact or generated file must resolve into the warm set's real directories; the build's root holds Mostra's own `tsconfig.json` and `package.json`, so upward searches stop there; PostCSS is configured inline. `ancestors.test.ts` plants all three beside a real home. Seeds: each guard removed on its own, and the two PostCSS guards (the inline config and the root `package.json`) removed together, since either alone stops the search |
| 2 (P2) | A `.cts` or `.cjs` `"use server"` module wasn't scanned, so its body reached the client and its source map | Every script extension is scanned; stubs are virtual ES modules whatever the file's extension; a client build that meets a module starting with `"use server"` without a stub fails instead of bundling it. `scan.test.ts`, and `publish.test.ts` searches the whole client output |
| 3 (P2) | A version whose directory was lost failed every republish with `MOSTRA_HOME_INTEGRITY`, while that code's hint said republishing rebuilds it | Publish checks a stored version against its recorded output digest and rebuilds a missing or altered directory in place, under the same ID and number; the hint and docs say exactly that. `publish.test.ts` removes the directory, then tampers with a file |
| 4 (P2) | `artifact/get` by path used Node's JavaScript `realpath`, which keeps the caller's spelling, while bindings use the native one | The native `realpath`. `publish.test.ts` looks an artifact up by another spelling on a case-insensitive file system (red before the fix on macOS) |
| 5 (P3) | `artifact/list` ordered by the latest version's first publish time, so a republished earlier version sorted too low | Order by each artifact's latest `version.published` event. `publish.test.ts` |
| 6 (P3) | A full disk or an unwritable staging directory while snapshotting was blamed on the author's file | ENOSPC and EDQUOT are `MOSTRA_HOME_DISK_FULL`; a source that can't be read is the author's; any other staging failure stays an internal error with its cause logged. `source.test.ts` |
| 7 (P3) | A source that changed mid-publish, an unreadable entry and a directory that can't be resolved surfaced as `MOSTRA_HOST_INTERNAL_ERROR` | The new code `MOSTRA_PUBLISH_SOURCE_CHANGED` for the first, and `MOSTRA_ARTIFACT_SOURCE_UNREADABLE` or `_SOURCE_MISSING` for the others. `publish.test.ts` (unreadable entry); a change mid-publish depends on timing and is checked by inspection |
| 8 (P3) | A gated child whose identity `ps` couldn't read was never released, recorded or stopped | It counts as a failed registration: the child is stopped and the spawn fails. Inspection; a failing `ps` can't be provoked in a test |
| 9 (P3) | The sealing test's write refusal failed as root | Checked only for an ordinary user; the mode check holds for everyone |

The first seed for the PostCSS guard stayed green: the staging `package.json` alone already stops the search. `prove-seeds.ts` now lets a seed plant several edits, and each guard is proven separately.

## Findings of this session's own checks

- The seeded proof for "`node_modules` is part of the source" first stayed green: the ignore test couldn't tell ignored from included files. The test now adds each ignored path alone and expects the same version.
- dependency-cruiser's `exclude` matched any path with a `dist/` segment, which hid every npm package that lives in its own `dist/` (Vite among them): WP-01's "Vite only in the builder" rule could never fire. The exclude now covers only this repository's build outputs, and a seeded test proves the three supervisor rules (`605d8f9`).

## Agent-facing prose (D93)

Delegated, and written following the writing-for-agents guidance: the hints and docs pages of the 21 new codes (`MOSTRA_PUBLISH_SOURCE_CHANGED` came from the Claude review), the corrected `MOSTRA_HOME_INTEGRITY` hint, `packages/react/AGENTS.md`, `packages/warm/AGENTS.md` and the additions to `packages/runtime/AGENTS.md`. None needed Mirza's review before the merge.

## Untested boundaries

- Rendering is checked in Chromium only; Firefox and WebKit join with the gateway's e2e suites (WP-05).
- The source tree has no size limit: publishing a very large directory takes as long as copying it.
- A build's `outputDigest` is recorded, never compared; Mostra claims no byte-identical rebuilds (VR-01).
- Confinement covers module imports (JavaScript, TypeScript, MDX, JSON and assets imported from code). A CSS `@import` or `url()` that reaches outside the artifact goes through Vite's CSS resolver and isn't refused; such a file would still be missing from the snapshot, so it resolves only by absolute path.
- Directory syncs after the archive rename (GPT finding 3) are checked by inspection, not by a power cut.
- `MOSTRA_PUBLISH_SOURCE_CHANGED` (a source edited between the two reads of one publish) and the stopped gate when `ps` fails (Claude findings 7 and 8) are checked by inspection: both depend on timing or on a failing system tool.

## Commits and publication

- **Range:** `79216c4..87487b5` on `main`: 30 signed-off commits on `wp/03-builder` (`232eb44` to `ec47ea1`) and the merge commit `87487b5` of [#10](https://github.com/mostra-dev/mostra/pull/10). This report lands through its own pull request (D79).
- **On `main` after the merge:** CI [38167206158](https://github.com/mostra-dev/mostra/actions/runs/38167206158), CodeQL [38167206134](https://github.com/mostra-dev/mostra/actions/runs/38167206134) and Scorecard [38167206110](https://github.com/mostra-dev/mostra/actions/runs/38167206110), all green.
- **Packages:** nothing published. Changesets record minor releases of `@mostra/protocol` (the manifest, the artifact methods and their codes) and `@mostra/runtime` (builder, registry and publish), and the first release of `@mostra/react`; `@mostra/warm` is private. The release pipeline is WP-11's (EN-05).
- **Docs:** generated diagnostic pages for the 21 new codes in `docs/reference/`; the docs site is WP-26's.
- **Issues:** [#7](https://github.com/mostra-dev/mostra/issues/7) closed by the child gate.
- **Follow-ups for later packages** are in their specifications (D93): WP-04 (on-demand packages extend the warm set and the lockfile), WP-05 (`PublishReceipt.url` on every publish, D90; the render fixtures through the gateway in Chromium, Firefox and WebKit, added to its specification at finalization), WP-06 (event reading on the `event` table; results in AU-04 and VR-11), WP-07 (history mode, fields and the browser-protocol revision in `envDigest`), WP-08 and WP-09 (verify and action calls in the RT-02 audit; verify on the AU-01 and AU-02 fixtures; regression baselines from the source snapshots), WP-10 (`mostra dev` through `RenderMode.dev`).
- **Remaining dirty paths:** none in the repository. Outside it: disposable scripts and prototypes in `$JCODE_SCRATCH_DIR/wp03`, `proto3` and the review transcripts `review-wp-03.md` and `review-wp-03.err`.

## Next

WP-04, dependencies (`docs/design/work-packages/WP-04.md`).
