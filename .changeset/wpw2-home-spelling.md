---
"@mostra/runtime": patch
---

An instance recognises its home however a client spells it: on Windows a short (8.3) name such as `C:\Users\RUNNER~1\…` or another case no longer refuses the session with `MOSTRA_HOME_MISMATCH`, and `mostra-runtime service` names the login service by the home as the daemon spells it.
