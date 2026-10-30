# The mostra CLI

<!-- Generated from the command definitions in packages/cli/src/commands/. Don't edit; run `pnpm fix`. -->

Every command takes `--json`, which prints one envelope on stdout: `{ "ok": true, "result", "instance", "warnings" }` or `{ "ok": false, "error", "warnings" }`. Streaming commands print one envelope per line, the last one carrying `result` or `error`. Logs and progress go to stderr. Without a terminal, or with `--json`, no command asks a question.

Commands: `add`, `daemon`, `dev`, `docs`, `doctor`, `gc`, `host`, `list`, `new`, `open`, `publish`, `push`, `results`, `secret`, `share`, `state`, `status`, `telemetry`, `verify`, `wait`.

## mostra new

```text
Create an artifact in an empty directory, with a generated ID.

Usage:
  mostra new <dir> [flags]

Arguments:
  <dir>                        The directory to create it in; it must be empty or not exist.

Flags:
  --title <text>               The artifact's title. Default: the directory's name.
  --template <family>          Start from a template (templates arrive in a later release).
  --request-id <id>            Make a retry return the first attempt's result.

Global flags:
  --json                       Print one JSON envelope on stdout (NDJSON for streams).
  --home <dir>                 Use this Mostra home instead of MOSTRA_HOME or the default.
  --cwd <dir>                  Resolve relative paths from this directory.
  --timeout <d>                Give up on the instance after this long (exit 4), such as 30s or 5m.
  --help                       Show this command's help; with --json, its definition.

Output: ArtifactCreateResult (mostra docs cli)

Exit codes:
  0  success
  1  artifact failure (verify failed, publish refused, the artifact's state refused the request)
  2  usage error
  3  environment error (no runtime, browser or socket; the home; an unsupported platform)
  4  timeout (--timeout passed)

Example:
  mostra new ./sidebar-review --title 'Sidebar review'
```

## mostra dev

```text
Preview an artifact's unpublished source with hot reload, until Ctrl-C; viewers never see it.

Usage:
  mostra dev <path> [flags]

Arguments:
  <path>                       The artifact's source: a file, a directory, or its ID.

Flags:
  --port <port>                The preview's port on 127.0.0.1; default one the system picks.

Global flags:
  --json                       Print one JSON envelope on stdout (NDJSON for streams).
  --home <dir>                 Use this Mostra home instead of MOSTRA_HOME or the default.
  --cwd <dir>                  Resolve relative paths from this directory.
  --help                       Show this command's help; with --json, its definition.

Output: DevStartResult (mostra docs cli)

Exit codes:
  0  success
  1  artifact failure (verify failed, publish refused, the artifact's state refused the request)
  2  usage error
  3  environment error (no runtime, browser or socket; the home; an unsupported platform)

Example:
  mostra dev ./sidebar-review
```

## mostra verify

```text
Build, render and check an artifact's source; one verdict, nothing published.

Usage:
  mostra verify <path> [flags]

Arguments:
  <path>                       The artifact's source: a file, a directory, or its ID.

Flags:
  --screenshots <when>         Which screenshots the verdict marks as worth looking at. (on-failure, always, never) Default: on-failure.

Global flags:
  --json                       Print one JSON envelope on stdout (NDJSON for streams).
  --home <dir>                 Use this Mostra home instead of MOSTRA_HOME or the default.
  --cwd <dir>                  Resolve relative paths from this directory.
  --timeout <d>                Give up on the instance after this long (exit 4), such as 30s or 5m.
  --help                       Show this command's help; with --json, its definition.

Output: VerifyVerdict (mostra docs cli)

Exit codes:
  0  success
  1  artifact failure (verify failed, publish refused, the artifact's state refused the request)
  2  usage error
  3  environment error (no runtime, browser or socket; the home; an unsupported platform)
  4  timeout (--timeout passed)

Example:
  mostra verify ./sidebar-review
```

## mostra publish

