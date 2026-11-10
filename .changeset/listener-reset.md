---
"@mostra/runtime": patch
---

A stopping gateway listener, and the remote server, reset their open connections instead of closing them (#132): a connection the server closed first stayed in TIME_WAIT on its port, where a browser's next connect from the same random port failed on Windows with `ERR_NO_BUFFER_SPACE`, the more so as a restarted instance listens on the same leased ports.
