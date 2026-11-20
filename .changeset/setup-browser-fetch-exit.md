---
"@mostra/sdk": patch
---

A bundle's setup finishes when the browser's installer exits, not when its output closes (#124). A process the installer started that outlived it holding its output (Playwright fetches in a child process of its own) held setup, and with it `mostra-setup`, `create-mostra` and a first `mostra` command, for as long as that process lived, past the fetch's 15-minute limit. The output now gets two seconds to close after the installer exits. Past the limit the installer is asked to end and killed 10 seconds later if it hasn't, and the failure says the fetch didn't finish within 15 minutes.
