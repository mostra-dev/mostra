---
"@mostra/shell": patch
"@mostra/verify": patch
---

The shell loads the artifact's frame again when its load failed: a frame that loaded without greeting the shell within 6 s, or that greeted nothing within 12 s, is entered again with a new ticket, up to three times with a growing pause, after which the shell says the page didn't load. Before, such a frame stayed on "Connecting…" until the viewer reloaded. On Windows 11, Chromium's random local ports occasionally fail a connection with `ERR_NO_BUFFER_SPACE` (#66, D157). `verify` drives the same shell, and counts failed requests of the frame the page ends in only, never of a frame the shell replaced.
