# Telemetry

The standalone `mostra` CLI can send anonymous usage events, so we can see which commands work,
which fail, and which agents people use Mostra with. This page lists every event and every field.
If it isn't on this page, Mostra doesn't send it.

## What Mostra never sends

- Artifact content, source code, answers or submissions
- File paths, project or artifact names, URLs, capability links or tokens
- Names, emails, usernames, hostnames or account identifiers
- Your time zone, locale or anything typed on the command line

The collector doesn't store IP addresses.

## When it is on

- **In the EU, the EEA, the UK, Switzerland and nearby countries, and when the time zone is UTC or
  unknown,** Mostra asks first. Nothing is sent until you answer yes or run `mostra telemetry on`.
  Pressing Enter or not answering means no. Where no one can answer (CI, an agent's shell, `--json`),
  Mostra doesn't ask and sends nothing. Mostra checks the time zone on your machine and never
  sends it.
- **Elsewhere,** telemetry is on by default. Mostra prints a notice once before it sends anything.

## When it is off

- `mostra telemetry off`, `MOSTRA_TELEMETRY=0` or `DO_NOT_TRACK=1`. Any of these wins over every
  setting that turns it on.
- Embedded use never sends anything: the TypeScript SDK, the Rust crate, an instance a host starts
  (`mostra host`) and any home a host has configured.
- A build without a telemetry endpoint sends nothing.

`mostra telemetry status` shows whether telemetry is on, why, your install ID and how many
events are waiting to be sent. `MOSTRA_TELEMETRY_DEBUG=1` prints every event to stderr exactly as
it would be sent, and sends nothing.

## The install ID

On the first run that sends, Mostra creates a random ID and stores it in its config directory
(`${XDG_CONFIG_HOME:-~/.config}/mostra`, or `MOSTRA_CONFIG_DIR`). It is never derived from your
machine or from you, and it is the only value Mostra keeps between events. It lets us count
installs. Turning telemetry off deletes it and any unsent events; turning it on again creates a new
one.

## Fields on every event

| Field | Example | Why |
|---|---|---|
| `schema` | `1` | The version of this list |
| `event` | `cli.command` | Which event |
| `at` | `2026-11-10T14:05:00Z` | When, to the minute |
| `installId` | a random UUID | Count installs without knowing who you are |
| `version` | `1.0.0` | Know which versions fail |
| `os`, `arch` | `darwin`, `linux` or `win32`; `x64` or `arm64` | Platform support |
| `node` | `22` | Which Node versions to support |
| `harness` | `claude-code`, `codex`, `gemini-cli`, `opencode`, `cursor`, `other`, `none` | Which agents to work with next |
| `ci` | `false` | Separate CI from people |
| `consent` | `explicit` or `default` | Whether you said yes or it was on by default |

## Events

| Event | Sent when | Its own fields |
|---|---|---|
| `cli.first_run` | The install ID is created | none |
| `cli.command` | A command finishes | `command` (its name, never its arguments), `exit` (exit code), `duration` (`<1s`, `1-5s`, `5-30s`, `30s-2m`, `2-10m`, `>10m`), `json` (whether `--json` was used), `error` (the diagnostic code, when it failed) |
| `verify.result` | `mostra verify` finishes | `status` (`pass` or `fail`), `codes` (up to 50 diagnostic codes, never their messages), `codesTruncated` |
| `publish.done` | A version is published | `reused`, `forced` |
| `share.done` | A share starts | `kind`: `tailnet`, `funnel`, `cloudflare` or `remote` |
| `mcp.session` | An MCP client connects to `mostra mcp` | `client` (a known agent's ID, or `other`), `clientVersion` (known agents only) |

## How it is sent

Events wait in a small queue in the config directory and are sent in the background after a
command finishes, at most 100 per request. No command waits for the network, and the network
never changes a command's result. Events that can't be sent within 7 days are dropped.

## Retention and your rights

We keep raw events for 12 months, then only aggregated counts. To have your events deleted, send
your install ID (from `mostra telemetry status`) to the privacy contact in our privacy policy.

Changes to this list are announced in the changelog before they ship.
