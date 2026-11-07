---
"@mostra/conformance": minor
---

Two remote scenarios, `remote.delivery` and `remote.relay`: the kit runs a remote server, signs the host's instance in through the host's own client, shares to it and answers the hosted page, checking that the answer reaches the host once through its instance's outbox and that a hosted page's actions run on the host's instance with its own secrets. The kit's viewer opens hosted links, keeping the shell's session in a header as the hosted shell does.
