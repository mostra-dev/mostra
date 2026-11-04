# Mostra's MCP server: the same loop through tools

## Contents

- When to use the tools
- The loop, tool by tool
- Files and directories
- Waiting and results
- Links for people
- Long-lived pages
- Adding the server to a client

## When to use the tools

Use Mostra's tools when they're in your tool list (`artifact_create`, `artifact_verify` and the rest): a client starts the server for you, so nothing needs installing, and you need no shell. Each step of the loop in [SKILL.md](../SKILL.md) has its tool, and everything the Skill says about pages, fields, design and verify holds unchanged. Read any part of this guide with `docs_search` and a `topic` (`guide`, `guide/answers`, a diagnostic code), or a `query` of a few words.

## The loop, tool by tool

| Step | Command | Tool |
|---|---|---|
| Create | `mostra new <dir>` | `artifact_create` with a `title` (and a `dir`, or one is made for you) |
| Write | your own file tools | `artifact_write` (whole files), `artifact_patch` (exact replacements or a unified diff) |
| Verify | `mostra verify <dir>` | `artifact_verify`; `screenshots: "always"` returns both screenshots as images |
| Publish | `mostra publish <dir>` | `artifact_publish`; its `url` is the default link |
| Hand out the link | `mostra open <dir>` | `artifact_open` |
| Wait | `mostra wait <dir> --until submitted` | `artifact_wait` with `until: "submitted"` |
| Read the answers | `mostra results <dir>` | `artifact_results` (Markdown; `format: "json"` for the full structure) |

A tool that fails returns `isError` with `{ "error": <diagnostic> }`: its `code`, `hint` and `docs` mean what the same code means anywhere in this guide. Fix what the hint says and call again.

The first time the server runs on a computer, it installs Mostra's runtime in the background (a few minutes on a slow connection). A tool called meanwhile answers `MOSTRA_ENV_RUNTIME_INSTALLING` with how far it is: write the page in the meantime (`artifact_write` and `docs_search` already work), then call the tool again.

## Files and directories

`artifact_create` returns the artifact's `dir` and its `artifactId`; pass either to the other tools. A relative `dir` is inside the server's workspace folder, which its instructions name. Paths in `artifact_write` and `artifact_patch` are relative to the artifact's directory (`index.tsx`, `components/chart.tsx`), and a tool only ever changes files inside it. Names are ones every system can hold, so the artifact moves between macOS, Linux and Windows whole: no `<>:"|?*`, no device name such as `CON` or `NUL`, no dot or space at the end, and two names that differ only in case are one file.

When you also have your own file tools on the same computer, use whichever you like for the files: verify and publish read the directory as it is.

`artifact_write` and `artifact_patch` apply all or nothing. When an `old` text appears twice, or a diff's lines don't match the file, nothing is written and `rejected` names each edit or hunk and why; read the file again and send a patch that fits.

## Waiting and results

`artifact_wait` waits at most 50 seconds per call. When it returns `still_waiting`, nothing is lost: call it again with `after` set to the `cursor` it returned, or do other work and check later. Under `once`, a wait for `submitted` returns at once when the person already submitted. `artifact_results` returns the latest submission; `MOSTRA_SUBMIT_NOT_FOUND` means nobody has submitted yet. A page with the `none` policy never has one: read its shared state with `state_get`, and wait for its signals with `until: "signal:<name>"`, whose event carries the payload the page sent (`event.payload.payload`).

## Links for people

`artifact_open` returns the artifact's default link. A link made without `viewer` is shared by everyone who holds it: they edit one draft and have one `once` submission between them. For several people, call `artifact_open` once per person with `viewer: { ref, name }` and give each their own link (with `{ policy: "once", scope: "per-viewer" }` each submits once). `ttl`, `scopes` and `version` make a new link that expires, allows less, or opens one version, as in [sharing.md](sharing.md). `open: true` also opens the link in a browser on this computer, for the person sitting at it.

Links open on this computer only. To reach someone elsewhere, share it as [sharing.md](sharing.md) shows (`mostra share`).

## Long-lived pages

`state_get` and `state_patch` read and change the artifact's shared state (fields with `scope: "artifact"`), as `mostra state` does; `live_push` pushes a value to a live source, as `mostra push` does. See [long-lived.md](long-lived.md).

## Adding the server to a client

A client starts the server as `mostra mcp` over stdio, or `npx -y @mostra/cli@0.9.0 mcp` where `mostra` isn't installed. Its configuration names that command, for example:

```json
{ "mcpServers": { "mostra": { "command": "npx", "args": ["-y", "@mostra/cli@0.9.0", "mcp"] } } }
```

For a client that speaks only HTTP, `mostra mcp --http` serves Streamable HTTP on `127.0.0.1` and prints its URL and a token on stderr; every request sends `Authorization: Bearer <token>` (set `MOSTRA_MCP_TOKEN` to choose it). `--workspace <dir>` chooses where new artifacts go.
