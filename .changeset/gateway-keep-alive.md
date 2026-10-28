---
"@mostra/runtime": patch
---

The gateway keeps an idle connection open for 305 s instead of Node's 5 s, longer than Chromium (300 s) and Firefox (115 s) keep theirs, so browsers reuse their connections and close them themselves. On Windows 11, Chromium's random local ports collided with the connections the gateway had closed, and a frame occasionally failed to load with `ERR_NO_BUFFER_SPACE` (#66, D157).
