# Add a host protocol method

Use when a client or host needs a new JSON-RPC method on the host protocol (INTERFACES §6, D59).
The method's schemas live in `@mostra/protocol`; the server that implements it lives in
`@mostra/runtime` (`protocol-server`).

1. **Check the contract.** The method's name, params and result come from INTERFACES §6. A method
   or field that isn't there is a design change: bring it to Mirza with a proposal first.
2. **Generate it.**
   ```sh
   pnpm gen protocol-method artifact/publish --mutating
   pnpm gen protocol-method port/submissions.deliver --direction instance-to-host
   ```
   `--mutating` adds the optional `requestId` every mutating method takes for idempotent retries
   (H-03). The generator writes `packages/protocol/src/methods/<group>/<name>.ts`, registers the
   method in `methods/index.ts` and exports it from the package entry.
3. **Fill in the schemas.** Write the params and result interfaces with TSDoc on every field, and
   their Zod schemas next to them (`z.ZodType<…>`, `exactOptional()` for optional fields). Reuse
   the ID kinds (`ArtifactId.schema`) and `Diagnostic`. Every schema registered in `wireRegistry`
   gets a stable id: it becomes a definition name in the published JSON Schema.
4. **Test it** in `packages/protocol/test`: valid and invalid params and results through the
   public entry.
5. **Serve it** (client-to-instance methods). Implement it in the `@mostra/runtime` module that
   owns the behavior and register `handler(definition, fn)` with the `ProtocolServer` that the
   `instance` module builds. The server validates params and results against the schemas and turns
   thrown `RpcError`s into diagnostics. Add a scenario to
   `packages/runtime/test/integration/protocol-suite.test.ts`, which runs it over stdio and the
   socket.
6. **Regenerate and record.** `pnpm --filter @mostra/protocol gen:schemas`, rebuild for the API
   report, and add a changeset for `@mostra/protocol`.

Within a revision, a method only grows: new optional params, new result fields, new methods. A
breaking change needs a new revision in `HOST_PROTOCOL_REVISIONS` and Mirza's approval (D32).

**Done when** `pnpm check --affected` passes, including the `api` job's schema compatibility check
against the base.
