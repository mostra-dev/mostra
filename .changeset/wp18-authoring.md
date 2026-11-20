---
"@mostra/cli": minor
"@mostra/protocol": minor
"@mostra/runtime": minor
"@mostra/verify": patch
---

Writing with the kit (WP-18, D179). `mostra theme list` and `mostra theme show` (host methods `theme/list` and `theme/show`) show the themes a page can wear and what each sets; `mostra verify --theme <stack>` tries another look for one run, and the verdict names the theme a page was built in. Verify's lint names churned APIs with their fix (`MOSTRA_LINT_API_CHANGED`: `framer-motion`, `react-router-dom`, `reactflow`, TanStack Table 8, Zod 3's string formats, Mermaid's deprecated calls, Tailwind 3's classes and directives, shadcn's old `cn` helper), the other base's idiom (`MOSTRA_KIT_WRONG_BASE`, from the type check's TS2322) and Tailwind CSS that Tailwind never reads (`MOSTRA_KIT_CSS_UNPROCESSED`); `mostra verify --fix` writes those fixes and verifies again. `mostra new` writes the theme into the manifest. Verify no longer calls a radio already holding its value unbound (#158).
