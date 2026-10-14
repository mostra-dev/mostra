import * as z from "zod";
import { SourceRef } from "../../artifact.ts";
import { defineMethod, type MethodDefinition } from "../../method.ts";
import { wireRegistry } from "../../wire-registry.ts";

/** The params of `deps/add` (INTERFACES §6, D95). */
export interface DepsAddParams {
  /** The artifact whose lockfile gains the packages: a source path, or an artifact ID. */
  readonly artifact: SourceRef;
  /**
   * npm package specs: `name`, `name@version`, `name@range` or `name@tag`, scoped names included.
   * A spec without an exact version takes the newest release at least a day old (D95).
   */
  readonly packages: readonly string[];
  /** Makes retries idempotent: a repeated `requestId` returns the recorded result (H-03). */
  readonly requestId?: string;
}

/** One package `deps/add` settled. */
export interface AddedPackage {
  /** The package's name. */
  readonly name: string;
  /** The exact version the artifact's lockfile now holds. */
  readonly version: string;
  /** Whether it comes from the warm set, which every artifact resolves without an install. */
  readonly warm: boolean;
}

/** The result of `deps/add`. */
export interface DepsAddResult {
  /** Each requested package, in request order, with the version it resolved to. */
  readonly packages: readonly AddedPackage[];
  /** The SHA-256 of the artifact's lockfile after the change: the `lockDigest` its next publish uses. */
  readonly lockDigest: string;
}

/** The Zod schema of the `AddedPackage` type. */
export const AddedPackage: z.ZodType<AddedPackage> = z
  .object({ name: z.string().min(1), version: z.string().min(1), warm: z.boolean() })
  .register(wireRegistry, {
    id: "AddedPackage",
    description: "A package deps/add settled: its name, exact version and whether it is warm.",
  });

const params: z.ZodType<DepsAddParams> = z
  .object({
    artifact: SourceRef,
    packages: z.array(z.string().min(1)).min(1).readonly(),
    requestId: z.string().min(1).exactOptional(),
  })
  .register(wireRegistry, { id: "DepsAddParams" });

const result: z.ZodType<DepsAddResult> = z
  .object({
    packages: z.array(AddedPackage).readonly(),
    lockDigest: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .register(wireRegistry, { id: "DepsAddResult" });

/**
 * `deps/add`: installs npm packages into the home's shared store and records them, at exact
 * versions, in the artifact's lockfile, so its next publish builds with them, offline too. The
 * method behind `mostra add` (D43, D95), and the only way packages enter a lockfile under the
 * `explicit` dependency policy.
 */
export const depsAddMethod: MethodDefinition<DepsAddParams, DepsAddResult> = defineMethod({
  method: "deps/add",
  direction: "client-to-instance",
  mutating: true,
  params,
  result,
});
