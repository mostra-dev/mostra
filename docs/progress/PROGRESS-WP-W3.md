# WP-W3 progress: Windows III, distribution, SDK, host crate and conformance

**Status:** In progress. The report grows during the session and is finalized after acceptance
(work-packages/README.md §4).

## Baseline

| | |
|---|---|
| Branch | `wp/w3-windows-distribution`, created from `origin/main` |
| Starting `HEAD` | `9675dab` (`origin/main`, 2026-10-25: "docs(progress): MT-01's closeout, Mostra 0.5.0 (#78)") |
| `git status` | clean |
| `pnpm check` | 29 min 45 s on macOS arm64. Green: format-lint, types, unit, integration, hygiene, e2e, build, boundaries, api, licenses, rust, docs and commits. One failure: `conformance`, the Rust reference host's broken mode, whose `delivery.retry` saw no `submission.retrying` event while the delivery waited, under the full run's load (as in WP-W2's baseline). `pnpm check --job conformance` alone right after: green in 191 s |
| Predecessors | WP-W2 done ([PROGRESS-WP-W2](PROGRESS-WP-W2.md) on `origin/main`), and MT-01 after it ([PROGRESS-MT-01](PROGRESS-MT-01.md)); no `RECOVERY-WP-W3-*.md` |
| Local toolchain | Node 24.12.0, pnpm 12.9.0, Rust 1.97.1, macOS 26.2 arm64. Windows behavior is observed only on GitHub's `windows-latest` (Windows Server 2025, x64) and `windows-11-arm` runners |

## What was built

- **Windows runtime bundles** (D153 items 1 to 4): `mostra-<version>-win32-x64.tar.gz` and `…-win32-arm64.tar.gz`, each built on its own runner by the same assembler (`packages/bundle/scripts/build.ts`): the official Node.js zip of that architecture, pinned and unpacked with Windows' `tar.exe`; the hoisted libraries and the isolated warm set; native launchers `bin\mostra.exe`, `mostra-runtime.exe` and `mostra-setup.exe` (one program, `mostra-launch`, new in `crates/mostra-win`); the helpers `mostra-win.exe` and `mostra-win-service.exe`; `bin\THIRD-PARTY-LICENSES.txt` from `cargo metadata`, which the license audit requires. A Windows archive holds no links: `files.json` lists them, and setup makes each a junction at the bundle's real path, so an ordinary user installs a bundle; the setup marker records its root, so a moved bundle is set up again. The assembler runs pnpm by `npm_execpath` and carries no `.bin` shims (they name the build machine).
- **The protocol** (`@mostra/protocol`): `BUNDLE_PLATFORMS` gains `win32-x64` and `win32-arm64`, `isWindowsBundle`, a widened asset pattern the schema gate proves additive, and `BundleSetup.root` (optional); `MOSTRA_PLATFORM_UNSUPPORTED`'s hint and page name Windows.
- **The SDK** (`@mostra/sdk`): the platform gate admits Windows; the cache is `%LOCALAPPDATA%\mostra-cache`; extraction refuses a link in a Windows archive; setup makes the junctions (`src/bundle/links.ts`) and reads them back against either spelling of the root (an 8.3 short name or the real path); renames into the cache ride out sharing violations; a process the SDK starts keeps Windows' system variables a host's environment lacks (`src/environment.ts`) and opens no console window.
- **The Rust crate** (`mostra-host`): Windows platforms, the Windows cache, the same extraction, junction and setup rules as the SDK, setup run on the bundle's own Node.js (it ran the entry itself, whose shebang wants a machine Node.js), attach over the home's pipe opened with `SECURITY_IDENTIFICATION` and refused unless the user owns it (`src/windows.rs`, the crate's only `unsafe`), a daemon started detached in its file system's root, instances without signals or console windows, `file:` mirrors read through their URL's path, homes spelled without `\\?\`, and a Windows session that drops both halves of its pipe when it closes.
- **The conformance kit** (`@mostra/conformance`): the TypeScript reference host starts on Windows (its entry judged by file URL); the harness client starts a shim without `detached` on Windows and ends its tree with `taskkill`; `home.privacy` judges owner-only by access list on Windows (`src/privacy.ts`, SDDL through `Get-Acl`), and `home.authoring-removed` compares native real paths.
- **`create-mostra` and the CLI**: no development switch; their suites run on Windows.
- **The switch is gone** (D153 item 8): the runtime's and the CLI's gates admit Windows on x64 and arm64; `MOSTRA_DEV_WINDOWS` is removed from the code, the service, the suites, Turbo and CI.
- **The release and CI** (D153 items 7, 9): six bundles in `release-build.yml`, `release.yml` and the plan (`tools/check/matrix.ts`); the npm path on Windows x64 and arm64; every smoke test submits through the bundle's browser and reads the answer back with `wait` and `results` (`packages/bundle/scripts/submit.mjs`); the Windows smoke tests run with long paths off and then install as a second, non-administrator user with Developer Mode off; `rust` and `conformance` get Windows legs with a second user for the crate's pipe-owner check; the `windows-clients` group runs the SDK's, `create-mostra`'s and the kit's suites; the release tools' `import.meta.main` (their `file://` comparison never held on Windows, so the rehearsal wrote no version there).
- **#66** (D153 item 10): measured first; no stall alone, but the Windows unit legs now keep their temporary files on the workspace's disk.
- **Docs**: D153 (proposed), ARCHITECTURE §4, INTERFACES §16 and §17, FAILURE_MODEL §10, REPO_STANDARDS §3, §6 and §9, PRODUCT, VERIFIED_FACTS (WP-W3), the READMEs, the AGENTS.md files of the runtime, the CLI and `mostra-win`, `docs/agents/run-on-windows.md`; four changesets.

## Deviations so far

- **One commit carries two subjects' work.** A commit refused by the subject-length hook left its files staged, and the next commit (`1f5de33`, "ci(release): an ordinary user installs each Windows bundle with Developer Mode off") took them too: besides the workflow, it holds the crate's pipe close, the junction reading in either spelling and the kit's privacy check, described in the refused message and here. History isn't rewritten.
- **INTERFACES §16's cache path** said `<archive SHA-256>/<top directory>`; both installers have always put the bundle's root at `<archive SHA-256>/`, which the text now says (found by the npm smoke test).
