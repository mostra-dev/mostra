---
"@mostra/runtime": patch
---

On Windows, `verify` and `mostra dev` meet Chromium's `net::ERR_NO_BUFFER_SPACE` about five times less often (#95). Their sandboxes' two listeners used to take ports the system assigns, from the same dynamic range Chromium picks each connection's local port from at random, so a listener could land on a port whose earlier connection was still in TIME_WAIT and a page's request failed at once. They now listen on a free port between Mostra's lease range and the dynamic ranges (32768 to 49151), and fall back to one the system assigns, with a warning, only when none is free.
