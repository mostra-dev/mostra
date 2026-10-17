# @mostra/worker

The process that runs one Mostra artifact version's server code: its `"use server"` functions,
action runs and live producers. Mostra's supervisor starts it through a launcher and talks to it
over the worker channel of `@mostra/protocol`; it isn't something an artifact or a host imports.
`workerEntry()` gives a launcher the path of its process entry.

Part of [Mostra](https://github.com/mostra-dev/mostra), the agent artifact runtime. Apache-2.0.
