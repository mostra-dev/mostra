---
"@mostra/protocol": minor
"@mostra/runtime": minor
"@mostra/react": minor
"@mostra/kit": minor
"@mostra/cli": minor
"@mostra/plugin-mcp-app": minor
---

Web demos and exports (WP-24, D185). A page shows a front end the project builds, a Vite app, a
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