```text
Publish an artifact's source as a new immutable version, gated by verify, and print its link.

Usage:
  mostra publish <path> [flags]

Arguments:
  <path>                       The artifact's source: a file, a directory, or its ID.

Flags:
  --force                      Publish despite verify's errors and record their codes; never what didn't build.
  --policy <policy>            The submission policy to use, instead of the manifest's. (once, once-per-viewer, epochs, none)
  --request-id <id>            Make a retry return the first attempt's receipt.

Global flags:
  --json                       Print one JSON envelope on stdout (NDJSON for streams).
  --home <dir>                 Use this Mostra home instead of MOSTRA_HOME or the default.
  --cwd <dir>                  Resolve relative paths from this directory.
  --timeout <d>                Give up on the instance after this long (exit 4), such as 30s or 5m.
  --help                       Show this command's help; with --json, its definition.

Output: PublishReceipt (mostra docs cli)

Exit codes:
  0  success
  1  artifact failure (verify failed, publish refused, the artifact's state refused the request)
  2  usage error
  3  environment error (no runtime, browser or socket; the home; an unsupported platform)
  4  timeout (--timeout passed)
  6  conflict (already submitted, a compare-and-set mismatch, a reused request ID)

Example:
  mostra publish ./sidebar-review
```

## mostra open

```text
Print an artifact's capability link and open it in a browser; or mint, rotate or revoke a link.

Usage:
  mostra open <artifact> [flags]

Arguments:
  <artifact>                   The artifact: its source path or its ID.

Flags:
  --new                        Mint a separate link instead of the artifact's default one.
  --version <n|id>             A new link that opens only this version.
  --scope <a,b>                A new link's scopes: view, draft, submit, review, signal, action:*. Default: all.
  --ttl <d>                    A new link that expires after this long, such as 24h.
  --viewer <ref>               A new link that acts for this person, by your own stable key for them.
  --viewer-name <name>         The display name of --viewer.
  --rotate <tokenId>           Replace this link with a new one; the old one stops working.
  --revoke <tokenId>           Stop this link from working.
  --browser                    Open a browser even without a terminal.
  --no-browser                 Only print the link.
  --request-id <id>            Make a retried --new return the same link.

Global flags:
  --json                       Print one JSON envelope on stdout (NDJSON for streams).
  --home <dir>                 Use this Mostra home instead of MOSTRA_HOME or the default.
  --cwd <dir>                  Resolve relative paths from this directory.
  --timeout <d>                Give up on the instance after this long (exit 4), such as 30s or 5m.
  --help                       Show this command's help; with --json, its definition.

Output: CapabilityLink (mostra docs cli)

Exit codes:
  0  success
  1  artifact failure (verify failed, publish refused, the artifact's state refused the request)
  2  usage error
  3  environment error (no runtime, browser or socket; the home; an unsupported platform)
  4  timeout (--timeout passed)

Example:
  mostra open ./sidebar-review
```

## mostra share

```text
Open an artifact to people beyond this machine: inside your tailnet, or publicly with a link that expires.

Usage:
  mostra share <artifact> [flags]

Arguments:
  <artifact>                   The artifact: its source path or its ID.

Flags:
  --tailnet                    Share inside your tailnet through Tailscale Serve; each viewer is their tailnet identity.
  --public                     Share publicly: anyone with the link can open it until it expires.
  --via <tunnel>               The public tunnel: a Cloudflare quick tunnel (no account), or Tailscale Funnel (shows your device's tailnet name). (cloudflare, funnel) Default: cloudflare.
  --ttl <d>                    How long the link works, such as 30m or 24h. Public: 1h by default, 7d at most.
  --scope <a,b>                The link's scopes: view, draft, submit, review, signal, action:*. Default: all.
  --viewer <ref>               The person the link is for, by your own stable key for them; without it, each link is a viewer of its own.
  --viewer-name <name>         The display name of --viewer.
  --request-id <id>            Make a retried share return the same share instead of opening another.

Global flags:
  --json                       Print one JSON envelope on stdout (NDJSON for streams).
  --home <dir>                 Use this Mostra home instead of MOSTRA_HOME or the default.
  --cwd <dir>                  Resolve relative paths from this directory.
  --timeout <d>                Give up on the instance after this long (exit 4), such as 30s or 5m.
  --help                       Show this command's help; with --json, its definition.

Output: ShareStartResult (mostra docs cli)

Exit codes:
  0  success
  1  artifact failure (verify failed, publish refused, the artifact's state refused the request)
  2  usage error
  3  environment error (no runtime, browser or socket; the home; an unsupported platform)
  4  timeout (--timeout passed)

Example:
  mostra share ./sidebar-review --public --ttl 2h
```

## mostra share stop

