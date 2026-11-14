---
code: MOSTRA_PACK_ADDRESS_INVALID
severity: error
phase: host
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_PACK_ADDRESS_INVALID

Item address not understood. Severity: error. Phase: host.

## What it means

`mostra add` reads an item address in shadcn's forms: an `https:` URL of an item's JSON, a path to a local `.json` item, a GitHub item (`owner/repo/item[#ref]`), or `@namespace/item` resolved through the `registries` of the artifact's `components.json`. A bare name in an item's `registryDependencies` means shadcn's own registry. This address is none of those, or names a namespace the artifact doesn't register, or a plain `http:` URL to another machine.

## How to fix it

Correct the address, or add the namespace to `registries` in the artifact's `components.json` (`"@acme": "https://registry.acme.com/r/{name}.json"`).

## Hint

Use an item URL, a local .json item, owner/repo/item for GitHub, or an @namespace/item your components.json registers.
