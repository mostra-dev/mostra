/**
 * The wire-schema bundles this package publishes as JSON Schema (`schemas/`). Read by
 * `mostra-tools schemas` (`pnpm --filter @mostra/protocol gen:schemas`, and the `api` job's
 * compatibility check, HO-07).
 */
import * as z from "zod";
import { HOST_PROTOCOL_REVISIONS } from "../src/index.ts";
import { wireRegistry } from "../src/wire-registry.ts";

const [hostRevision] = HOST_PROTOCOL_REVISIONS;
if (hostRevision === undefined) throw new Error("HOST_PROTOCOL_REVISIONS is empty");

/** The bundles, one per published file pair. */
export const bundles = [
  {
    name: "protocol",
    title: "Mostra protocol types: IDs, revisions and diagnostics",
    revisions: { "host-protocol": hostRevision },
    definitions: (target: "draft-2020-12" | "draft-07", uri: (id: string) => string) =>
      z.toJSONSchema(wireRegistry, { target, io: "input", uri, metadata: wireRegistry })
        .schemas as Record<string, Record<string, unknown>>,
  },
];