```text
Stop a share, or every share of an artifact: its link stops working and its tunnel closes.

Usage:
  mostra share stop <target>

Arguments:
  <target>                     A share's ID (shr_…), or an artifact's source path or ID.

Global flags:
  --json                       Print one JSON envelope on stdout (NDJSON for streams).
  --home <dir>                 Use this Mostra home instead of MOSTRA_HOME or the default.
  --cwd <dir>                  Resolve relative paths from this directory.
  --timeout <d>                Give up on the instance after this long (exit 4), such as 30s or 5m.
  --help                       Show this command's help; with --json, its definition.

Output: ShareStopResult (mostra docs cli)

Exit codes:
  0  success
  1  artifact failure (verify failed, publish refused, the artifact's state refused the request)
  2  usage error
  3  environment error (no runtime, browser or socket; the home; an unsupported platform)
  4  timeout (--timeout passed)

Example:
  mostra share stop ./sidebar-review
```

## mostra share list

```text
List the active shares, of every artifact or of one; --all adds the ones that ended.

Usage:
  mostra share list [<artifact>] [flags]

Arguments:
  <artifact>                   Only this artifact's shares: its source path or ID.

Flags:
  --all                        Also list shares that ended, and why.

Global flags:
  --json                       Print one JSON envelope on stdout (NDJSON for streams).
  --home <dir>                 Use this Mostra home instead of MOSTRA_HOME or the default.
  --cwd <dir>                  Resolve relative paths from this directory.
  --timeout <d>                Give up on the instance after this long (exit 4), such as 30s or 5m.
  --help                       Show this command's help; with --json, its definition.

Output: ShareListResult (mostra docs cli)

Exit codes:
  0  success
  1  artifact failure (verify failed, publish refused, the artifact's state refused the request)
  2  usage error
  3  environment error (no runtime, browser or socket; the home; an unsupported platform)
  4  timeout (--timeout passed)

Example:
  mostra share list --all
```

## mostra wait

```text
Block until an artifact's submission, signal, state change or event; still_waiting on timeout.

Usage:
  mostra wait <artifact> [flags]

Arguments:
  <artifact>                   The artifact: its source path or its ID.

Flags:
  --until <condition>          submitted, signal:<name>, state:<fieldId> or event:<type>.
  --after <cursor>             Wait for what comes after this cursor. Default: the latest publish.
  --timeout <d>                Stop waiting after this long, with still_waiting and exit 5. Default: no limit.

Global flags:
  --json                       Print one JSON envelope on stdout (NDJSON for streams).
  --home <dir>                 Use this Mostra home instead of MOSTRA_HOME or the default.
  --cwd <dir>                  Resolve relative paths from this directory.
  --help                       Show this command's help; with --json, its definition.

Output: WaitResult (mostra docs cli)

Exit codes:
  0  success
  1  artifact failure (verify failed, publish refused, the artifact's state refused the request)
  2  usage error
  3  environment error (no runtime, browser or socket; the home; an unsupported platform)
  5  still waiting (the wait timed out; the result says where to resume)

Example:
  mostra wait ./sidebar-review --until submitted --timeout 30m
```

## mostra results

```text
Print an artifact's submission in full: answers, state, choices, comments, actions and signals.

Usage:
  mostra results <artifact> [flags]

Arguments:
  <artifact>                   The artifact: its source path or its ID.

Flags:
  --submission <id>            This submission instead of the latest.
  --format <format>            Markdown or JSON. Default: Markdown, or JSON with --json. (md, json)

Global flags:
  --json                       Print one JSON envelope on stdout (NDJSON for streams).
  --home <dir>                 Use this Mostra home instead of MOSTRA_HOME or the default.
  --cwd <dir>                  Resolve relative paths from this directory.
  --timeout <d>                Give up on the instance after this long (exit 4), such as 30s or 5m.
  --help                       Show this command's help; with --json, its definition.

Output: Results (mostra docs cli)

Exit codes:
  0  success
  1  artifact failure (verify failed, publish refused, the artifact's state refused the request)
  2  usage error
  3  environment error (no runtime, browser or socket; the home; an unsupported platform)
  4  timeout (--timeout passed)

Example:
  mostra results ./sidebar-review
```

## mostra state get

