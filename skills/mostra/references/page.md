# The artifact: files, manifest, pages and packages

## Contents

- Files
- The manifest
- Pages
- Packages
- Styles and assets
- MDX
- Who and where: `useViewer`, `useArtifact`
- Sending the person elsewhere: `openLink`
- Pages written for Claude: `window.storage`

## Files

An artifact is a directory (or a single `.tsx`, `.jsx` or `.mdx` file). No `package.json`, `tsconfig.json` or build configuration is needed; Mostra brings its own.

```text
my-artifact/
  index.tsx        the entry: `export const artifact = defineArtifact({...})` and the page as the default export
  AGENTS.md        what `mostra new` wrote for agents editing this artifact
  pages/           optional routes, see Pages
  actions.ts       any module whose first statement is "use server" (the name is free), see server.md
  live.ts          live data sources (this exact name), see long-lived.md
  components/      anything else you import
  public/          files served as they are, at /<name>
```

A directory has exactly one entry: `index.tsx`, `index.jsx` or `index.mdx`. `node_modules`, `.git`, `.mostra`, editor backups and paths listed in a `.mostraignore` file stay out of the published source.

## The manifest

```tsx
import { defineArtifact } from "@mostra/react";

export const artifact = defineArtifact({
  id: "art_01M66HS31X56AW7VKS2JV1C9N7",   // written by `mostra new`; keep it
  title: "Q4 hiring plan",                 // required when a manifest is present
  description: "Approve or change the plan for next quarter.",
  family: "proposal",                      // questionnaire, proposal, prototype, review, dashboard, deck, demo, inbox, tasks, or your own word
  submission: { policy: "once" },         // see answers.md; the host running Mostra may override it
  links: [{ rel: "round-of", artifact: "art_…" }],
  limits: { heapMb: 1024, watchdogMs: 10000, idleMinutes: 10 },
});
```

- Every value is a literal (`as const` and `satisfies` are fine). Mostra reads the manifest without running your code; a computed value is `MOSTRA_MANIFEST_NOT_LITERAL`.
- `artifact.title` and the other fields are usable in the page (`<h1>{artifact.title}</h1>`).
- An artifact without an `id` is bound to its directory at its first publish. Copying a directory that carries an `id` makes two sources claim one artifact (`MOSTRA_PUBLISH_ID_CONFLICT`): give the copy a new one with `mostra new`.
- An entry without any manifest publishes with defaults, titled after its directory.

## Pages

With a `pages/` directory every `.tsx`, `.jsx` or `.mdx` file in it is a route:

| File | Route |
|---|---|
| `pages/index.tsx` | `/` |
| `pages/settings.tsx` | `/settings` |
| `pages/reports/index.tsx` | `/reports` |
| `pages/reports/[id].tsx` | `/reports/:id` |
| `pages/docs/[...rest].tsx` | `/docs/*` |

The entry's default export then becomes the layout every page renders inside, receiving the page as `children`. Link between pages with React Router's `Link` (`import { Link, useParams } from "react-router"`). Fields work the same on every page: they belong to the artifact, not to a route.

## Packages

- Import any npm package by name. Packages in the warm set ([libraries.md](libraries.md)) resolve instantly; any other is installed on demand at the newest release at least a day old, pinned exactly, and frozen into the version at publish.
- `mostra add <package>[@version] --artifact <dir>` pins a version yourself, before you import it.
- Imports must stay inside the artifact: `../shared/x` is refused (`MOSTRA_BUILD_UNRESOLVED`). Use `@/components/x` for a path from the artifact's root.
- A package without types is a warning (`MOSTRA_TYPE_UNTYPED_PACKAGE`); declare a module or ignore it.
- Offline, only packages already in Mostra's store resolve (`MOSTRA_DEP_OFFLINE` names the missing one).

## Styles and assets

- Tailwind CSS 4 is always on: write utility classes, with no configuration file. Theme values live in CSS (`@theme`), as in [design.md](design.md).
- Import your own CSS from the page (`import "./styles.css"`). A stylesheet that defines `@theme` or `@layer base` starts with `@import "tailwindcss";`.
- Files in `public/` are served at the root: `public/logo.svg` is `/logo.svg`. Use root-relative paths.
- Fonts and images load from the artifact; a page makes no third-party request unless you write one.

## MDX

`index.mdx` (or any page in `pages/`) is Markdown with JSX. The manifest is YAML frontmatter with the same fields:

```mdx
---
title: Release notes for 2.4
family: proposal
---

import { Approve } from "./approve";

# What changed

<Approve />
```

GitHub-flavoured Markdown (tables, task lists) works. MDX isn't type-checked.

## Who and where

```tsx
import { useArtifact, useViewer } from "@mostra/react";

const viewer = useViewer();     // { id, name?, source: "local" | "tailnet" | "token" | "host" }
const page = useArtifact();     // { id, versionId, version, viewId, mode: "live" | "static" | "mcp-app" | "verify" }
```

`useViewer().name` is the person's name when the link or tailnet knows it. `mode` is `verify` while verify renders the page and `live` when a person opens it.

## Sending the person elsewhere

The page runs in a frame that can't navigate the person's tab, so it can never replace Mostra's trusted controls. Use `openLink`, which opens `http:`, `https:`, `mailto:` and `tel:` URLs in a new tab:

```tsx
import { openLink } from "@mostra/react";

<button onClick={() => void openLink("https://github.com/acme/app/pull/42")}>Open the pull request</button>
```

Plain `<a href target="_blank">` links work too.

## Pages written for Claude

A page that uses Claude artifacts' `window.storage` works unchanged: `get`, `set`, `delete` and `list`, each with `shared`. Personal keys are the person's saved fields (`storage.<key>`), shared keys are the artifact's shared state. A value is at most 1 MiB. For new code, prefer `useField`, which verify understands and results label.
