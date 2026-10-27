---
"@mostra/sdk": patch
---

A first install unpacks the runtime bundle 4 to 10 times faster: about 45 s instead of 6 minutes on Windows arm64, 14 s instead of 85 on Windows x64, 5 s instead of 52 on Linux. The archive's files are written straight into the new directory as they are read, with the same refusals as before (only files, directories and links, nothing outside the bundle's directory, no path twice, links made last so nothing is written through one), and every file is still checked against the bundle's file list.