```text
Read an artifact's state: the fields every viewer shares, with their revisions.

Usage:
  mostra state get <artifact> [<id…>]

Arguments:
  <artifact>                   The artifact: its source path or its ID.
  <id>                         Only these field IDs.

Global flags:
  --json                       Print one JSON envelope on stdout (NDJSON for streams).
  --home <dir>                 Use this Mostra home instead of MOSTRA_HOME or the default.
  --cwd <dir>                  Resolve relative paths from this directory.
  --timeout <d>                Give up on the instance after this long (exit 4), such as 30s or 5m.
  --help                       Show this command's help; with --json, its definition.

Output: StateGetResult (mostra docs cli)

Exit codes:
  0  success
  1  artifact failure (verify failed, publish refused, the artifact's state refused the request)
  2  usage error
  3  environment error (no runtime, browser or socket; the home; an unsupported platform)
  4  timeout (--timeout passed)

Example:
  mostra state get ./tasks priorities
```

## mostra state set

```text
Set one field of an artifact's state; viewers see it at once.

Usage:
  mostra state set <artifact> <id> <value> [flags]

Arguments:
  <artifact>                   The artifact: its source path or its ID.
  <id>                         The field ID.
  <value>                      The value, as JSON.

Flags:
  --base <revision>            Write only if the fields are unchanged since this revision; else a conflict (exit 6).
  --as <actor>                 Who the change is attributed to. (agent, host) Default: agent.
  --mutation-id <mut_…>        Make a retry return the first attempt's result.

Global flags:
  --json                       Print one JSON envelope on stdout (NDJSON for streams).
  --home <dir>                 Use this Mostra home instead of MOSTRA_HOME or the default.
  --cwd <dir>                  Resolve relative paths from this directory.
  --timeout <d>                Give up on the instance after this long (exit 4), such as 30s or 5m.
  --help                       Show this command's help; with --json, its definition.

Output: StatePatchResult (mostra docs cli)

Exit codes:
  0  success
  1  artifact failure (verify failed, publish refused, the artifact's state refused the request)
  2  usage error
  3  environment error (no runtime, browser or socket; the home; an unsupported platform)
  4  timeout (--timeout passed)
  6  conflict (already submitted, a compare-and-set mismatch, a reused request ID)

Example:
  mostra state set ./tasks priorities '["Ship the CLI"]'
```

## mostra state patch

```text
Change several fields of an artifact's state in one revision: [{ id, value } | { id, delete: true }].

Usage:
  mostra state patch <artifact> [flags]

Arguments:
  <artifact>                   The artifact: its source path or its ID.

Flags:
  --ops <json>                 The operations, as JSON.
  --file <path>                Read the operations from a JSON file.
  --stdin                      Read the operations from stdin.
  --base <revision>            Write only if the fields are unchanged since this revision; else a conflict (exit 6).
  --as <actor>                 Who the change is attributed to. (agent, host) Default: agent.
  --mutation-id <mut_…>        Make a retry return the first attempt's result.

Global flags:
  --json                       Print one JSON envelope on stdout (NDJSON for streams).
  --home <dir>                 Use this Mostra home instead of MOSTRA_HOME or the default.
  --cwd <dir>                  Resolve relative paths from this directory.
  --timeout <d>                Give up on the instance after this long (exit 4), such as 30s or 5m.
  --help                       Show this command's help; with --json, its definition.

Output: StatePatchResult (mostra docs cli)

Exit codes:
  0  success
  1  artifact failure (verify failed, publish refused, the artifact's state refused the request)
  2  usage error
  3  environment error (no runtime, browser or socket; the home; an unsupported platform)
  4  timeout (--timeout passed)
  6  conflict (already submitted, a compare-and-set mismatch, a reused request ID)

Example:
  mostra state patch ./tasks --file ops.json
```

## mostra push

```text
Push a value into an artifact's live source; pages showing it update at once.

Usage:
  mostra push <artifact> <key> [flags]

Arguments:
  <artifact>                   The artifact: its source path or its ID.
  <key>                        The live source's key: its export name in live.ts, or a new one.

Flags:
  --value <json>               The value, as JSON.
  --file <path>                Read the value from a JSON file.
  --stdin                      Read the value from stdin.
  --append                     Add the value to the source's ring instead of replacing it.
  --request-id <id>            Make a retry return the first attempt's revision.

Global flags:
  --json                       Print one JSON envelope on stdout (NDJSON for streams).
  --home <dir>                 Use this Mostra home instead of MOSTRA_HOME or the default.
  --cwd <dir>                  Resolve relative paths from this directory.
  --timeout <d>                Give up on the instance after this long (exit 4), such as 30s or 5m.
  --help                       Show this command's help; with --json, its definition.

Output: LivePushResult (mostra docs cli)

Exit codes:
  0  success
  1  artifact failure (verify failed, publish refused, the artifact's state refused the request)
  2  usage error
  3  environment error (no runtime, browser or socket; the home; an unsupported platform)
  4  timeout (--timeout passed)

Example:
  mostra push ./dashboard prices --value '{"btc": 64000}'
```

