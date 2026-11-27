# @mostra/kit

## 0.21.0

### Minor Changes

- [#253](https://github.com/mostra-dev/mostra/pull/253) [`b6384f2`](https://github.com/mostra-dev/mostra/commit/b6384f2a200c1c552a2f94e79466a0899580db50) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - Web demos and exports (WP-24, D185). A page shows a front end the project builds, a Vite app, a
  Next.js static export or any build that writes static files, as a demo: the manifest's `demos` name
  its source folder, build command and output folder; Mostra builds it at verify and publish (and with
  `mostra demo build`), checks its output, keeps it with the version and serves it on the artifact's
  own origin under `/_mostra/demos/<name>/`, with deep links and the review agent; `<WebDemo>` from
  `@mostra/kit/demo` shows it in a phone, tablet or browser frame. A demo works the same locally,
  through a share, on a remote server and in every export, and a failed build fails verify with its
  log. `mostra export --as static | html | snapshot` writes the page's front end as a folder that opens
  from disk and on any static host (`--base` for a subpath), one HTML file, or a snapshot of its
  answers and state (`--submission`, `--no-shared-state`); every export names what it loses and what
  needs a network, never carries server code or secrets, and `--strict` makes its warnings an error.
  Controls that need the server show themselves unavailable in an export: `useAction().available`,
  `useLive().frozen` and `ActionButton` from `@mostra/kit/action`.

### Patch Changes

- Updated dependencies [[`b6384f2`](https://github.com/mostra-dev/mostra/commit/b6384f2a200c1c552a2f94e79466a0899580db50)]:
  - @mostra/react@0.21.0

## 0.20.0

### Minor Changes

- [#244](https://github.com/mostra-dev/mostra/pull/244) [`12b5b07`](https://github.com/mostra-dev/mostra/commit/12b5b0796ee09e6aa50e0410679c049f9df71795) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - The review layer (WP-20): comments pinned on any content in the shell's overlay, with replies, resolve and reopen, mentions, every anchor layer and a crop of each place; review sets in `@mostra/kit/review` (gallery, focus, synchronized compare with a difference view, and the trusted Choose); `registerAnchorProvider` and `useReviewSurface` in `@mostra/react`; `mostra review export`; and the `reviews` and `capture` host ports.

### Patch Changes

- Updated dependencies [[`c06fa31`](https://github.com/mostra-dev/mostra/commit/c06fa31bed473eddc348b3cc0bc638c0f7a1ff47), [`b4d39b0`](https://github.com/mostra-dev/mostra/commit/b4d39b033760a8b80ee615f0d46b04ad09d61ee9), [`bcfd78a`](https://github.com/mostra-dev/mostra/commit/bcfd78a4926ffde4c0a325e8e2999a04219efc8f), [`12b5b07`](https://github.com/mostra-dev/mostra/commit/12b5b0796ee09e6aa50e0410679c049f9df71795), [`8720320`](https://github.com/mostra-dev/mostra/commit/87203205993c53e10f5d61167751d6725b2bc849), [`552ae52`](https://github.com/mostra-dev/mostra/commit/552ae5275017c14efadf7be961f805bf92271df6)]:
  - @mostra/react@0.20.0

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
