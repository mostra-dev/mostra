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

## Publishing

`artifact/publish` turns an artifact's source (a `.tsx`, `.jsx` or `.mdx` file, or a directory with
an `index` entry) into an immutable version in `<home>/versions/<versionId>/`. Nothing in the
artifact's directory is written, and no `package.json` is needed: builds resolve React, React
Router, Tailwind CSS and `@mostra/react` from the warm set the runtime ships beside it (or
`MOSTRA_WARM_DIR`). A copy of every published source stays in `<home>/sources/`, so versions stay
readable after the source directory is gone. Publishing the same source again returns the same
version. `artifact/create`, `artifact/list` and `artifact/get` complete the authoring methods.

## Platforms

macOS, Linux and Windows, on x64 and arm64. Elsewhere it stops with `MOSTRA_PLATFORM_UNSUPPORTED`
before touching the home. On Windows the control endpoint is an owner-only named pipe that the
helper `mostra-win.exe` serves, and every child runs in a Job Object (D150).

Part of [Mostra](https://github.com/mostra-dev/mostra), the agent artifact runtime. Apache-2.0.
