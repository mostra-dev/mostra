---
"@mostra/sdk": patch
---

A first install of the runtime bundle is 3 to 5 times faster: about 1.5 minutes instead of 7 on Windows arm64, 45 s instead of 3 minutes on Windows x64, 20 s instead of 70 on Linux. The archive's files are written straight into the new directory as they are read, with the same refusals as before (only files, directories and links, nothing outside the bundle's directory, no path twice, links made last so nothing is written through one), and every file is still checked against the bundle's file list.
