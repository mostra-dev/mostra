---
"@mostra/runtime": patch
---

The gateway reads and drops what a client is still sending after refusing its request (for at most 5 s and 16 MiB) instead of closing the connection at once. On Windows the early close reset the connection, and a browser whose cookies had grown past the limit never received the page that clears them.
