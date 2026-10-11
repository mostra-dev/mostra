---
"@mostra/runtime": minor
---

Publish artifacts: `artifact/create`, `artifact/publish`, `artifact/list` and `artifact/get`. A
builder child (Vite 8, React 19.3, MDX 3, Tailwind 4) turns a single `.tsx`, `.jsx` or `.mdx` file,
or a directory with pages, components, `"use server"` modules, live sources, data and assets, into
an immutable, content-addressed version, with no `package.json`; the source is snapshotted into the
home, publishing is atomic, and the supervisor never loads artifact code. Every child process now
starts behind a gate that opens once it is recorded, so a supervisor crash never leaves an
unrecorded child running.
