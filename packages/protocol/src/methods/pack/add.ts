import * as z from "zod";
import { SourceRef } from "../../artifact.ts";
import { Diagnostic } from "../../diagnostics/diagnostic.ts";
import { defineMethod, type MethodDefinition } from "../../method.ts";
import { LicenseDisclosure } from "../../plugins.ts";
import { wireRegistry } from "../../wire-registry.ts";
import { AddedPackage } from "../deps/add.ts";

/** The params of `pack/add` (INTERFACES §14). */
export interface PackAddParams {
  /** The artifact the items' files are copied into. */
  readonly artifact: SourceRef;
  /**
   * What to add, in shadcn's address forms: an item's URL, a local `.json` item, a GitHub item
   * (`owner/repo/item[#ref]`), or `@namespace/item` from the artifact's `components.json`
   * `registries`. Anything else is an npm spec, added as `deps/add` adds it.
   */
  readonly specs: readonly string[];
  /** Replace files the artifact already has with other content (shadcn's `--overwrite`). */
  readonly overwrite?: boolean;
  /** Licenses acknowledged for the npm packages the items bring (D31). */
  readonly acceptLicenses?: readonly string[];
  /** Makes retries idempotent: a repeated `requestId` returns the recorded result (H-03). */
  readonly requestId?: string;
}

/** One item `pack/add` installed. */
export interface PackItemSummary {
  /** The item's `name`. */
  readonly name: string;
  /** Its `type` (`registry:ui` …). */
  readonly type: string;
  /** The address it was asked for by, or a dependency's. */
  readonly address: string;
  /** Where it was read: a URL, or a file. */
  readonly source: string;
  /** The item that needed it, for a registry dependency. */
  readonly requiredBy?: string;
  /** The field IDs its components introduce, from its `mostra` block. */
  readonly fields?: readonly string[];
}

/** One file `pack/add` wrote. */
export interface PackFileChange {
  /** Its path in the artifact, `/`-separated. */
  readonly path: string;
  /** `created`, `overwritten` (with `overwrite`), `unchanged` (it already held this content), or `updated` (a stylesheet the items' CSS joined). */
  readonly action: "created" | "overwritten" | "unchanged" | "updated";
}

/** The result of `pack/add`. */
export interface PackAddResult {
  /** The items installed, registry dependencies included, in install order. */
  readonly items: readonly PackItemSummary[];
  /** Every file written. */
  readonly files: readonly PackFileChange[];
  /** The npm packages added, the items' and the plain specs', as `deps/add` answers them. */
  readonly packages: readonly AddedPackage[];
  /** The licenses of those packages, with their classes (D31). */
  readonly licenses: readonly LicenseDisclosure[];
  /** The lockfile's digest after the change, when packages were added. */
  readonly lockDigest?: string;
  /**
   * What the items asked for that Mostra applied otherwise or not at all (environment variables,
   * Tailwind 3 configuration, a stylesheet the entry doesn't import), as warnings and hints.
   */
  readonly notes: readonly Diagnostic[];
}

const PackItemSummary: z.ZodType<PackItemSummary> = z
  .object({
    name: z.string(),
    type: z.string(),
    address: z.string(),
    source: z.string(),
    requiredBy: z.string().exactOptional(),
    fields: z.array(z.string()).readonly().exactOptional(),
  })
  .register(wireRegistry, { id: "PackItemSummary" });

const PackFileChange: z.ZodType<PackFileChange> = z
  .object({
    path: z.string().min(1),
    action: z.enum(["created", "overwritten", "unchanged", "updated"]),
  })
  .register(wireRegistry, { id: "PackFileChange" });

const params: z.ZodType<PackAddParams> = z
  .object({
    artifact: SourceRef,
    specs: z.array(z.string().min(1)).min(1).readonly(),
    overwrite: z.boolean().exactOptional(),
    acceptLicenses: z.array(z.string().min(1).max(256)).readonly().exactOptional(),
    requestId: z.string().min(1).exactOptional(),
  })
  .register(wireRegistry, { id: "PackAddParams" });

const result: z.ZodType<PackAddResult> = z
  .object({
    items: z.array(PackItemSummary).readonly(),
    files: z.array(PackFileChange).readonly(),
    packages: z.array(AddedPackage).readonly(),
    licenses: z.array(LicenseDisclosure).readonly(),
    lockDigest: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .exactOptional(),
    notes: z.array(Diagnostic).readonly(),
  })
  .register(wireRegistry, { id: "PackAddResult" });

/**
 * `pack/add`: copies source-pack items (shadcn registry items, with or without a `mostra` block,
 * EX-03) into an artifact's source, with their registry dependencies, merges their CSS into its
 * stylesheet, and adds their npm dependencies, and any plain npm specs, as `deps/add` does. Every
 * file is checked before any is written, and none is replaced without `overwrite`. The method
 * behind `mostra add`.
 */
export const packAddMethod: MethodDefinition<PackAddParams, PackAddResult> = defineMethod({
  method: "pack/add",
  direction: "client-to-instance",
  mutating: true,
  params,
  result,
});
