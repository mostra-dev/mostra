# Add a diagnostic code

Use when Mostra needs to report a new condition to an agent, a host or a viewer. Every error at
every interface is a diagnostic (INTERFACES §1, §13), and its code is semver surface (AX-03).

1. **Pick the code.** `MOSTRA_<AREA>_<NAME>`, with the area from INTERFACES §13 (the list in
   `packages/protocol/src/diagnostics/diagnostic.ts`). Grep the catalog first: reuse a code whose
   meaning fits instead of minting a near-duplicate. A new area means extending INTERFACES §13
   first.
2. **Generate it.**
   ```sh
   pnpm gen diagnostic MOSTRA_HOME_LOCKED --severity error --phase host --title "Home already in use"
   ```
   Severity: `error` only for definite failures; observations that may be fine are `warning`
   (D72). The generator adds the code to its area file, creating the file and wiring it into the
   catalog when the area is new.
3. **Write the text** in the area file: `title`, `hint` (one imperative sentence: what to do),
   `docs.explanation` (what it means, when Mostra reports it) and `docs.fix` (the minimal fix).
   Hints are agent-facing prose: draft them with Mirza (D74).
4. **Use it** through `createDiagnostic(code, { message, hint?, fix?, location? })`. Messages
   describe the occurrence and never include secrets or capability tokens.
5. **Regenerate and record.** Run `node tools/docs/diagnostics.ts write` (the docs page and catalog
   JSON), rebuild so the API report picks up the code, and add a changeset for `@mostra/protocol`.

To retire a code, set `deprecated` with what replaced it. Never delete a released code.

**Done when** `pnpm check --affected` passes: the `docs` job finds the code with complete text and
a current page, and the `api` job finds the report change covered by a changeset.
