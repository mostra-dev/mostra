# @mostra/kit

Audience: artifact authors. Runs in: browser. May import: @mostra/protocol, @mostra/react, @mostra/themes (tools/package-map.ts).

## Purpose

Mostra's kit (D26, D27, D181): the parts an agent's page is built from when it wants to look good
without designing a system of its own. Three things, all read from the warm set:

- **The registry** (`registry/base/`, `registry/radix/`): shadcn 4.23.0's components for each base,
  as shadcn's own CLI writes them (`upstream/shadcn/`, pinned with its lock), restyled onto the
  themes' token contract by `scripts/studio.ts` (class rules and whole-string changes, the same for
  both bases) and `parts/<base>/` (the moving tab indicator). `@/components/ui/<name>` resolves here
  when the artifact has no copy (the runtime's `builder/child/kit.ts`); `mostra add <name>` copies
  an item (the runtime's `packs`).
- **Mostra's own modules**, the same in both bases, each also a registry item (`mostra-<module>`):
  `@mostra/kit/questionnaire` (KT-05), `/layout`, `/review` (WP-20); the library parts of WP-19
  (KT-01): `/charts` (Recharts), `/live-chart` (uPlot, AC-08), `/echarts`, `/data-table` (TanStack
  Table 9), `/mermaid`, `/flow` (React Flow 13), `/code` (Shiki, CodeMirror 6), `/math` (KaTeX),
  `/map` (MapLibre with deck.gl), `/scene` (react-three-fiber with drei), `/whiteboard` (Excalidraw);
  `/team` (KT-11, on WP-31's hooks); and `/tokens`, the theme as values a canvas or WebGL library
  takes. `KIT_MODULES` lists them; `KIT_ON_DEMAND_MODULES` the three whose libraries install on
  demand (D65).
- **`css/kit.css`**: the animations and variants the parts use, the dark variant, the press and the
  answer drop. Colours, faces, shapes and depths come from the theme stack (`@mostra/themes`).

## Invariants it owns

- **The on-demand libraries are optional peers, each at an exact version** (`peerDependencies` with
  `peerDependenciesMeta.optional`, plus `mostra-kit.pins` for packages a page adds beside them and
  `mostra-kit.overrides` for their dependencies' fixed releases). The runtime installs them on
  demand for an artifact that uses `/map`, `/scene` or `/whiteboard`, at these versions, with these
  overrides (`deps`, `kitPeers`, `kitOverrides`), resolves the kit file's imports of them from the
  artifact's packages (`kitPeersPlugin`) and serves the assets `mostra-kit.assets` names
  (Excalidraw's fonts) from the page's origin (`kitAssetsPlugin`). They are never the kit's
  dependencies: the runtime bundle carries none of them.
- **Every library part reads the tokens** through `useTokens()` (`/tokens`), which resolves each
  colour (OKLCH included) for canvases and WebGL and follows the theme's light or dark, so a layer
  that changes only tokens restyles every part (`kit-libraries.spec.ts`).
- **Both bases are the same kit.** Every change to shadcn's parts applies to both bases from one
  table; `scripts/generate.ts` fails when a change no longer finds its place, and
  `test/registry.test.ts` type-checks every part of both bases under verify's strict settings.
- **The registry is generated, never edited.** `node scripts/generate.ts` writes `registry/` and
  `css/shadcn.css` from `upstream/`, `parts/`, `src/` and `scripts/studio.ts`; `--check` (a test)
  fails on a stale file.
- **Every part reads the tokens and takes `className`** (KT-10): a new part uses the theme's
  utilities (`rounded-card`, `shadow-card`, `bg-(--field)`, …), never a fixed colour or radius.
- **A kit module's fields are scannable** (D109): `Questionnaire`'s and `Question`'s `id`s are
  literals the runtime's field scan reads (`builder/child/fields.ts`); a module that adds field IDs
  teaches the scan in the same change.

## Public interface

`src/index.ts` (`KIT_MODULES`, `KIT_ON_DEMAND_MODULES`, `KIT_BASES`) and each module's source in
`src/`; the API report is `etc/kit.api.md`. Files: `registry/`, `css/kit.css`. Each module has a
size budget (`size-limit` in `package.json`).

## Tests to run

`pnpm --filter @mostra/kit test` (the registry type-check needs `@mostra/react` and
`@mostra/protocol` built first), then `pnpm check --affected`. Rendering is the runtime's verify
suite (`renders every kit part in the … base and the … theme`), `tests/e2e/specs/kit.spec.ts`,
`kit-libraries.spec.ts` (every library part in three engines, its restyle and the team parts) and
`live-chart.spec.ts` (AC-08's rate); the on-demand installs are the runtime's
`kit-libraries.test.ts` (groups `kit`, `windows-kit`), through a mirror of the workspace's copies.

## Gotchas

- **A new on-demand library** goes in `peerDependencies` (optional, exact), `devDependencies` and the
  catalog; the runtime's mirror serves whatever the kit has installed, so its suites need no
  network. A part that imports one also says what it shows without WebGL or before it loads.
- **The live chart draws at most a few points per pixel column** (`Columns.drawn`): its window keeps
  every point, and what it draws keeps each column's extremes.
- **Refreshing shadcn** is `upstream/shadcn/README.md`'s steps: run shadcn's own CLI for both
  bases with `rsc: true`, copy its output, update `lock.json`, then fix any change that lost its
  place.
- **A class change matches whole strings or class lists of two or more names.** A one-class string
  (`cn("px-(--card-spacing)", className)`) needs an exact pair in `CLASS_CHANGES`.
- **`scripts/studio.ts`'s `FILE_CHANGES` throw when their anchor moved**, so an upstream change
  can't silently drop one.
