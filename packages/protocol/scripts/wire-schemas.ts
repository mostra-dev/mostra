/**
 * The wire-schema bundles this package publishes as JSON Schema (`schemas/`). Read by
 * `mostra-tools schemas` (`pnpm --filter @mostra/protocol gen:schemas`, and the `api` job's
 * compatibility check, HO-07).
 */
import * as z from "zod";
import { HOST_PROTOCOL_REVISIONS } from "../src/index.ts";
import { wireRegistry } from "../src/wire-registry.ts";

const [hostRevision] = HOST_PROTOCOL_REVISIONS;

/**
 * Fails on any schema whose Zod checks JSON Schema can't express (`refine`, `superRefine`,
 * `check`): the published schema would accept values the TypeScript side rejects, and the
 * compatibility gate couldn't see a narrowing hidden in a refinement (HO-07).
 */
function rejectUnrepresentable(context: { zodSchema: unknown; path: (string | number)[] }): void {
  const def = (
    context.zodSchema as { _zod?: { def?: { checks?: { _zod?: { def?: { check?: string } } }[] } } }
  )._zod?.def;
  if ((def?.checks ?? []).some((check) => check._zod?.def?.check === "custom")) {
    throw new Error(
      `A wire schema at ${context.path.join(".") || "(root)"} uses a custom refinement, which JSON Schema can't express. Use a representable check (regex, z.iso.*, min, max) instead.`,
    );
  }
}
if (hostRevision === undefined) throw new Error("HOST_PROTOCOL_REVISIONS is empty");

/** The bundles, one per published file pair. */
export const bundles = [
  {
    name: "protocol",
    title: "Mostra protocol types: IDs, revisions and diagnostics",
    revisions: { "host-protocol": hostRevision },
    definitions: (target: "draft-2020-12" | "draft-07", uri: (id: string) => string) =>
      z.toJSONSchema(wireRegistry, {
        target,
        io: "input",
        uri,
        metadata: wireRegistry,
        override: rejectUnrepresentable,
      }).schemas as Record<string, Record<string, unknown>>,
  },
];