## mostra add

```text
Add npm packages to an artifact's lockfile at exact versions, installing them into the home's store.

Usage:
  mostra add <package…> [flags]

Arguments:
  <package>                    npm specs: name, name@version, name@range or name@tag.

Flags:
  --artifact <path|id>         The artifact. Default: the one in the current directory.
  --request-id <id>            Make a retry return the first attempt's result.

Global flags:
  --json                       Print one JSON envelope on stdout (NDJSON for streams).
  --home <dir>                 Use this Mostra home instead of MOSTRA_HOME or the default.
  --cwd <dir>                  Resolve relative paths from this directory.
  --timeout <d>                Give up on the instance after this long (exit 4), such as 30s or 5m.
  --help                       Show this command's help; with --json, its definition.

Output: DepsAddResult (mostra docs cli)

Exit codes:
  0  success
  1  artifact failure (verify failed, publish refused, the artifact's state refused the request)
  2  usage error
  3  environment error (no runtime, browser or socket; the home; an unsupported platform)
  4  timeout (--timeout passed)

Example:
  mostra add recharts@3 --artifact ./dashboard
```

## mostra secret set

```text
Store a secret that server code reads with secret(name); the value comes from stdin and is never shown.

Usage:
  mostra secret set <name> [flags]

Arguments:
  <name>                       Letters, digits, _, . and -, starting with a letter or _.

Flags:
  --artifact <path|id>         The artifact's own secret, instead of one the whole home shares.

Global flags:
  --json                       Print one JSON envelope on stdout (NDJSON for streams).
  --home <dir>                 Use this Mostra home instead of MOSTRA_HOME or the default.
  --cwd <dir>                  Resolve relative paths from this directory.
  --timeout <d>                Give up on the instance after this long (exit 4), such as 30s or 5m.
  --help                       Show this command's help; with --json, its definition.

Output: SecretEntry (mostra docs cli)

Exit codes:
  0  success
  1  artifact failure (verify failed, publish refused, the artifact's state refused the request)
  2  usage error
  3  environment error (no runtime, browser or socket; the home; an unsupported platform)
  4  timeout (--timeout passed)

Example:
  mostra secret set MAIL_TOKEN --artifact ./inbox < token.txt
```

## mostra secret list

```text
List the secrets' names and scopes; values are never shown.

Usage:
  mostra secret list [flags]

Flags:
  --artifact <path|id>         The artifact's own secret, instead of one the whole home shares.

Global flags:
  --json                       Print one JSON envelope on stdout (NDJSON for streams).
  --home <dir>                 Use this Mostra home instead of MOSTRA_HOME or the default.
  --cwd <dir>                  Resolve relative paths from this directory.
  --timeout <d>                Give up on the instance after this long (exit 4), such as 30s or 5m.
  --help                       Show this command's help; with --json, its definition.

Output: SecretListResult (mostra docs cli)

Exit codes:
  0  success
  1  artifact failure (verify failed, publish refused, the artifact's state refused the request)
  2  usage error
  3  environment error (no runtime, browser or socket; the home; an unsupported platform)
  4  timeout (--timeout passed)

Example:
  mostra secret list --artifact ./inbox
```

## mostra secret rm

```text
Delete a secret.

Usage:
  mostra secret rm <name> [flags]

Arguments:
  <name>                       The secret's name.

Flags:
  --artifact <path|id>         The artifact's own secret, instead of one the whole home shares.

Global flags:
  --json                       Print one JSON envelope on stdout (NDJSON for streams).
  --home <dir>                 Use this Mostra home instead of MOSTRA_HOME or the default.
  --cwd <dir>                  Resolve relative paths from this directory.
  --timeout <d>                Give up on the instance after this long (exit 4), such as 30s or 5m.
  --help                       Show this command's help; with --json, its definition.

Output: SecretDeleteResult (mostra docs cli)

Exit codes:
  0  success
  1  artifact failure (verify failed, publish refused, the artifact's state refused the request)
  2  usage error
  3  environment error (no runtime, browser or socket; the home; an unsupported platform)
  4  timeout (--timeout passed)

Example:
  mostra secret rm MAIL_TOKEN --artifact ./inbox
```

