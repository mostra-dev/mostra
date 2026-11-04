---
"@mostra/mcp": patch
"@mostra/cli": patch
---

The MCP server's file tools take only names every system can hold, make no folder for a change they refuse, and act on a file only while its folder is still inside the artifact; `MOSTRA_ARTIFACT_ID_DROPPED` also warns when an entry is deleted or renamed in case; a diff's `a/` and `b/` are dropped only in git's form, and a rename never replaces a file. `mostra mcp --http` reads the `Authorization` scheme without regard to case, refuses a `MOSTRA_MCP_TOKEN` with little variety, and prints a generated token only on stderr, with `--json` too. A client that only lists tools is counted in `mcp.session`, over either transport, and calls that meet a daemon restart together share one new session.
