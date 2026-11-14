---
"@mostra/runtime": minor
"@mostra/cli": minor
---

Plugins and source packs (D30, D31). `mostra plugin validate|add|list|remove` checks a plugin's manifest, contract ranges, entries, conflicts and licenses before its lockfile records it, for one artifact or, for exporters and CLI commands, the whole home; `verify` and `publish` load an artifact's plugins again. `mostra add` installs shadcn registry items (by URL, local file, GitHub `owner/repo/item`, a `components.json` namespace, or `plugin:<package>/<item>`) with their registry dependencies, as shadcn would, and their npm packages. A license that isn't OSI-approved, public-domain or free needs `--accept-license <id>` once, recorded in the lockfile, unless the home's host accepted it (`HomeConfig.licenses`). `mostra export --as <id>` runs an exporter a plugin contributes, and `mostra <words>` runs a plugin's CLI command.
