---
"@mostra/sdk": patch
"@mostra/conformance": patch
---

Windows bundles copied by a tool that follows junctions (Explorer, `Copy-Item`, a move to another drive) are set up again instead of refused, and two setups of one bundle at once no longer fail. The conformance kit ends a host shim's whole process tree on Windows even after its shell exits, and judges Windows access lists exactly: an account alias counts as the user only by its SID, and every deny type and `CREATOR OWNER` are read as Windows applies them.
