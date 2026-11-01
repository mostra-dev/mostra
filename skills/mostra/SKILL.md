---
name: mostra
description: Communicate visually with the user through Mostra. Use whenever showing or asking works better as a page than as chat text, such as questions to answer, options to choose between, a plan to approve, work to review, a report, a dashboard, a demo, or a page kept up to date. You write an ordinary React page, Mostra verifies it, publishes it behind a private link, and returns the person's answers to you.
license: Apache-2.0
compatibility: Needs a shell that runs `mostra` (or `npx` with Node.js 22.19 or later) on macOS, Linux or Windows, x64 or arm64.
metadata:
  version: "0.8.0"
---

# Mostra

Mostra turns a React page you write into an **artifact**: a web page a person opens from a private link, reads, answers, and acts on. Their answers are saved as they type, submitted once they're done, and come back to you as **results**. You check every page with `verify` before anyone sees it, so you never send a page you haven't looked at.

## Running Mostra

Run `mostra <command>`. When `mostra` isn't on the `PATH`, run `npx -y @mostra/cli@0.8.0 <command>` everywhere this Skill says `mostra`; the first run downloads Mostra's own runtime (no global Node.js needed beyond `npx`). Every command takes `--json` (one JSON envelope on stdout, logs on stderr) and `--help`. `mostra docs <topic>` prints the reference, including every diagnostic code's page (`mostra docs MOSTRA_FIELD_DUPLICATE_ID`). `mostra list` lists the artifacts you've published, and `mostra status` shows the running instance.

## Words

| Word | Meaning |
|---|---|
| artifact | One page (or a few, under `pages/`) in its own directory, with a stable `art_…` ID |
| version | One published, immutable build of an artifact. People only ever see versions |
| field | One saved answer with a stable string ID: `useField("budget", 0)` |
| submission | The immutable snapshot of a person's answers, made when they submit |
| capability URL | The private link. Whoever holds it can use the artifact; treat it like a password |
| trusted control | The Submit (and Choose) button Mostra draws outside your page, so the person knows it's real |
| results | The submission as Markdown or JSON: answers by label, choices, comments, actions |

## The loop

Each step ends when its check holds. Don't hand a link out before step 4 passes.

