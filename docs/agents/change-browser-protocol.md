# Change the browser protocol

Use when the client runtime (`@mostra/react`) and the gateway need to say something new to each
other: a route, a field in a request or an answer, a stream event, a bridge message (INTERFACES §4
and §5). Every published version embeds the client runtime it was built with and never changes,
so the gateway must keep serving every revision it ever shipped (FAILURE_MODEL §7, VR-10).

1. **Check the contract.** The route or payload comes from INTERFACES §4 or §5. Anything else is a
   design change: bring it to Mirza with a proposal first.
2. **Decide: grow the revision or add one.** Within a revision a payload only grows: new routes,
   new optional request fields the gateway doesn't require, new answer fields older pages ignore,
   new bridge messages (D32). Anything an older page would read differently (a field that changes
   meaning, a refusal where an older page expects success, a required field) needs a new revision
   in `BROWSER_PROTOCOL_REVISIONS` (`packages/protocol/src/browser.ts`) and Mirza's approval; the
   newest becomes `BROWSER_PROTOCOL_REVISION`, which goes into every new version's `envDigest`.
3. **Change the schemas** in `@mostra/protocol` (`browser.ts`, `view.ts`, `bridge.ts`), with TSDoc
   on every field and the Zod schema beside the type; register new wire schemas in `wireRegistry`.
4. **Serve it** in `packages/runtime/src/gateway/browser.ts` behind a route declared in
   `gateway/index.ts` with its intent, session and scope (D96). Route handlers get the revision the
   page called (`params.rev`): when a new revision changes behavior, branch on it there, and keep
   the old revision's behavior exactly.
5. **Use it** in `@mostra/react` (`src/runtime/transport.ts`, `store.ts`) or the shell
   (`packages/shell/src/api.ts`, `stream.ts`).
6. **Freeze a new revision.** For a new revision only, after it is served:
   ```sh
   pnpm --filter @mostra/protocol --filter @mostra/react --filter @mostra/runtime build
   cd packages/runtime && node --conditions=@mostra/source scripts/freeze-browser-revision.ts
   ```
   It publishes the client fixture (`tests/e2e/fixtures/client`) at the current revision and copies
   the version into `test/fixtures/browser-revisions/<revision>/`; it refuses to overwrite an
   existing one, because a frozen version is what older releases really shipped. Commit it.
7. **Test it.** Unit tests in the package that owns the change, an end-to-end test through the real
   shell and gateway (`tests/e2e`, [playbook](write-e2e-test.md)), and
   `pnpm --filter @mostra/runtime test:integration -- browser-revisions`, which runs every frozen
   version against today's gateway and one that also serves a newer, test-only revision.
8. **Record it.** Schemas (`pnpm --filter @mostra/protocol gen:schemas`), API reports, changesets
   for every published package you changed, and INTERFACES §4 or §5.

**Done when** `pnpm check --affected` passes, including `browser-revisions.test.ts`, whose first
check fails while a served revision has no frozen fixture.
