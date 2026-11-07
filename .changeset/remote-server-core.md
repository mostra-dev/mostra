---
"@mostra/protocol": minor
"@mostra/runtime": minor
"@mostra/cli": minor
---

`mostra-runtime server --data <dir> [--config <file>] [--listen <host:port>]` starts the remote server's core: it holds its data directory with a lock the operating system releases when the process ends, so a second server refuses it and a crashed one never leaves it locked; it refuses a data directory on a network filesystem (`MOSTRA_HOME_NETWORK_FILESYSTEM`) and a configuration it can't use, naming the key (`MOSTRA_REMOTE_CONFIG_INVALID`); and it routes requests by their exact `Host`. New diagnostic area: `REMOTE`.
