# WP-W2 progress: Windows II, gateway, workers, verify and CLI

**Status:** Accepted by Mirza on 2026-10-24 ("Approved!", M37) with D151; the Claude Opus review's ten findings are fixed (below). Merge and release follow (work-packages/README.md §4).

## Baseline

| | |
|---|---|
| Branch | `wp/w2-windows-local`, created from `origin/main` |
| Starting `HEAD` | `ecdceca` (`origin/main` at branch time, 2026-10-23: "ci: cache the e2e engines' apt downloads (#58) (#59)") |
| `git status` | clean |
| `pnpm check` | 27 min on macOS arm64. Green: format-lint, types, hygiene, e2e, build, boundaries, api, licenses, rust, docs and commits.<br>Four failures, each green when run alone right after:<br>• the runtime's RT-03 park test (`lifecycle.test.ts`, the known load flake #42);<br>• the SDK's HO-04 test (a `fail` verdict under the full run's load);<br>• the conformance kit's `delivery.retry` against the Rust reference host;<br>• `@mostra/tools`' knip gate, which met this branch's first file (the temporary probe, written while the check ran).<br>The local summary also misattributed results. It showed `integration` green, though Turbo reported two of its tasks failed. It failed `unit` for `@mostra/tools#test`, which Turbo reported successful. CI runs each job alone, so CI isn't affected. |
| Predecessors | WP-W1 done ([PROGRESS-WP-W1](PROGRESS-WP-W1.md) on `origin/main`); no `RECOVERY-WP-W2-*.md` |
| Local toolchain | Node 24.12.0, pnpm 12.9.0, macOS 26.2 arm64, and Rust 1.97.1 with the Windows targets for `cargo check` and clippy. Windows behavior is observed only on GitHub's `windows-latest` (Windows Server 2025, x64) and `windows-11-arm` runners. |

## What was built

- **The login service on Windows** (RT-08, RT-11, D151 item 1):
  - `mostra-runtime service install|uninstall|status` and `mostra daemon install|uninstall` register a Task Scheduler task at the user's own logon: `mostra-<home hash>`, `InteractiveToken`, least privilege, no time limit.
  - The task's action is `mostra-win-service.exe`, a windows-subsystem launcher in `crates/mostra-win`. It runs the daemon without a window, in a kill-on-close job, and appends the daemon's output to `<home>\logs\service.log`.
  - The launcher restarts the daemon 10 s after an exit that isn't 0. On its named event it stops the daemon with Ctrl+Break, and forces the job closed after 15 s.
  - The idle check and `mostra doctor` read the definition kept at `<home>\service\task.xml` instead of asking Task Scheduler.
- **Clients reach a Windows pipe only through the helper** (D151 item 2). `@mostra/sdk` gains `connectControl`, which on Windows uses `mostra-win connect`. The helper refuses a pipe another user created under a name `instance.json` still names. The CLI and the end-to-end harness open every session through `connectControl`.
- **The CLI on Windows** (D151 item 3):
  - Its platform gate is the runtime's, behind `MOSTRA_DEV_WINDOWS=1`.
  - Its home is `%LOCALAPPDATA%\mostra` and its config directory `%APPDATA%\mostra`.
  - `mostra open` opens a launch page through `explorer.exe`, with no shell. `$BROWSER` takes `;`-separated Windows command lines.
  - Telemetry reports `win32`, and `dev` also stops on Ctrl+Break.
  - The detached daemon and the telemetry flusher run in their file system's root.
  - A lock that Windows is still deleting counts as held.
- **Homes compared by native real path** (D151 item 5). Windows' 8.3 short names, such as `RUNNER~1`, no longer split one home in two.
- **Workers and the verify runner** (D151 item 4) send no process-group signal on Windows and report Windows exit statuses in hexadecimal.
- **`mostra dev` under Windows and editors** (D151 item 6):
  - Vite's module IDs are compared through `pathKey`, so React Fast Refresh holds on Windows.
  - A file an editor holds is synced later.
  - A file is removed only after it has been missing for 1.5 s.
  - Session directories are removed through `removeTree`.
- **The gateway on every system.** A refused request is read to its end, for at most 5 s and 16 MiB, so its answer arrives. Before, a browser sending a megabyte of cookies got a reset instead of the page that clears them.
- **CI** (D151 item 8):
  - Every runtime integration suite runs on Windows x64 and arm64, in seven Windows groups. `windows-groups.test.ts` checks that they partition the suites.
  - The CLI's suites, the hygiene checklist, and the browser suites in Chromium and Firefox run there too.
  - `WINDOWS_PACKAGES` covers protocol, runtime, server, worker, verify, shell, react, CLI and e2e.
  - `windows-seeds.yml` builds every package Windows runs, installs the verify browser and turns the firewall on with its blocks audited.
- **Docs**:
  - D151 (proposed);
  - ARCHITECTURE §4, DATA_MODEL §1, FAILURE_MODEL §2, §6 and §10, INTERFACES §6 and §9, and REPO_STANDARDS §6;
  - VERIFIED_FACTS (WP-W2) and `docs/agents/run-on-windows.md`;
  - the AGENTS.md files of the runtime, the CLI, the SDK and `mostra-win`;
  - the CLI help and two diagnostic hints that name Task Scheduler;
  - 13 changesets.

## Decisions taken in the package

**D151** (approved at M37), items 1 to 8, amended by the Opus review's fixes. Choices made while building, inside it:
- **A temporary probe first.** `813c964` added it and `83c355b` removed it. It established the Windows facts before anything was built on them.
- **WebKit stays off the Windows e2e legs.** On Windows, Playwright's WebKit port keeps no SameSite on cookies (Playwright's own tests expect `None` there), and no viewer uses it. Safari's engine keeps its legs on macOS.
- **Windows runs one e2e test at a time.** With two at once, Firefox there took tests past their 30 s limit.
- **Seeds run their suites through `pnpm exec`, as `pnpm check` does.** Run straight through Node, a supervisor started from the checkout couldn't load oxc-parser's native binding. Every `mostra dev` seed, VR-08's included, then came back red after its restore.