## mostra list

```text
List the home's published artifacts.

Usage:
  mostra list [flags]

Flags:
  --family <family>            Only artifacts of this family.

Global flags:
  --json                       Print one JSON envelope on stdout (NDJSON for streams).
  --home <dir>                 Use this Mostra home instead of MOSTRA_HOME or the default.
  --cwd <dir>                  Resolve relative paths from this directory.
  --timeout <d>                Give up on the instance after this long (exit 4), such as 30s or 5m.
  --help                       Show this command's help; with --json, its definition.

Output: ArtifactListResult (mostra docs cli)

Exit codes:
  0  success
  2  usage error
  3  environment error (no runtime, browser or socket; the home; an unsupported platform)
  4  timeout (--timeout passed)

Example:
  mostra list --family dashboard
```

## mostra status

```text
Show the instance (processes, workers, deliveries) or one artifact (versions, policy, links).

Usage:
  mostra status [<artifact>]

Arguments:
  <artifact>                   An artifact: its source path or its ID.

Global flags:
  --json                       Print one JSON envelope on stdout (NDJSON for streams).
  --home <dir>                 Use this Mostra home instead of MOSTRA_HOME or the default.
  --cwd <dir>                  Resolve relative paths from this directory.
  --timeout <d>                Give up on the instance after this long (exit 4), such as 30s or 5m.
  --help                       Show this command's help; with --json, its definition.

Output: InstanceStatusResult or ArtifactDetail (mostra docs cli)

Exit codes:
  0  success
  1  artifact failure (verify failed, publish refused, the artifact's state refused the request)
  2  usage error
  3  environment error (no runtime, browser or socket; the home; an unsupported platform)
  4  timeout (--timeout passed)

Example:
  mostra status ./sidebar-review
```

## mostra daemon start

```text
Start the home's daemon, or find the one already running.

Usage:
  mostra daemon start

Global flags:
  --json                       Print one JSON envelope on stdout (NDJSON for streams).
  --home <dir>                 Use this Mostra home instead of MOSTRA_HOME or the default.
  --cwd <dir>                  Resolve relative paths from this directory.
  --timeout <d>                Give up on the instance after this long (exit 4), such as 30s or 5m.
  --help                       Show this command's help; with --json, its definition.

Output: DaemonStatus (mostra docs cli)

Exit codes:
  0  success
  2  usage error
  3  environment error (no runtime, browser or socket; the home; an unsupported platform)
  4  timeout (--timeout passed)

Example:
  mostra daemon start
```

## mostra daemon stop

```text
Stop the home's daemon; open pages reconnect when it starts again.

Usage:
  mostra daemon stop

Global flags:
  --json                       Print one JSON envelope on stdout (NDJSON for streams).
  --home <dir>                 Use this Mostra home instead of MOSTRA_HOME or the default.
  --cwd <dir>                  Resolve relative paths from this directory.
  --timeout <d>                Give up on the instance after this long (exit 4), such as 30s or 5m.
  --help                       Show this command's help; with --json, its definition.

Output: DaemonStop (mostra docs cli)

Exit codes:
  0  success
  2  usage error
  3  environment error (no runtime, browser or socket; the home; an unsupported platform)
  4  timeout (--timeout passed)

Example:
  mostra daemon stop
```

## mostra daemon restart

```text
Stop the home's daemon and start it again, for instance after an update.

Usage:
  mostra daemon restart

Global flags:
  --json                       Print one JSON envelope on stdout (NDJSON for streams).
  --home <dir>                 Use this Mostra home instead of MOSTRA_HOME or the default.
  --cwd <dir>                  Resolve relative paths from this directory.
  --timeout <d>                Give up on the instance after this long (exit 4), such as 30s or 5m.
  --help                       Show this command's help; with --json, its definition.

Output: DaemonStatus (mostra docs cli)

Exit codes:
  0  success
  2  usage error
  3  environment error (no runtime, browser or socket; the home; an unsupported platform)
  4  timeout (--timeout passed)

Example:
  mostra daemon restart
```

