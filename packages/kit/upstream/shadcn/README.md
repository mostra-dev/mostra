# shadcn/ui items the kit is built from

The kit's registry packs (`../../registry/`) are generated from these files by
`../../scripts/generate.ts`. They are shadcn/ui's, under its MIT license (`LICENSE.md`, copied from
the `shadcn` 4.23.0 package), pinned by SHA-256 in `lock.json`.

- `<style>/<item>.json`: each item of the `base-nova` (Base UI) and `radix-nova` (Radix) styles as
  `https://ui.shadcn.com/r/styles/<style>/<item>.json` served it on 2026-11-19: names, types,
  registry dependencies and file types.
- `<style>/installed/`: what the real `shadcn@4.23.0` CLI wrote for every item into a project made
  with `shadcn init -t vite -b <base> -p nova` whose `components.json` has `rsc: true` (the setting
  that keeps `"use client"`, D19) and lucide icons: `add --all --overwrite`, then `add sonner` for
  the Base UI style, whose `--all` leaves it out. Icons, imports and style markers are resolved as
  shadcn resolves them.

To move to a newer shadcn: repeat both steps with the new version, refresh `lock.json`, run
`pnpm --filter @mostra/kit generate`, and fix what `scripts/studio.ts` reports it no longer finds.
