# shadcn/ui registry items, unchanged

These files are shadcn/ui's own registry items, as `https://ui.shadcn.com/r/styles/new-york-v4/<name>.json` served them on 2026-11-14 (last modified 2026-11-13), copied byte for byte so the packs suite (`../../integration/packs.test.ts`) proves that a third-party item installs unchanged (EX-03) without reaching the network. They are shadcn/ui's, under its MIT license (`LICENSE.md`, copied from the `shadcn` 4.23.0 package).

To refresh them: fetch each again from the URL above into `styles/new-york-v4/`, and run the suite.

`expected/login-01/` is what the real `shadcn add` (4.23.0) wrote for `login-01` into a project whose `components.json` has the default aliases and `rsc: true` (the setting that keeps `"use client"`, which Mostra's client modules carry, D19), on 2026-11-14; the suite checks that `mostra add` writes the same bytes.
