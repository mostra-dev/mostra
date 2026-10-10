import * as z from "zod";

/** Metadata for a wire schema that has a stable name in the published JSON Schema. */
export interface WireSchemaMeta {
  /** The definition name in the published JSON Schema (`$defs`). Stable once released. */
  readonly id: string;
  readonly description?: string;
}

/**
 * The registry of named wire schemas. It is private to this package (not Zod's global registry), so
 * two copies of the package in one process never collide.
 */
export const wireRegistry: z.core.$ZodRegistry<WireSchemaMeta> = z.registry<WireSchemaMeta>();
