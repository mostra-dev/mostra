---
"@mostra/runtime": patch
---

The gateway reads and drops what a client is still sending after refusing its request (for at most 5 s and 16 MiB) instead of letting the connection close at once. A client that read its answer only after sending everything (a browser sending a megabyte of cookies, on Windows above all) got a reset instead of the page that clears its cookies.
