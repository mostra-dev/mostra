---
"@mostra/react": minor
---

Add the artifact end of the shell bridge (SH-04): `connectShell` and `reportReady`. Every
version's generated entry starts it, so a page inside Mostra's shell introduces itself with MCP
Apps' `ui/initialize` and reports `mostra/ready`, accepting messages only from its shell's exact
origin.
