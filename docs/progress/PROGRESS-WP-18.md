# WP-18 progress: Kit I, design system, tokens and forms

**Status:** in progress. Owns KT-03, KT-04, KT-05, KT-08 and KT-10 ([specification](../design/work-packages/WP-18.md)), with #158 and #159 on its milestone.

## Baseline

| | |
|---|---|
| Branch | `wp/18-kit`, created from `origin/main` |
| Starting `HEAD` | `d9d8467` (`origin/main`, 2026-11-19: "docs: WP-17's closeout, Mostra 0.17.0, WP-18 next (#213)") |
| `git status` | clean |
| Static jobs | `pnpm check --job format-lint --job types --job build --job boundaries --job api --job docs --job licenses` on `d9d8467`, 2026-11-19: all seven green (format-lint 161 s, types, build and api 97 s, boundaries 58 s, docs 13 s, licenses 3 s) |
| Full baseline | CI's `ci:full` run on this pull request's first commit (a local full `pnpm check` is load-bound on this Mac, as in WP-14 to WP-17) |
| Predecessors | WP-16 ([PROGRESS-WP-16](PROGRESS-WP-16.md)) and WP-17 ([PROGRESS-WP-17](PROGRESS-WP-17.md)) on `origin/main`; no `RECOVERY-WP-18-*.md`; the `WP-18` milestone holds #158 and #159 |
| Local toolchain | Node 24.22.1 (`.node-version`), pnpm 12.14.0, macOS 26.2 arm64 |

## Decisions with Mirza

Recorded as **D181** (items 1 to 12), with the source messages M86 to M93; summarized here, worded there.

- **2026-11-19 (M86 to M89):** Studio becomes opinionated, not quiet; two built-in themes an agent chooses between; themes are chosen as an ordered stack the agent controls, on a foundation a marketplace can grow from (plugin themes); a page keeps its theme inline in a chat host and takes the host's look only where its stack names `"host"`; everything else delegated ("I trust you to make the most robust … decisions").
- **2026-11-19 (M90, M91):** two review pages, built with Mostra, showed both directions on the same four screens. Round one: the editorial direction was "absolute perfection" and became Studio; the product direction was replaced by Arcata. Round two: Arcata's second pass (readable hover on a chosen option, lighter panels, menu rounding, dialog padding, the select list), and tabs that slide between options in both themes.
- **2026-11-20 (M92):** the shell and a server's own pages keep UX-01's look (the `frame` theme) whatever theme a page wears.
- **2026-11-20 (M93):** the package's agent-facing and viewer-facing prose accepted as written (D149).

## What was built

| Part | Where | What it does |
|---|---|---|
| Theme layers and the token contract | `packages/themes/src/{tokens,theme,kit,schema}.ts` | A theme is data, made partial as a layer (`ThemeLayer`, `defineThemeLayer`, `composeThemes`), with tokens beside the palette (type, shape, space, depth, surface, motion) that every kit part reads; `kitStylesheet` makes a stack's CSS inside the build's own Tailwind run; `theme.schema.json` is generated for themes written elsewhere |
| Studio, Arcata and `frame` | `packages/themes/src/themes.ts` | Studio: the editorial direction (white grounds, nero rules, square edges, large Jost, giallo answers, rosso for what is recommended). Arcata: flat fields of colour, round shapes, bold Jost, blu choices. `frame`: UX-01's look for the shell and server pages |
| The theme stack | `packages/protocol/src/manifest.ts`, `packages/runtime/src/kit/`, `builder/child/kit.ts` | `kit.theme` is a theme or an ordered list (built-in ids, plugin themes, `./file.css` layers, `"host"`, or `"none"` alone), resolved into the version (its digest in `envDigest`) and named in the verdict; `mostra new` writes it |
| Per-base registry packs | `packages/kit/` (`registry/`, `scripts/`, `upstream/shadcn/`) | shadcn 4.23.0's own output for `base-nova` and `radix-nova`, pinned by SHA-256, restyled once onto the token contract by one rule table both bases share, plus the kit's tabs with a moving indicator: 64 parts per base |
| Resolution without copying, and `mostra add` | `builder/child/kit.ts`, `verify/typecheck.ts`, `packs/` | `@/components/ui/<part>` resolves to the artifact's own file first, else the kit's for its base, in the build and the type check; `mostra add <name>` copies a kit part as shadcn writes it, and a kit item's bare dependencies resolve kit-first |
| Questionnaire and layout | `packages/kit/src/{questionnaire,layout}.tsx` | `@mostra/kit/questionnaire` (sections, choices with a recommended option and an optional clear, other, scales, ranking, text, per-item comments, required items, progress, steps) on `useField`, each answer's options in results; `@mostra/kit/layout` (`Page`, `Section`, `Figures`, `Figure`); the field scan learns their ids |
| Field options | `packages/protocol/src/interaction.ts`, runtime `interaction/`, react `hooks.ts` | `useField(id, initial, { options })`: an answer's options (labels, the recommended one) stored with the field (migration 19) and named in results |
| Host look | react `runtime/mcp-theme.ts`, shell `viewer.tsx`, `HomeConfig.look` | The page follows its frame's light or dark; a host's MCP Apps variables apply only where the stack names `"host"`, over or under the page's theme; the exporter keeps the theme's attributes inline |
| Lint and `--fix` | runtime `verify/lint.ts`, CLI `verify --fix` | `MOSTRA_LINT_API_CHANGED` for each churned API with a replace fix, `MOSTRA_KIT_WRONG_BASE` from the TS2322 of the other base's idiom, `MOSTRA_KIT_CSS_UNPROCESSED`; `--fix` writes the fixes and verifies again |
| Theme commands | CLI `theme list`, `theme show`, `verify --theme` | The themes on offer, a stack's tokens or CSS, and one run in another look |
| Plugin themes | protocol `plugin/manifest.ts`, runtime `plugins/` | `contributes.themes`, each checked at install against the layer rules |
| The Skill | `skills/mostra/` | References rewritten for the kit and its themes; four examples on the kit (a specimen of every part added); `assets/studio.css` and its copies gone |

