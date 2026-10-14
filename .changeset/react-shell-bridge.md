---
"@mostra/react": minor
---

Add the artifact end of the shell bridge (SH-04): `connectShell`, `reportReady` and `openLink`,
which sends the viewer to a URL in a new tab through the shell. Every
version's generated entry starts it, so a page inside Mostra's shell introduces itself with MCP
Apps' `ui/initialize` and reports `mostra/ready`, accepting messages only from its shell's exact
origin.
