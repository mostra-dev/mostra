---
"@mostra/runtime": patch
"@mostra/cli": patch
"@mostra/mcp": patch
"@mostra/protocol": patch
---

On a page whose submission policy is `none`, `results` says it takes no submissions and points at its shared state and signals, and the MCP server's artifact report shows that state; `mostra wait --until signal:<name>` prints the signal's name and payload (#115).
