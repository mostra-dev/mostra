---
"@mostra/mcp": minor
"@mostra/protocol": minor
---

Mostra's MCP server, `@mostra/mcp`: thirteen tools (`artifact_create`, `artifact_write`, `artifact_patch`, `artifact_verify`, `artifact_publish`, `artifact_open`, `artifact_wait`, `artifact_results`, `artifact_list`, `live_push`, `state_get`, `state_patch`, `docs_search`), the reference and artifact reports as resources, and instructions for the loop, independent of the transport. `@mostra/protocol`'s request checks gain the `rpc` intent (a program's JSON-RPC POST with a bearer token) and the diagnostics `MOSTRA_ARTIFACT_PATH_INVALID` and `MOSTRA_ARTIFACT_PATCH_REJECTED`.
