---
"@mostra/runtime": patch
---

`mostra add` of an item of shadcn's `base-nova` or `radix-nova` style, by URL or through a `components.json` that names the style, now writes it as shadcn's own CLI does: its icon placeholders become the icons of the library `components.json` names (lucide by default), and its style markers become their classes (#219).
