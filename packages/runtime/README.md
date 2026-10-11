# @mostra/runtime

The Mostra runtime: the supervisor that owns a Mostra home. It keeps the home's ledger, serves the
host protocol, and starts and supervises every child process. Most people never install it
directly: the Mostra CLI, the SDK and the Rust host crate run it from the runtime bundle.

## Running it

```sh
mostra-runtime daemon --home ~/.mostra   # the home's daemon; clients attach over its socket
mostra-runtime host --home /path/to/home # the host protocol over stdin and stdout
```

The home is `--home`, else `MOSTRA_HOME`, else `~/.mostra` on macOS and
`${XDG_DATA_HOME:-~/.local/share}/mostra` on Linux. One instance owns a home at a time: a second
`daemon` for the same home attaches to the first and exits, printing
`{"status":"attached","pid":…}`, and a second `host` fails with `MOSTRA_HOME_LOCKED`.

`daemon` prints one JSON status line on stdout and logs to `<home>/logs/supervisor.log`. It stops
on SIGTERM, SIGINT or the `mostra/shutdown` protocol method. `host` lives as long as its stdin.

The control socket lives in `MOSTRA_RUNTIME_DIR` when set, else `~/.mostra/run` on macOS and
`$XDG_RUNTIME_DIR/mostra` (or `~/.local/state/mostra/run`) on Linux.

## Platforms

macOS and Linux, on x64 and arm64. Elsewhere, including Windows, it stops with
`MOSTRA_PLATFORM_UNSUPPORTED` before touching the home.

Part of [Mostra](https://github.com/mostra-dev/mostra), the agent artifact runtime. Apache-2.0.