## Evidence

Every check runs through the real interface: a real daemon over the host protocol, `mostra` from the workspace build, and Playwright against the real gateway and shell in Chromium, Firefox and WebKit. Each row's seeded violations (`node packages/runtime/scripts/prove-seeds.ts --only <ID>`) go red when planted and green when restored.

| ID | State | Check | Command | Result |
|---|---|---|---|---|
| KT-03 | verified | Both bases' 64 parts type-check under verify's strict settings with unused code refused; every part renders and passes verify (no error or warning, axe included) in both bases and both built-in themes; `@/components/ui/*` resolves to the kit's part for the artifact's base with nothing installed, and to the artifact's own copy first; `mostra add <name>` copies the base's part as shadcn writes it, a kit item's dependencies kit-first, and the page builds from the copy; the default base is Base UI from EVAL-01 and EVAL-01b's evidence (D72, D75) | `packages/kit` `registry.test.ts`; `vitest --project integration kit-parts.test.ts -t "kit part"` (group `core`, on Windows `windows-verify-failures`); `packs.test.ts -t "the kit's parts by name"` (group `extensions`); e2e `kit.spec.ts` "design freedom"; `prove-seeds.ts --only KT-03` | 2 registry, 4 verify and 4 packs tests pass; the e2e passes in three engines; KT-03's seeds red, then green |
| KT-04 | verified | A layer that changes only tokens restyles every visible kit part of the specimen (140 parts, each element's screenshot differs, none unchanged); light and dark follow the device and the shell's switch, and reach the page from its frame; a host brand theme (`HomeConfig.look`) reaches only pages whose stack names `"host"`, over or under the page's theme, with values that could end a declaration dropped; MCP Apps variables map through `HOST_TOKENS` inline, and the exporter keeps the theme; every built-in theme holds WCAG 2.2 AA in both modes and meets its schema; Mirza reviewed the directions (M90, M91) and the final screens | e2e `kit.spec.ts` "token" and "host's look", `mcp-apps.spec.ts`; `packages/react` `host-look.test.tsx` (browser); `plugins/mcp-app` `exporter.test.ts`; `packages/themes` tests; `prove-seeds.ts --only KT-04` | the e2e passes in three engines; 3 browser, 11 exporter and 35 themes tests pass; KT-04's seeds red, then green |
| KT-05 | verified | A questionnaire with every answer type (a choice with its recommended option and comments, a scale, several choices with other, ranking, an optional choice cleared (#159), text) saves each answer through its field, blocks Submit on a required item by its label, shows progress, survives a reload, submits through the trusted Submit and arrives in `results` labelled with its options and the recommended one; verify calls a radio already chosen bound (#158); the field scan knows the questionnaire's ids, so coverage stays exact | e2e `kit.spec.ts` "each answer saves"; `kit-parts.test.ts -t "the kit's forms"`; runtime unit `interaction.test.ts`, `coverage.test.ts`; `packages/react` `store.test.ts`; `prove-seeds.ts --only KT-05` | the e2e passes in three engines; the unit and integration tests pass; KT-05's seeds red, then green |
| KT-08 | verified | Each guidance rule (`framer-motion`, `react-router-dom`, `reactflow`, TanStack Table 8, Zod 3's formats, Mermaid's deprecated calls, Tailwind 3's classes and directives, the old `cn` helper) has a fixture whose fix gives the expected text and then lints clean, beside current code that lints clean; the other base's idiom, in either base, becomes `MOSTRA_KIT_WRONG_BASE` with the rewrite; `mostra verify --fix` writes the fixes and the page passes; Tailwind CSS that Tailwind never reads is `MOSTRA_KIT_CSS_UNPROCESSED`; the Skill's "write this, not that" table covers each library | runtime unit `lint.test.ts`; `packages/cli` `contract.test.ts -t "verify --fix"`; `prove-seeds.ts --only KT-08` | 16 lint tests and the contract test pass; KT-08's seeds red, then green |
| KT-10 | verified | A `className` restyles a kit part, and the artifact's copy of a part wins over the kit's; every part reads the tokens (KT-04's restyle); a page that uses nothing of the kit verifies with no warning, in Studio by default (as the verdict says) or with no theme built at all (`"none"`); nothing in verify asks for the kit | e2e `kit.spec.ts` "design freedom"; `kit-parts.test.ts -t "uses nothing of the kit"`; `prove-seeds.ts --only KT-10` | the e2e passes in three engines; the integration test passes; KT-10's seeds red, then green |

## Issues on the milestone

| Issue | What was done | Test, and its seed |
|---|---|---|
| #158 | Verify's smoke test judged a control unbound when using it saved nothing, although choosing a radio already chosen changes nothing to save. It now compares the control's value before and after (`checked` for a radio or checkbox) and judges only a control whose value changed | `kit-parts.test.ts` "judges an input unbound only when its value changed" (a radio group starting on its value and an unbound input: one finding, the input's); seed red, then green |
| #159 | The kit's single choice offers "Clear my answer" when its question is optional, writing the field back to no answer | e2e `kit.spec.ts` "each answer saves" clears the optional choice and finds it empty in results; seed red, then green |

## Found while building

- **shadcn's raw registry items aren't what `shadcn add` writes.** They carry an icon placeholder and style markers its CLI rewrites, so the kit vendors the CLI's own output for both styles instead of emulating it. Installing those raw items by URL with `mostra add` keeps them unrewritten: filed as #219, for the package that next touches packs.
- **Tailwind's preflight overrode a theme's heading rules** written under `:where()`; the theme's base rules are plain selectors inside `@layer base`.
- **A theme's portaled menus rendered transparent** in the first prototype, because its attributes were on a wrapper and portals render outside it; the build puts `data-theme` on `<html>`.
- **The kit's dark variant missed the root itself**, so a layer's `:root { @variant dark { … } }` never applied; it covers the root now.
- **The TanStack Table rule flagged version 9's own `createColumnHelper`**, found by the Skill's code samples; it flags it only beside version 8's names.
- **Arcata's choices vanished on a page without sections** (white on white), found in the final review screens; they are a field of colour on any ground.
- **The kit's registry test read `@mostra/react`'s built types**, which CI's unit job doesn't build: the kit's tests now depend on its dependencies' builds, as an artifact's type check reads them.
- **The plugin manifest's new `themes` key was strict**, which the schema check refuses within a revision (an older release accepted any value with a warning): it is read leniently, each malformed entry a warning.
- **By my own diff review:** `mostra verify --fix` resolved a fix's file by its path only, so a link inside the artifact could carry a write outside it; it now writes only files whose real path is inside the artifact's (`fix.test.ts`, a seed red, then green).

## What CI found

- **The first `ci:full` run** (44780891728): the kit's registry test needed `@mostra/react`'s built types, which the unit job doesn't build (above); the Rust crate's wire types weren't regenerated after the protocol's additions (`cargo run -p mostra-host-codegen -- write`).
- **The second** (44783654473): the CLI's contract test lacked `theme list` and `theme show` (now covered); Windows arm64's `windows-verify` ran past its 14 minutes with WP-18's kit suite in `verify.test.ts`, which moved to a suite of its own (`kit-parts.test.ts`); #220 filed: reading a worker's command line waited 40 s for Windows PowerShell once on arm64 (#196's bound, code no package here touches).
- **The third** (44793555343): macOS `core` reached its deadline with the kit suite in it, and `verify.test.ts` alone now takes 12 of Windows arm64's 14 minutes, since every build carries its theme. The groups were rebalanced (REPO_STANDARDS §6): the kit suite runs in `extensions` on macOS and Linux and in `windows-verify-failures` on Windows; the secrets suite moved to `windows-publish` and `mostra dev`'s to `windows-extensions`. The restyle check timed out at 240 s on Windows x64 Firefox: it now cuts every part from one screenshot per build (CSS pixels, so WebKit's 2x screenshots compare too) and takes 15 to 30 s in each engine, its seed still red. Also met: #152's macOS Chromium hang in `surfaces.spec.ts` (recorded there), and a Windows arm64 runner whose PowerShell crashed in the setup step before any of Mostra ran.
- **The fourth** (44802962232): every job green but macOS `verify-failures`, past its 10 minutes (MT-03 had seen it near them; each verify now builds its theme). The binding's heartbeat suite moved from it to `remote` on macOS and Linux; its two seeds re-anchored and proven.
- **The fifth** (44810820842, on `4da90fc1`): green on every job and leg, Windows arm64 and the six-platform release rehearsal included.
- **A pre-push run:** MT-05's `data-marks.test.ts` compared two millisecond timestamps of an open and a close that landed in the same millisecond under load; the close now waits for a later millisecond, the check as strict as before.
