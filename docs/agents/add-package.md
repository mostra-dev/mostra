# Add a package

Use when a work package starts one of the packages in map P2 (REPO_STANDARDS §3). Packages exist
only where an independent consumer imports them or a process boundary must hold; a new module
inside an existing package is usually the better shape (STANDARDS, Design).

1. **Check the map.** The package must be in `tools/package-map.ts`, with its audience, where it
   runs, and the workspace and third-party packages it may import. The dependency-cruiser rules are
   generated from that entry. A package or dependency the map doesn't allow is a design change:
   bring it to Mirza first.
2. **Generate it.**
   ```sh
   pnpm gen package @mostra/runtime
   pnpm install
   ```
   You get `package.json` (catalog and workspace specifiers only), the TypeScript projects
   (`tsconfig.src.json` for the published code, `tsconfig.test.json` for tests), tsdown and Vitest
   configs, a placeholder entry with a test, `README.md` and an `AGENTS.md` skeleton, and a
   reference in the root `tsconfig.json`.
3. **Replace the placeholder** export with the package's real interface, with TSDoc on every
   export. Write the caller's usage first (STANDARDS, Design).
4. **Write the docs.** `README.md` for people; `AGENTS.md` with purpose, the invariants the package
   owns, its public interface, the tests to run and gotchas. AGENTS.md is agent-facing prose:
   draft it with Mirza (D74).
5. **Set budgets where they apply.** Browser-facing packages (`@mostra/react`, `@mostra/kit`) get
   a `size-limit` entry and the `size` script, like `@mostra/protocol`.
6. **Add a changeset** once the public API exists.

**Done when** `pnpm check --affected` passes: repository lint finds the package in the map with
its README and AGENTS.md, boundaries pass, and the API report is committed with a changeset.
