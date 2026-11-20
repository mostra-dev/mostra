# @mostra/kit

Audience: artifact authors. Runs in: browser. May import: @mostra/protocol, @mostra/react, @mostra/themes (tools/package-map.ts).

## Purpose

Mostra's kit (D26, D27, D179): the parts an agent's page is built from when it wants to look good
without designing a system of its own. Three things, all read from the warm set:

- **The registry** (`registry/base/`, `registry/radix/`): shadcn 4.23.0's components for each base,
  as shadcn's own CLI writes them (`upstream/shadcn/`, pinned with its lock), restyled onto the
  themes' token contract by `scripts/studio.ts` (class rules and whole-string changes, the same for
  both bases) and `parts/<base>/` (the moving tab indicator). `@/components/ui/<name>` resolves here
  when the artifact has no copy (the runtime's `builder/child/kit.ts`); `mostra add <name>` copies
  an item (the runtime's `packs`).
- **Mostra's own modules**, the same in both bases: `@mostra/kit/questionnaire` (KT-05) and
  `@mostra/kit/layout`, each also a registry item (`mostra-questionnaire`, `mostra-layout`).
- **`css/kit.css`**: the animations and variants the parts use, the dark variant, the press and the
  answer drop. Colours, faces, shapes and depths come from the theme stack (`@mostra/themes`).

## Invariants it owns

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

`src/index.ts` (`KIT_MODULES`, `KIT_BASES`), `src/questionnaire.tsx`, `src/layout.tsx`; the API
report is `etc/kit.api.md`. Files: `registry/`, `css/kit.css`.

## Tests to run

`pnpm --filter @mostra/kit test` (the registry type-check needs `@mostra/react` and
`@mostra/protocol` built first), then `pnpm check --affected`. Rendering is the runtime's verify
suite (`renders every kit part in the … base and the … theme`) and `tests/e2e/specs/kit.spec.ts`.

## Gotchas

- **Refreshing shadcn** is `upstream/shadcn/README.md`'s steps: run shadcn's own CLI for both
  bases with `rsc: true`, copy its output, update `lock.json`, then fix any change that lost its
  place.
- **A class change matches whole strings or class lists of two or more names.** A one-class string
  (`cn("px-(--card-spacing)", className)`) needs an exact pair in `CLASS_CHANGES`.
- **`scripts/studio.ts`'s `FILE_CHANGES` throw when their anchor moved**, so an upstream change
  can't silently drop one.