1. **Decide what the person does.** Write one sentence: who it's for, what they do, what comes back to you. Pick the submission policy: `once` (the default: one submission, then it's closed), `epochs` (they can submit again, each round kept), or `none` (a long-lived page that never submits, such as a dashboard or task list: see [references/long-lived.md](references/long-lived.md)). *Done when* the sentence names the answers you need.
2. **Create it.** `mostra new <dir> --title "<title>"` writes `index.tsx` (with the artifact's `id`; keep it) and an `AGENTS.md` for whoever edits it next. *Done when* the directory exists.
3. **Write the page.** Ordinary React 19 and TypeScript with Tailwind CSS 4, no `package.json`, no build config. Every answer is a field with a stable ID:

   ```tsx
   import { defineArtifact, useField, useSubmitControl } from "@mostra/react";

   export const artifact = defineArtifact({
     title: "Sidebar redesign: your call",
     description: "Pick a direction and say why.",
     submission: { policy: "once" },
   });

   export default function Page() {
     const [direction, setDirection] = useField("direction", "", { label: "Direction", required: true });
     const [why, setWhy] = useField("why", "", { label: "Why" });
     useSubmitControl({ label: "Send my choice" });
     // …render radios bound to direction, a textarea bound to why
   }
   ```

   Mostra draws the Submit button in its own frame around your page; `useSubmitControl` names it, and `required` fields block it until they're answered. Make it look considered: [references/design.md](references/design.md) has a baseline stylesheet and the rules for pages people answer. *Done when* every answer you need is a field with a label.
4. **Verify until it passes.** `mostra verify <dir> --screenshots always`. It type-checks, builds, renders the page headlessly, clicks through it, runs an accessibility check and screenshots it at 1280×800 and 390×844. Fix every error, then **open both screenshots and look at them** (about 1,300 and 450 image tokens). Warnings that start with "Observed only" describe what verify saw; judge them, and leave working code alone. *Done when* the status is `pass` and the screenshots show what you meant at both sizes. More in [references/verify.md](references/verify.md).
5. **Publish.** `mostra publish <dir>` prints the version and the capability URL. Publishing again after an edit makes a new version; open pages offer the person the new one, and answers carry over by field ID. *Done when* you have the link.
6. **Hand the link over.** Say who is asking and why, what the page is for, and roughly how long it takes. On this machine, `mostra open <dir>` opens it in the browser. For a phone or another person, see [references/sharing.md](references/sharing.md): one link is one person's draft, so give each person their own link. *Done when* the person has the link and knows what to do.
7. **Wait for the answer.** `mostra wait <dir> --until submitted --timeout 10m`. Exit code 0 means submitted; 5 means still waiting, with nothing lost: wait again, or continue other work and check later. *Done when* it exits 0.
8. **Read the results.** `mostra results <dir>` prints the submission as Markdown (`--format json` for JSON). Act on it. *Done when* you've used every answer.

## What a page can do

| Need | Use | Reference |
|---|---|---|
| Save an answer, a choice, a note | `useField(id, initial, { label, required, validate })` | [answers.md](references/answers.md) |
| A form with validation | `useForm` from `@mostra/react/form` (react-hook-form) | [answers.md](references/answers.md) |
| Name or confirm the trusted Submit | `useSubmitControl({ label, confirm })` | [answers.md](references/answers.md) |
| Let the person ping you without submitting | `useSignal(name).send(payload)`, then `mostra wait <dir> --until signal:<name>` | [answers.md](references/answers.md) |
| Choose one of several candidates | `useChoice(reviewSetId, { candidates })` | [answers.md](references/answers.md) |
| A button that does something real (send, file, deploy) | a `"use server"` function, run with `useAction(fn, { key })` | [server.md](references/server.md) |
| Secrets for that code | `mostra secret set NAME`, then `secret("NAME")` in server code | [server.md](references/server.md) |
| Data that updates by itself | `defineLive` in `live.ts`, `useLive(key)` in the page, `mostra push` from you | [long-lived.md](references/long-lived.md) |
| State everyone shares and you can edit | `useField(id, initial, { scope: "artifact" })`, `mostra state set` | [long-lived.md](references/long-lived.md) |
| Several pages, packages, MDX, images | `pages/`, any npm import, `index.mdx`, `public/` | [page.md](references/page.md) |
| Charts, tables, animation, UI primitives | the preinstalled libraries | [libraries.md](references/libraries.md) |

## Rules verify enforces

- **Field IDs are stable.** A literal string (`useField("budget", …)`), or a template keyed by your data's own ID for a list (`` useField(`reply.${email.id}`, …) ``); never an array index or a random value. Changing an ID between versions leaves the old answer behind ("Not carried over"). An ID used twice with different types is an error.
- **The manifest is a literal.** `defineArtifact({...})` holds only literal values; Mostra reads it without running your code.
- **Imports stay inside the artifact directory.** Packages install on demand; `@/…` imports from the artifact's root.
- **Server code is opt-in for verify.** Verify never runs a `"use server"` function unless it checks `dryRun()` and skips its side effects. The others are reported as skipped, which is fine.
- **No browser errors.** Uncaught errors, console errors and failed requests to your own origin are errors; a blank page is an error.

## Codes you'll meet most

| Code | What to do |
|---|---|
| `MOSTRA_TYPE_ERROR` | Fix the TypeScript error at the location given |
| `MOSTRA_BUILD_UNRESOLVED` | Import from inside the artifact, or a package by its name |
| `MOSTRA_MANIFEST_NOT_LITERAL` | Write the manifest's values as literals |
| `MOSTRA_FIELD_DUPLICATE_ID`, `MOSTRA_FIELD_ID_UNSTABLE` | Give each field one stable ID |
| `MOSTRA_RUNTIME_PAGE_ERROR`, `MOSTRA_CONSOLE_ERROR`, `MOSTRA_RUNTIME_BLANK` | Fix the page's runtime error; look at the screenshot |
| `MOSTRA_VERIFY_ACTION_SKIPPED` | A hint: that action didn't run in verify. Add a `dryRun()` branch if you want it exercised |
| `MOSTRA_SMOKE_NO_EFFECT`, `MOSTRA_REGRESSION_*` | Observed only: check the screenshot, change nothing that works |
| `MOSTRA_PUBLISH_VERIFY_FAILED` | Publish refused because verify failed: run verify and fix its errors |
| `MOSTRA_SUBMIT_NOT_FOUND` | Nothing submitted yet: wait for it |

Every code's page: `mostra docs <CODE>`.

## References

Read the one you need when you need it.

| File | Read it when |
|---|---|
| [references/page.md](references/page.md) | Structuring the artifact: files, manifest, pages, packages, MDX, links out, `window.storage` |
| [references/answers.md](references/answers.md) | Collecting answers: fields, forms, submission policies, signals, choices, `wait` and `results` |
| [references/design.md](references/design.md) | Before writing the page's markup: the baseline stylesheet and the design rules |
| [references/verify.md](references/verify.md) | Verify fails, or you want to understand a verdict, screenshots or `mostra dev` |
| [references/server.md](references/server.md) | The page must do something real: actions, secrets, idempotency |
| [references/long-lived.md](references/long-lived.md) | A page that lives for days: shared state, live data, `none` policy, always-on |
| [references/sharing.md](references/sharing.md) | Someone other than the person at this machine opens it, or on another device |
| [references/libraries.md](references/libraries.md) | Using charts, tables, motion or UI primitives, or an import fails |

Three complete artifacts that pass verify, to copy from: [assets/examples/decision/](assets/examples/decision/) (a choice with a reason), [assets/examples/inbox/](assets/examples/inbox/) (drafted replies with real Send actions) and [assets/examples/dashboard/](assets/examples/dashboard/) (live data and a shared list). The same guide is `mostra docs guide`, and each reference `mostra docs guide/<name>`.
