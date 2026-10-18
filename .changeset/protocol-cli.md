---
"@mostra/protocol": minor
---

Add the methods the CLI needs (D140): `view/default` and `view/launch` (a one-time launch URL for
a browser), `gc/run` with its result shape, `instance/check`, and `dev/start`, `dev/stop` and the
`dev/notify` notification; `VersionSummary.collected`; `GcRunResult.warnings` for a step gc
couldn't finish; the `CLI` diagnostic area with `MOSTRA_CLI_USAGE`, `MOSTRA_CLI_UNKNOWN_COMMAND` and
`MOSTRA_CLI_CONFIG_UNWRITABLE`; and `MOSTRA_ARTIFACT_VERSION_COLLECTED`,
`MOSTRA_ENV_RUNTIME_MISSING`, `MOSTRA_HOME_NOT_ALWAYS_ON` and `MOSTRA_HOME_GC_INCOMPLETE`.