## mostra daemon status

```text
Whether the home's daemon runs, when it would exit for lack of work, and its login service.

Usage:
  mostra daemon status

Global flags:
  --json                       Print one JSON envelope on stdout (NDJSON for streams).
  --home <dir>                 Use this Mostra home instead of MOSTRA_HOME or the default.
  --cwd <dir>                  Resolve relative paths from this directory.
  --timeout <d>                Give up on the instance after this long (exit 4), such as 30s or 5m.
  --help                       Show this command's help; with --json, its definition.

Output: DaemonStatus (mostra docs cli)

Exit codes:
  0  success
  2  usage error
  3  environment error (no runtime, browser or socket; the home; an unsupported platform)
  4  timeout (--timeout passed)

Example:
  mostra daemon status
```

## mostra daemon install

```text
Run the home's daemon as a login service (launchd, systemd or Task Scheduler), so links answer at any hour.

Usage:
  mostra daemon install [flags]

Flags:
  --no-start                   Write or remove the service's definition without asking launchd, systemd or Task Scheduler to load it.

Global flags:
  --json                       Print one JSON envelope on stdout (NDJSON for streams).
  --home <dir>                 Use this Mostra home instead of MOSTRA_HOME or the default.
  --cwd <dir>                  Resolve relative paths from this directory.
  --timeout <d>                Give up on the instance after this long (exit 4), such as 30s or 5m.
  --help                       Show this command's help; with --json, its definition.

Output: ServiceStatus (mostra docs cli)

Exit codes:
  0  success
  2  usage error
  3  environment error (no runtime, browser or socket; the home; an unsupported platform)
  4  timeout (--timeout passed)

Example:
  mostra daemon install
```

## mostra daemon uninstall

```text
Remove the home's login service; the daemon then exits after 30 idle minutes.

Usage:
  mostra daemon uninstall [flags]

Flags:
  --no-start                   Write or remove the service's definition without asking launchd, systemd or Task Scheduler to load it.

Global flags:
  --json                       Print one JSON envelope on stdout (NDJSON for streams).
  --home <dir>                 Use this Mostra home instead of MOSTRA_HOME or the default.
  --cwd <dir>                  Resolve relative paths from this directory.
  --timeout <d>                Give up on the instance after this long (exit 4), such as 30s or 5m.
  --help                       Show this command's help; with --json, its definition.

Output: ServiceStatus (mostra docs cli)

Exit codes:
  0  success
  2  usage error
  3  environment error (no runtime, browser or socket; the home; an unsupported platform)
  4  timeout (--timeout passed)

Example:
  mostra daemon uninstall
```

## mostra host

```text
Speak the host protocol on stdin and stdout, for a host that spawns Mostra; it sends no telemetry.

Usage:
  mostra host [flags]

Flags:
  --bind <address>             Serve viewers on this address instead of 127.0.0.1.
  --url-host <name>            The host name links use; a wildcard --bind needs it.

Global flags:
  --json                       Print one JSON envelope on stdout (NDJSON for streams).
  --home <dir>                 Use this Mostra home instead of MOSTRA_HOME or the default.
  --cwd <dir>                  Resolve relative paths from this directory.
  --help                       Show this command's help; with --json, its definition.

Output: the host protocol (INTERFACES §6) (mostra docs cli)

Exit codes:
  0  success
  2  usage error
  3  environment error (no runtime, browser or socket; the home; an unsupported platform)

Example:
  mostra host --home ~/.my-host/mostra
```

## mostra docs

```text
Print Mostra's reference: the guide to writing artifacts, the CLI, telemetry, and every diagnostic code's page.

Usage:
  mostra docs [<topic>]

Arguments:
  <topic>                      A topic or a diagnostic code. Default: the index.

Global flags:
  --json                       Print one JSON envelope on stdout (NDJSON for streams).
  --home <dir>                 Use this Mostra home instead of MOSTRA_HOME or the default.
  --cwd <dir>                  Resolve relative paths from this directory.
  --timeout <d>                Give up on the instance after this long (exit 4), such as 30s or 5m.
  --help                       Show this command's help; with --json, its definition.

Output: DocsPage (mostra docs cli)

Exit codes:
  0  success
  2  usage error
  3  environment error (no runtime, browser or socket; the home; an unsupported platform)
  4  timeout (--timeout passed)

Example:
  mostra docs MOSTRA_DEP_MISSING
```

