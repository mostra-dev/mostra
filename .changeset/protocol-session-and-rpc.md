---
"@mostra/protocol": minor
---

Add the JSON-RPC 2.0 core every Mostra connection uses (`RpcPeer`, `RpcError`, `encodeLine`,
`LineSplitter` and the message schemas; no batches in revision `2026-10-10`), the session methods
`mostra/initialize`, `mostra/shutdown` and `instance/status` with their shapes (D84), and the HOME,
HOST and PLATFORM diagnostic codes the instance reports. The build now keeps one module per source
file, so bundlers drop what a consumer doesn't import.
