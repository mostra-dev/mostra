# @mostra/cli

The `mostra` command: create, verify, publish and share agent artifacts, wait for people's answers
and read them, from a terminal or an agent's shell.

```sh
mostra new ./sidebar-review --title "Sidebar review"
mostra verify ./sidebar-review
mostra publish ./sidebar-review
mostra wait ./sidebar-review --until submitted --timeout 30m
mostra results ./sidebar-review
```

Every command takes `--json`. `mostra --help` lists the commands, `mostra <command> --help`
describes one, and `mostra docs` prints the reference, including every diagnostic code's page.
The standalone CLI can send anonymous usage data; `mostra docs telemetry` says what and when, and
`mostra telemetry off` turns it off.

Apache-2.0.
