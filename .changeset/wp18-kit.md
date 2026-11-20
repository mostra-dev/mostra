---
"@mostra/kit": minor
"@mostra/themes": minor
"@mostra/runtime": minor
---

The kit (WP-18, D179). `@mostra/kit` is new: shadcn 4.23.0's components for both bases (Base UI, the default, and Radix with `kit: { base: "radix" }`), restyled onto the themes' tokens, which `@/components/ui/<name>` imports with nothing installed and `mostra add <name>` copies for editing; `@mostra/kit/layout` (`Page`, `Section`, `Figures`, `Figure`); and `@mostra/kit/questionnaire`, whose every answer is a field. Every page wears a theme stack (`kit: { theme: "studio" | "arcata" | [...] }`): `@mostra/themes` ships Studio, now an editorial look, and Arcata, the brand's flat, round other half, both in light and dark, plus `frame`, UX-01's look, which the shell and a server's pages keep. A stack takes plugins' themes, the artifact's own CSS layers and `"host"`, and a theme is data with a JSON schema (`theme.schema.json`).
