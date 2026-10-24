# @mostra/cli

The `mostra` command (D60, INTERFACES §9): a thin client of the host protocol that agents and
people run. Audience: agents, people. Runs in: node. May import: @mostra/protocol, @mostra/sdk
(tools/package-map.ts); it reaches the runtime only by starting `mostra-runtime` and speaking the
protocol over the home's socket.

## Invariants it owns

- **Every command is a definition in `src/commands/`.** The parser, `--help`, `--help --json`,
  `docs/reference/cli.md` (`pnpm fix` regenerates it; the `docs` job checks it), telemetry's
  command names and the contract tests all read `COMMANDS`. A command never prints or exits on its
  own: it returns `{ result, human?, exit? }` or throws a diagnostic, and `src/run.ts` decides the
  rest.
- **No logic the protocol lacks.** A command calls host protocol methods (`context.call`) or the
  runtime binary (`context.runtime`, for `service`). Anything a host couldn't do through the
  protocol is a protocol gap to fix in `@mostra/protocol` and the runtime, never CLI code.
- **`--json` means exactly one JSON value on stdout** (one per line for a stream), whatever
  happens: usage errors (`--json` is read before parsing), crashes (`MOSTRA_HOST_INTERNAL_ERROR`,
  exit 3) and refusals. `ok` means the command produced its result, not that the artifact passed.
  Logs, progress, warnings and telemetry's words go to stderr.
- **One exit-code table** (`src/exit.ts`), keyed by diagnostic code and total over the catalog's
  areas by type; a test checks every catalog code.
- **A hint never names a command that doesn't exist.** A unit test parses every `mostra …` a
  catalog entry's hint, explanation or fix names. A later package's command (`share`, `review
  export`, `export`, `mcp`, `plugin`, `term`, `run`) joins `COMMANDS` with its package, never as a
  placeholder (D140 item 12).
- **No prompt outside a terminal.** Only telemetry asks anything, and only when stdin and stderr
  are terminals, without `--json`, CI, an agent's marker or a command that reads stdin.
- **Telemetry is this package's alone (D119, D140).** `src/telemetry/` is the only code in Mostra
  that can send an event; a dependency-cruiser rule (`telemetry-cli-only`) keeps every other
  package from importing it. The decision order in `decision.ts` stops at the first match, so an
  explicit off beats any on. Every event is checked against the strict schema in `events.ts`,
  which `docs/reference/telemetry.md` publishes, before it is queued and before it is sent. With no
  endpoint (this package's build: the release workflow sets `__MOSTRA_TELEMETRY_ENDPOINT__`)
  nothing is shown, asked, created or queued. The notice and question texts in `words.ts` are
  Mirza's, approved word for word (M28).
- **The ask-first zones come from tzdata.** `data/tzdata/` holds the release's files and
  `scripts/ask-first-zones.ts` writes `src/telemetry/zones.generated.ts`; a test checks one
  against the other. Names are matched as given, never canonicalized.
- **The browser never gets a link's secret.** `mostra open` prints the link and opens a one-time
  launch URL (`view/launch`), run with direct arguments, never through a shell.
- **A Windows pipe is opened only through the helper (D151).** Every session goes through the
  SDK's `connectControl`, which on Windows runs `mostra-win connect` and refuses a pipe another
  user created under the name `instance.json` names; a plain `net.connect` would hand that user the
  CLI's requests.
- **The platform gate is the runtime's** (`platform.ts`): macOS and Linux on x64 and arm64, Windows
  only with `MOSTRA_DEV_WINDOWS=1` until WP-W3, everything else `MOSTRA_PLATFORM_UNSUPPORTED`.

## Public interface

`src/index.ts` (the runner, the command definitions, the exit table, the help generators); the
API report is `etc/cli.api.md`. The binary is `src/bin.ts`.

## Tests to run

- `pnpm --filter @mostra/cli test`: the contract checks that need no instance (exit table, named
  commands, parser, help, `--json` on usage errors) and telemetry's rules.
- `pnpm --filter @mostra/runtime build`, `pnpm --filter @mostra/cli build`, then
  `pnpm --filter @mostra/cli test:integration`: the built `mostra` against real daemons, a contract
  test per command (envelope schema, exit code, no prompt without a terminal, logs on stderr),
  telemetry against a local fake collector (EN-08), gc (VR-06).

## Gotchas

- On Windows the home defaults to `%LOCALAPPDATA%\mostra`, the config directory to
  `%APPDATA%\mostra`, the opener is `explorer.exe` and `$BROWSER` is `;`-separated (D151). The
  suites run there in the `windows-clients` group; Windows checks use the second local user
  (`asOtherUser` in `test/support.ts`) where POSIX checks read modes.
- Tests always set `MOSTRA_CONFIG_DIR` to a temporary directory, so no run writes a developer's
  real telemetry settings, and `MOSTRA_TEST_LOCALTIME` stands for `/etc/localtime` (empty for
  none), because CI machines' zone is UTC, an ask-first zone.
- `wait --timeout` is the wait's own length (exit 5, `still_waiting`), not the global request
  limit (exit 4).
- The runtime is found as the SDK finds it (`resolveRuntime`): `MOSTRA_BUNDLE`, then
  `MOSTRA_RUNTIME_BIN`, then the runtime bundle the CLI sits in, then a development checkout's
  `../runtime/dist/bin.js`; the runtime runs on that bundle's own Node.js.
- **A copy installed from npm bootstraps** (`src/bootstrap.ts`, RT-01): outside a bundle, with the
  release's pins in `@mostra/sdk`'s `dist/bundles.json`, `bin.ts` installs the pinned bundle
  (progress on stderr; with `--json` a failure is still one envelope) and runs the bundle's own
  `mostra` with the same arguments, passing on its exit code and signals. Nothing else of the CLI
  loads on the system's Node.js, so `bootstrap.ts` must keep to Node.js 22.19's features. It
  forwards SIGTERM and SIGHUP, and SIGINT only when no terminal is attached: at a terminal Ctrl-C
  already reaches the bundle's `mostra` (one process group), and a second SIGINT would cut short
  `mostra dev`'s graceful stop. Every failure, a spawn error included, is one `--json` envelope.
- **One timer per deadline.** `--timeout` belongs to the command's one timer (`withTimeout` in
  `run.ts`), which names what was underway when it runs out: starting the home's daemon (the
  connection reports it through `onStarting`) or the command itself. `startDaemon` keeps only its
  own 30 s limit. Two timers for one deadline raced, and which one fired decided the message.
