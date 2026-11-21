---
code: MOSTRA_KIT_WRONG_BASE
severity: error
phase: compile
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_KIT_WRONG_BASE

Idiom of the other base. Severity: error. Phase: compile.

## What it means

The artifact uses the kit with one shadcn base (`kit.base`, Base UI by default) and composes a part in the other base's way: Radix's `asChild` on a Base UI part, or Base UI's `render` prop on a Radix part. TypeScript refuses it (TS2322), and the page would build but not compose as written.

## How to fix it

On Base UI, pass the child as `render`: `<DialogTrigger render={<Button />}>Open</DialogTrigger>`. On Radix, wrap it with `asChild`: `<DialogTrigger asChild><Button>Open</Button></DialogTrigger>`. Or set `kit: { base: "radix" }` if the page was written for Radix.

## Hint

Write the idiom of the artifact's base, as the fix shows.
