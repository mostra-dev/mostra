# Mostra

**Mostra is the agent artifact runtime.** Agents write ordinary React. Mostra turns it into
stateful, interactive web artifacts: questionnaires, design reviews, dashboards, decks, terminal
and web demos, pages with buttons that do real things. People view them, answer, comment and
choose, and the answers flow back to the agent through whatever host it runs in.

- **Ordinary React.** No custom language and no closed component list. A single `page.tsx` is a
  complete artifact.
- **Answers that survive.** Drafts save on the server as people work; submissions are immutable
  and durable before any delivery, so a closed tab or a host outage loses nothing.
- **Real actions.** Buttons run agent-written server functions with full capability, as durable,
  idempotent runs.
- **Verification for agents that can't see.** `mostra verify` builds, renders and smoke-tests an
  artifact headlessly and returns one JSON verdict with stable diagnostic codes.
- **Any host.** A CLI, a local MCP server, a TypeScript SDK and a Rust crate all speak one
  versioned protocol. The same artifact runs locally, on a self-hostable remote server, inline in
  chat hosts as an MCP App, or as a static page.

## Status

The v1 design is accepted, and implementation is under way, one work package at a time. Nothing
is published to npm yet. Mostra runs on macOS, glibc-based Linux and Windows, each on x64 and arm64.

| Package | What it is | Status |
|---|---|---|
| [`@mostra/protocol`](packages/protocol) | IDs, protocol revisions, diagnostics, JSON Schema | in development |

## Repository

```text
docs/design/     the design: decisions, architecture, interfaces, data model, work packages
docs/progress/   evidence for each finished work package
docs/agents/     playbooks for recurring tasks
docs/reference/  generated references (the diagnostic catalog)
packages/        npm packages
crates/          Rust crates
tools/           the check runner, generators, license audit and CI helpers
tests/           cross-package end-to-end suites
```

Start with [docs/design/README.md](docs/design/README.md). The research behind the design is in
[docs/research/](docs/research/INDEX.md).

## Developing

Node.js 24 and pnpm (pinned by `packageManager`) on macOS or Linux; Rust for the crates.

```sh
pnpm install
pnpm check            # every CI gate, locally
pnpm check --affected # just what your change affects
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for commits (Conventional Commits with a DCO sign-off),
changesets and pull requests. Agents working on the repository read [AGENTS.md](AGENTS.md).

## Community

- [Code of Conduct](CODE_OF_CONDUCT.md)
- [Governance](GOVERNANCE.md)
- [Security policy](SECURITY.md): report vulnerabilities privately.

## License

Apache-2.0 ([LICENSE](LICENSE), [NOTICE](NOTICE)). Contributions are made under the
[Developer Certificate of Origin](https://developercertificate.org/): sign off each commit with
`git commit -s`.