## mostra doctor

```text
Check the platform, the runtime, the home, its daemon and ledger, and the login service.

Usage:
  mostra doctor [flags]

Flags:
  --deep                       Also hash every version against its recorded output digest.

Global flags:
  --json                       Print one JSON envelope on stdout (NDJSON for streams).
  --home <dir>                 Use this Mostra home instead of MOSTRA_HOME or the default.
  --cwd <dir>                  Resolve relative paths from this directory.
  --timeout <d>                Give up on the instance after this long (exit 4), such as 30s or 5m.
  --help                       Show this command's help; with --json, its definition.

Output: DoctorResult (mostra docs cli)

Exit codes:
  0  success
  1  artifact failure (verify failed, publish refused, the artifact's state refused the request)
  2  usage error
  3  environment error (no runtime, browser or socket; the home; an unsupported platform)
  4  timeout (--timeout passed)

Example:
  mostra doctor
```

## mostra gc

```text
Remove what nothing references: unreferenced versions' files, unused packages and caches.

Usage:
  mostra gc [flags]

Flags:
  --dry-run                    List what a run would remove, and remove nothing.
  --compact-events             Also replace events before --before with one summary per artifact.
  --before <cursor>            The cursor --compact-events compacts before.

Global flags:
  --json                       Print one JSON envelope on stdout (NDJSON for streams).
  --home <dir>                 Use this Mostra home instead of MOSTRA_HOME or the default.
  --cwd <dir>                  Resolve relative paths from this directory.
  --timeout <d>                Give up on the instance after this long (exit 4), such as 30s or 5m.
  --help                       Show this command's help; with --json, its definition.

Output: GcRunResult (mostra docs cli)

Exit codes:
  0  success
  1  artifact failure (verify failed, publish refused, the artifact's state refused the request)
  2  usage error
  3  environment error (no runtime, browser or socket; the home; an unsupported platform)
  4  timeout (--timeout passed)

Example:
  mostra gc --dry-run
```

## mostra telemetry status

```text
Whether the CLI sends anonymous usage data, and why.

Usage:
  mostra telemetry status

Global flags:
  --json                       Print one JSON envelope on stdout (NDJSON for streams).
  --home <dir>                 Use this Mostra home instead of MOSTRA_HOME or the default.
  --cwd <dir>                  Resolve relative paths from this directory.
  --timeout <d>                Give up on the instance after this long (exit 4), such as 30s or 5m.
  --help                       Show this command's help; with --json, its definition.

Output: TelemetryStatus (mostra docs telemetry)

Exit codes:
  0  success
  2  usage error
  3  environment error (no runtime, browser or socket; the home; an unsupported platform)
  4  timeout (--timeout passed)

Example:
  mostra telemetry status
```

## mostra telemetry on

```text
Send anonymous usage data from this CLI; the notice says what it contains.

Usage:
  mostra telemetry on

Global flags:
  --json                       Print one JSON envelope on stdout (NDJSON for streams).
  --home <dir>                 Use this Mostra home instead of MOSTRA_HOME or the default.
  --cwd <dir>                  Resolve relative paths from this directory.
  --timeout <d>                Give up on the instance after this long (exit 4), such as 30s or 5m.
  --help                       Show this command's help; with --json, its definition.

Output: TelemetryStatus (mostra docs telemetry)

Exit codes:
  0  success
  2  usage error
  3  environment error (no runtime, browser or socket; the home; an unsupported platform)
  4  timeout (--timeout passed)

Example:
  mostra telemetry on
```

## mostra telemetry off

```text
Stop sending usage data, and delete the install ID and any unsent events.

Usage:
  mostra telemetry off

Global flags:
  --json                       Print one JSON envelope on stdout (NDJSON for streams).
  --home <dir>                 Use this Mostra home instead of MOSTRA_HOME or the default.
  --cwd <dir>                  Resolve relative paths from this directory.
  --timeout <d>                Give up on the instance after this long (exit 4), such as 30s or 5m.
  --help                       Show this command's help; with --json, its definition.

Output: TelemetryStatus (mostra docs telemetry)

Exit codes:
  0  success
  2  usage error
  3  environment error (no runtime, browser or socket; the home; an unsupported platform)
  4  timeout (--timeout passed)

Example:
  mostra telemetry off
```
