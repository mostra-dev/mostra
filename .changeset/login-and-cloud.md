---
"@mostra/protocol": minor
"@mostra/runtime": minor
"@mostra/cli": minor
---

`mostra login [<server>] [--default]` signs this machine in to a remote server by the device grant, `mostra logout [<server>] [--forget]` signs it out (keeping its instance link unless `--forget`), and `mostra share <artifact> --cloud [<server>]` hosts the artifact there. `mostra status` lists the linked servers (`instance/status` gains `links`), and `remote/login` takes `default` to make this instance the account's default.
