/**
 * `pack/add` (INTERFACES §14, D172 item 10): shadcn registry items, and npm packages beside them,
 * into an artifact, in its source path's queue as its publishes and `deps/add` run.
 */
import { isAbsolute, resolve } from "node:path";
import { type PackAddParams, packAddMethod, type SourceRef } from "@mostra/protocol";
import { parsePackAddress } from "@mostra/protocol/plugin";
import { requestKey } from "../ledger/index.ts";
import { handler, type MethodHandler } from "../protocol-server/index.ts";
import type { Publisher } from "../publish/index.ts";
import type { Packs } from "./packs.ts";

/** The handler of `pack/add`. */
export function packMethods(options: {
  readonly packs: () => Packs;
  readonly publisher: () => Publisher;
  /** An artifact's dependencies changed (a dev session reloads, D140 item 12). */
  readonly dependenciesChanged?: (artifact: SourceRef) => void;
}): MethodHandler[] {
  return [
    handler(packAddMethod, async (params: PackAddParams) => {
      const result = await options.publisher().withArtifact(params.artifact, ({ target, source }) =>
        options.packs().add({
          target,
          root: source.root,
          kind: source.kind,
          entry: source.entry,
          // A relative item file is the caller's to resolve; one that arrives relative is read
          // from the artifact's directory.
          specs: params.specs.map((spec) => {
            const address = parsePackAddress(spec);
            return address?.kind === "file" && !isAbsolute(address.path)
              ? resolve(source.root, address.path)
              : spec;
          }),
          overwrite: params.overwrite === true,
          accept: params.acceptLicenses ?? [],
          request: requestKey("pack/add", params),
          cwd: source.root,
        }),
      );
      options.dependenciesChanged?.(params.artifact);
      return result;
    }),
  ];
}
