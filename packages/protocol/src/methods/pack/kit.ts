import * as z from "zod";
import { SourceRef } from "../../artifact.ts";
import { defineMethod, type MethodDefinition } from "../../method.ts";
import { wireRegistry } from "../../wire-registry.ts";

/** The params of `pack/kit` (INTERFACES §14, D181 item 7). */
export interface PackKitParams {
  /** The artifact whose base names the kit's items; without one, the default base (`base`). */
  readonly artifact?: SourceRef;
}

/** The result of `pack/kit`. */
export interface PackKitResult {
  /** The shadcn base the items are for: the artifact's `kit.base`, else `base` (D72). */
  readonly base: "base" | "radix";
  /**
   * The kit's items for that base, by name: what `mostra add <name>` copies into the artifact
   * (`button`, `dialog`, `mostra-questionnaire`). A bare name that isn't one is an npm package.
   */
  readonly items: readonly string[];
}

const params: z.ZodType<PackKitParams> = z
  .object({ artifact: SourceRef.exactOptional() })
  .register(wireRegistry, { id: "PackKitParams" });

const result: z.ZodType<PackKitResult> = z
  .object({
    base: z.enum(["base", "radix"]),
    items: z.array(z.string()).readonly(),
  })
  .register(wireRegistry, { id: "PackKitResult" });

/**
 * `pack/kit`: the kit's items an artifact's base offers, so a client tells `mostra add button`
 * (the kit's button, through `pack/add`) from `mostra add zod` (an npm package, through
 * `deps/add`) before it sends either (WP-18, after the Opus review).
 */
export const packKitMethod: MethodDefinition<PackKitParams, PackKitResult> = defineMethod({
  method: "pack/kit",
  direction: "client-to-instance",
  mutating: false,
  params,
  result,
});