## Evidence

The checks go through the real interfaces:
- the built `mostra-runtime` and `mostra` run as real processes on GitHub's Windows runners (`windows-latest`, Windows Server 2025 x64, and `windows-11-arm`);
- a second local user (`mostraother`) takes part in every access check;
- seeded violations go through `prove-seeds.ts`.

Windows behavior is observed only on those runners.

| ID | State | Check | Command | Result |
|---|---|---|---|---|
| RT-11 | validated | On both Windows runners, every Windows leg of CI passes, as do macOS and Linux:<br>• **Integration**: every runtime suite (gateway, interaction, workers that crash, run out of memory or busy-loop, actions, live data, verify and its failure modes, `dev` with hot updates and an editor's backup-then-write save), and the CLI's suites (`open` through a stand-in browser whose launch page another user can't read, the daemon's pipe refused when another user took its name, the daemon keeping no hold on the directory it started from).<br>• **Hygiene**: the checklist against a real gateway.<br>• **Browsers**: Chromium and Firefox (controls, the shell, actions, versions, pages, `open`).<br>• **Login service**: `daemon install` writes a logon task for the user's SID. Its launcher is a windows-subsystem program (PE subsystem 2). It runs the always-on daemon without a window and starts it again after a kill. `uninstall` stops the daemon with Ctrl+Break (`instance.stopped`, `SIGBREAK`, nothing forced) and leaves no task and no `instance.json`.<br>• **Firewall**: a gateway on a Node.js the firewall has never seen logs no block (event 5031), while a wildcard listener does.<br>• **Secret store**: its files grant only the user and `SYSTEM`, and the second user can't read them.<br>**Login service, after the Opus review**: an uninstall with no event in reach stops the daemon over its pipe and removes a task whose definition the home lost; the end of the session stops the daemon in order; a stop event another user owns is refused; a task removed in Task Scheduler stops counting for the idle check.<br>**Homes**: a home's 8.3 spelling and another case are the same home, a Kelvin-sign twin is another.<br>**Seeds**: RT-11's 20 seeds. On Windows x64, the 19 that run there are red when planted and green when restored; the 20th (the telemetry lock) needs POSIX and is red then green on macOS, as are the 4 other portable ones. | `pnpm check --job unit\|integration\|hygiene\|e2e` with `MOSTRA_DEV_WINDOWS=1` (CI's Windows legs); `gh workflow run windows-seeds.yml -f only=RT-11` | CI run 40092846097 on `52d0d3f`: all 53 jobs green (also 40082018456 on `83c355b` and 40083519550 on `1ad2c3d`). Windows integration groups take 4 to 7 min on x64 and 7 to 14 min on arm64. Seed run 40092848509 (x64, 19 of 19), earlier 40077458287 (arm64, the first 9) |

**Still open: a real logon.** The task's logon trigger is checked in its definition, and the task is started with `schtasks /Run`. A runner has no interactive logon, so whether the service starts at login is unproven. It needs a Windows 11 machine (see "Untested boundaries").

**Checks that extend earlier packages' rows.** Each row stays with its owner:
- **HY-01 (WP-05).** The cookie-jar check now sends four times the header limit and reads only after it has sent everything. It is red on macOS too without the lingering refusal.
- **EN-08 (WP-10).** A telemetry lock that can be neither taken nor broken now gives up within 2 s. The bug predates WP-W2, and the GPT review found it.

## Reviews (D80)

- **My review of the diff**, during the work:
  - D151's description of the `dev` rule had fallen behind the code;
  - `commandLineOf` answered empty for a missing process, and now names it;
  - Windows CI showed many test assumptions that held only on POSIX, each now with a Windows form.
- **GPT-6.1-Sol** through `codex review --base origin/main` (OpenAI, ChatGPT sign-in), effort high, on 2026-10-24 against `f65a3ff`. 4,271,660 input tokens (4,104,192 cached) and 11,396 output (5,739 reasoning). A GPT-only run, announced first (D34). It found two problems, both valid and both fixed in `c41f76a`, each with a seed red when planted and green when restored:
  1. (P1) The telemetry lock's loop could skip its deadline, so a lock that could be neither taken nor broken held the CLI forever. The loop now checks the deadline on every path. A unit test runs the lock in a process of its own with a time limit.
  2. (P2) Once the daemon ran in the file system's root, a relative `MOSTRA_RUNTIME_BIN` named nothing. The entry is now made absolute first, and a contract test covers it.
- **Copilot**: didn't review; its quota is used up, as on earlier packages.
- **Claude Opus 5.5** (D144), run by Mirza through Claude Code against `1ad2c3d` from the prompt the session wrote, posted on the pull request on 2026-10-24 ([review 5637871189](https://github.com/mostra-dev/mostra/pull/62#pullrequestreview-5637871189)). It ran nothing on Windows, so it marked the findings that depend on Windows behavior "possible". Token usage isn't reported by that surface. Ten findings, every one taken as valid and fixed, each with a test and a seed red when planted and green when restored (on Windows where the seed is Windows'):

| Finding | Fix | Proof |
|---|---|---|
| 1 (possible) On Windows the launch page took `%TEMP%`'s access list, which may let other users read the ticket | The page goes under `%LOCALAPPDATA%\mostra-cli\open`, never `%TEMP%` | `contract.test.ts` "open --browser": `TEMP` points at a folder every user reads, and the second user reads a file there but not the page; seed |
| 2 A lock file that can't be created made Windows spin for 2 s | Access denied with no lock file present gives up at once; every retry checks the deadline | `telemetry.test.ts` "gives up at once under Windows' lock rules" (POSIX, since the runners' administrator passes any access list); seed |
| 3 Relative `MOSTRA_*` paths resolved against the root once the daemon and flusher ran there | Every path variable is made absolute against the command's directory before a detached start | `detached.test.ts` classifies every Mostra variable a process reads; `contract.test.ts` starts a daemon with a relative runtime entry through a link and a relative runtime directory; seeds |
| 4 (possible) An uninstall from another logon session killed the daemon | With no event in reach, `uninstall` stops the daemon with `mostra/shutdown` over the pipe | `lifecycle.test.ts` "over its pipe when no event reaches the launcher"; seed |
| 5 Only `task.xml`'s existence counted; a task removed in Task Scheduler still counted, and a lost definition left the task | The definition is written only once Task Scheduler took the task; the idle check asks Task Scheduler at most once a minute; uninstall removes a task the home lost | `lifecycle.test.ts` "counts its task only while Task Scheduler holds it" and the lost-definition case; two seeds |
| 6 (possible) Anyone could create the stop event's predictable name first | The name has a random part, and the launcher and `service-stop` refuse an event another user owns | `lifecycle.test.ts` "refuses a stop event another user created"; seed |
| 7 (possible) `samePath`'s case folding could make two homes NTFS keeps apart one | Homes compare by their exact native real paths | `windows.test.ts` "a home's spellings": a Kelvin-sign twin is another home; seed |
| 8 Two seeds were caught only by chance | A dedicated test makes the 8.3 spelling itself; the firewall test judges by the firewall's record alone | the two seeds red on what they plant |
| 9 (possible) Logoff ended the daemon without an orderly stop | The launcher's hidden window hears the session's end and stops the daemon with Ctrl+Break | `lifecycle.test.ts` "when the user's session ends" (the probe sends what a logoff sends); seed |
| 10 Several ways to find the helper | The e2e harness and the conformance kit use the SDK's `connectControl` with the runtime they resolve, and an SDK test pins the order to the runtime's | `control.test.ts`; Windows CI then found the SDK starting from a link's path where the runtime starts from the real one, fixed in `973bd3c` |

  Fixing them, Windows CI also found the launcher's refusal logged under the wrong event name (a field named `event` overwrote the line's own), fixed in `52d0d3f`.

## Untested boundaries

- **A real logoff.** The launcher's handling of a session's end is proven with the messages a logoff sends, sent by the probe; no runner can log its user off.
- **The telemetry lock under a real access list on Windows.** The runners' administrator passes any list, so the immediate give-up is proven under Windows' rules on POSIX.
- **The login service's logon.**
  - A real logon starting the task was never exercised (above). The task and its launcher were run with `schtasks /Run` on the runner's administrator account.
  - Logoff ending the job was never exercised.
  - An ordinary user installing the service was never exercised. The probe showed such a user can create the task.
- **No window appears**, as far as can be shown without a desktop: the launcher is a windows-subsystem program (PE subsystem 2) that starts Node.js with `CREATE_NO_WINDOW`. No runner has a desktop to look at.
- **The real default browser** for `mostra open` through `explorer.exe`. The probe saw Edge load such a page; the suites use a stand-in browser.
- **Ctrl+C or Ctrl+Break at a real console** for `mostra dev`. The suite sends Ctrl+Break through the helper.
- **Antivirus holding files.** Only what the runners' Defender does on its own was exercised. It once held a freshly built launcher, and the seed runner now retries the build.
- **RT-03's park test** still sometimes times out on loaded macOS runners (#42, open before this package).

## Deviations

- **No WebKit on Windows** (see "Decisions taken in the package"). The specification asks for Windows legs in the e2e job; they run Chromium and Firefox.
- **The lingering refusal applies on every platform.** The gateway fix is not Windows-only: the cookie-clearing page was lost wherever a client read late.
