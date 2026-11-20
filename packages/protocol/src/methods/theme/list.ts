import * as z from "zod";
import { SourceRef } from "../../artifact.ts";
import { defineMethod, type MethodDefinition } from "../../method.ts";
import { wireRegistry } from "../../wire-registry.ts";

/** The params of `theme/list` (INTERFACES §6, D181 item 6). */
export interface ThemeListParams {
  /** An artifact whose installed plugins' themes to list too, and whose stack to name. */
  readonly artifact?: SourceRef;
}

/** One theme an artifact may name in its `kit.theme` stack. */
export interface ThemeSummary {
  /** What a stack names it by. */
  readonly id: string;
  /** Its name, as a person reads it. */
  readonly name: string;
  /** One sentence: what it is for. */
  readonly description: string;
  /** Built into Mostra, or contributed by an installed plugin (`package`). */
  readonly source: "built-in" | "plugin";
  /** The plugin that contributes it. */
  readonly package?: string;
  /** A complete theme, which a stack may start with; else a layer that goes after one. */
  readonly complete: boolean;
  /** The theme a page that names none wears. */
  readonly default: boolean;
}

/** The result of `theme/list`. */
export interface ThemeListResult {
  /** The themes on offer: the built-in ones, then the artifact's plugins'. */
  readonly themes: readonly ThemeSummary[];
  /** With `artifact`: the stack its manifest writes, or the default's (`default`). */
  readonly artifact?: { readonly stack: readonly string[]; readonly default: boolean };
}

const params: z.ZodType<ThemeListParams> = z
  .object({ artifact: SourceRef.exactOptional() })
  .register(wireRegistry, { id: "ThemeListParams" });

/** The Zod schema of the `ThemeSummary` type. */
export const ThemeSummary: z.ZodType<ThemeSummary> = z
  .object({
    id: z.string(),
    name: z.string(),
    description: z.string(),
    source: z.enum(["built-in", "plugin"]),
    package: z.string().exactOptional(),
    complete: z.boolean(),
    default: z.boolean(),
  })
  .register(wireRegistry, { id: "ThemeSummary" });

const result: z.ZodType<ThemeListResult> = z
  .object({
    themes: z.array(ThemeSummary).readonly(),
    artifact: z
      .object({ stack: z.array(z.string()).readonly(), default: z.boolean() })
      .exactOptional(),
  })
  .register(wireRegistry, { id: "ThemeListResult" });

/**
 * `theme/list`: the themes an artifact may name in `kit.theme`, built in and contributed by its
 * plugins, and the stack it wears.
 */
export const themeListMethod: MethodDefinition<ThemeListParams, ThemeListResult> = defineMethod({
  method: "theme/list",
  direction: "client-to-instance",
  mutating: false,
  params,
  result,
});
