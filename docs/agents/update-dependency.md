# Update or add a dependency

Use when a package needs a new third-party dependency, or an existing one needs a new version.
Renovate opens routine updates; this playbook covers the deliberate ones.

1. **Verify the facts** against the npm registry (or crates.io) today: the version, its license,
   its publish date, its maintenance, and whether it runs install scripts. Record what the design
   depends on in `docs/design/VERIFIED_FACTS.md` with source and date.
2. **Respect the cooldown.** Pick a version published at least 7 days ago. pnpm enforces it
   (`minimumReleaseAge` in `pnpm-workspace.yaml`), and so does Renovate.
3. **Pin it in a catalog.** Add or change the exact version in `pnpm-workspace.yaml` (`catalog:`,
   or a named catalog such as `ts6`), then reference it as `"name": "catalog:"` in the package.
   Repository lint rejects any other specifier.
4. **Check the license.** Everything a published package ships must be OSI-licensed, and nothing
   may come from pnpm's PolyForm-licensed `pnpr/` (D20, D26). Engines with non-OSI licenses are
   never bundled; they become user-installed plugins (D31).
5. **Allow install scripts only when needed**, in `allowBuilds`, with a reason in the pull request.
6. **Check the package map.** A new import must be allowed for the importing package in
   `tools/package-map.ts`; dependency-cruiser enforces it.
7. **Write churn guidance for recent majors** (D48). When the version is a recent major or rename
   that models are likely to get wrong, add "write this, not that" guidance (and a lint rule where
   possible) in the same pull request.

**Done when** `pnpm install` succeeds with the cooldown in force and `pnpm check --affected`
passes, including the `licenses` and `boundaries` jobs.
