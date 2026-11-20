import * as z from "zod";
import { SourceRef } from "../../artifact.ts";
import { Diagnostic } from "../../diagnostics/diagnostic.ts";
import { defineMethod, type MethodDefinition } from "../../method.ts";
import { wireRegistry } from "../../wire-registry.ts";

/** The params of `theme/show` (INTERFACES §6, D179 item 6). */
export interface ThemeShowParams {
  /**
   * A theme, or a stack of them, to show; with `artifact`, it is resolved for that artifact (its
   * plugins' themes and its own `./file.css` layers). Absent: the artifact's own stack.
   */
  readonly theme?: string | readonly string[];
  /** The artifact whose stack to show, or for which to resolve `theme`. */
  readonly artifact?: SourceRef;
  /** Include the stylesheet the build takes (the tokens, utilities and base rules). */
  readonly css?: boolean;
}

/** The values a stack makes, by token: what a layer after it may change. */
export interface ThemeShowValues {
  /** Tokens the same in both modes: faces, radius, shape, depth, motion. */
  readonly base: Readonly<Record<string, string>>;
  /** Light mode's colours and tokens. */
  readonly light: Readonly<Record<string, string>>;
  /** Dark mode's colours and tokens. */
  readonly dark: Readonly<Record<string, string>>;
}

/** The result of `theme/show`. */
export interface ThemeShowResult {
  /** The stack shown, in order. */
  readonly stack: readonly string[];
  /** The stack is the default a page that names none wears. */
  readonly default: boolean;
  /** The theme the stack's themes make, named by its last theme; absent for `"none"`. */
  readonly id?: string;
  /** Its name. */
  readonly name?: string;
  /** The faces' families: interface text, headings, code. */
  readonly faces?: { readonly sans: string; readonly display: string; readonly mono: string };
  /** Every custom property the stack's themes set, by mode, before the artifact's own files. */
  readonly values?: ThemeShowValues;
  /** The artifact's own CSS layers in the stack, in order. */
  readonly files: readonly string[];
  /** Where the host's look goes, when the stack names `"host"`. */
  readonly host?: "over" | "under";
  /** The stylesheet the build takes, with `css`. */
  readonly css?: string;
  /** What the stack builds with but should change: a text pair below WCAG 2.2 AA. */
  readonly warnings: readonly Diagnostic[];
}

const stack = z.union([
  z.string().min(1).max(200),
  z.array(z.string().min(1).max(200)).min(1).max(8).readonly(),
]);

const params: z.ZodType<ThemeShowParams> = z
  .object({
    theme: stack.exactOptional(),
    artifact: SourceRef.exactOptional(),
    css: z.boolean().exactOptional(),
  })
  .register(wireRegistry, { id: "ThemeShowParams" });

const values = z.record(z.string(), z.string());

const result: z.ZodType<ThemeShowResult> = z
  .object({
    stack: z.array(z.string()).readonly(),
    default: z.boolean(),
    id: z.string().exactOptional(),
    name: z.string().exactOptional(),
    faces: z.object({ sans: z.string(), display: z.string(), mono: z.string() }).exactOptional(),
    values: z.object({ base: values, light: values, dark: values }).exactOptional(),
    files: z.array(z.string()).readonly(),
    host: z.enum(["over", "under"]).exactOptional(),
    css: z.string().exactOptional(),
    warnings: z.array(Diagnostic).readonly(),
  })
  .register(wireRegistry, { id: "ThemeShowResult" });

/**
 * `theme/show`: what a theme or a stack makes: its faces, every token's value in light and dark,
 * and with `css` the stylesheet a build takes, so an agent can see a look before choosing it and
 * write a layer that changes only what it means to.
 */
export const themeShowMethod: MethodDefinition<ThemeShowParams, ThemeShowResult> = defineMethod({
  method: "theme/show",
  direction: "client-to-instance",
  mutating: false,
  params,
  result,
});
