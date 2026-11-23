# @mostra/kit

## 0.19.1

### Patch Changes

- Updated dependencies []:
  - @mostra/react@0.19.1

## 0.19.0

### Minor Changes

- [#215](https://github.com/mostra-dev/mostra/pull/215) [`837f993`](https://github.com/mostra-dev/mostra/commit/837f99365ce1c2de2c05095841a68d4942116982) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - The kit (WP-18, D181). `@mostra/kit` is new: shadcn 4.23.0's components for both bases (Base UI, the default, and Radix with `kit: { base: "radix" }`), restyled onto the themes' tokens, which `@/components/ui/<name>` imports with nothing installed and `mostra add <name>` copies for editing; `@mostra/kit/layout` (`Page`, `Section`, `Figures`, `Figure`); and `@mostra/kit/questionnaire`, whose every answer is a field. Every page wears a theme stack (`kit: { theme: "studio" | "arcata" | [...] }`): `@mostra/themes` ships Studio, now an editorial look, and Arcata, the brand's flat, round other half, both in light and dark, plus `frame`, UX-01's look, which the shell and a server's pages keep. A stack takes plugins' themes, the artifact's own CSS layers and `"host"`, and a theme is data with a JSON schema (`theme.schema.json`). A theme layer's faces, name and CSS are checked as CSS takes them, so a plugin's theme can add no rule and load nothing; `@/` keeps its query (`?raw`, `?url`) and works in stylesheets too.

### Patch Changes

- Updated dependencies [[`3ee3dc4`](https://github.com/mostra-dev/mostra/commit/3ee3dc4bcd61998803f6ea19b8827a1b88f4f680), [`837f993`](https://github.com/mostra-dev/mostra/commit/837f99365ce1c2de2c05095841a68d4942116982)]:
  - @mostra/react@0.19.0
