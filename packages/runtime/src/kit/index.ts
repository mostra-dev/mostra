/**
 * The kit's side of the runtime (D178, KT-03, KT-04): an artifact's theme stack resolved into
 * what its build includes, and where the kit's per-base registry is. The runtime never imports
 * the kit (it is the artifact's package, REPO_STANDARDS §3): it reads the kit's files from the
 * build's layout, and makes the theme's stylesheet from `@mostra/themes`.
 *
 * ```ts
 * const theme = resolveThemeStack({ manifest, sourceDir });
 * // theme.css goes inside the build's Tailwind run, then theme.files, in order.
 * ```
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  type ArtifactManifest,
  createDiagnostic,
  type Diagnostic,
  RpcError,
  themeStackEntry,
  themeStackOf,
  themeStackProblem,
} from "@mostra/protocol";
import {
  ARTIFACT_THEMES,
  composeThemes,
  defineTheme,
  kitStylesheet,
  layerThemes,
  type Theme,
  ThemeError,
  type ThemeLayer,
} from "@mostra/themes";
import type { KitBuild } from "../builder/index.ts";

/** A theme a plugin installed for the artifact contributes (D178 item 4). */
export interface ContributedTheme {
  readonly theme: ThemeLayer;
  /** The package that contributes it, for messages and its faces' URLs. */
  readonly package: string;
}

/** What an artifact's build takes of its theme stack. */
export interface ThemeBuild {
  /** The stack as the manifest writes it, or the default's. */
  readonly stack: readonly string[];
  /** Whether the page named no theme and wears the default (D178 item 2). */
  readonly default: boolean;
  /** The id of the theme the stack's themes make, or `undefined` for `"none"`. */
  readonly id?: string;
  /** The theme's stylesheet, for inside the build's Tailwind run; empty for `"none"`. */
  readonly css: string;
  /** The artifact's own CSS layers, paths inside it, in the stack's order. */
  readonly files: readonly string[];
  /**
   * Where the host's look goes, when the stack has `"host"` (D178 item 5): `over` everything,
   * when it is last, or `under` the artifact's own files that follow it.
   */
  readonly host?: "over" | "under";
  /** What the build should say but not refuse: a stack below contrast (D68). */
  readonly warnings: readonly Diagnostic[];
}

const fail = (code: Parameters<typeof createDiagnostic>[0], message: string): RpcError =>
  new RpcError(createDiagnostic(code, { message }));

/** The themes an artifact may name: the built-in ones, then those its plugins contribute. */
export function availableThemes(
  contributed: readonly ContributedTheme[] = [],
): ReadonlyMap<string, { readonly theme: ThemeLayer; readonly package?: string }> {
  const themes = new Map<string, { theme: ThemeLayer; package?: string }>(
    Object.values(ARTIFACT_THEMES).map((theme) => [theme.id, { theme }]),
  );
  for (const entry of contributed) {
    const known = themes.get(entry.theme.id);
    if (known !== undefined) {
      throw fail(
        "MOSTRA_KIT_THEME_CONFLICT",
        `The theme "${entry.theme.id}" comes from ${entry.package} and from ${known.package ?? "Mostra itself (a built-in theme)"}.`,
      );
    }
    themes.set(entry.theme.id, { theme: entry.theme, package: entry.package });
  }
  return themes;
}

/**
 * Resolves a manifest's theme stack (D178 items 2 and 5) against the built-in themes, the themes
 * the artifact's plugins contribute and its own files. Throws `MOSTRA_MANIFEST_INVALID` for a
 * stack that can't be written so, `MOSTRA_KIT_THEME_UNKNOWN`, `MOSTRA_KIT_THEME_FILE_MISSING` or
 * `MOSTRA_KIT_THEME_CONFLICT`; a stack whose themes break a text pair builds, with
 * `MOSTRA_KIT_THEME_CONTRAST` among its warnings.
 */
export function resolveThemeStack(input: {
  readonly manifest: Pick<ArtifactManifest, "kit">;
  /** The artifact's snapshot, where its own layers are. */
  readonly sourceDir: string;
  readonly contributed?: readonly ContributedTheme[];
}): ThemeBuild {
  const { stack, default: isDefault } = themeStackOf(input.manifest);
  const problem = themeStackProblem(stack);
  if (problem !== undefined) {
    throw fail("MOSTRA_MANIFEST_INVALID", `The manifest's kit.theme can't be built: ${problem}.`);
  }
  if (stack.length === 1 && stack[0] === "none") {
    return { stack, default: false, css: "", files: [], warnings: [] };
  }
  const themes = availableThemes(input.contributed);
  const layers: { theme: ThemeLayer; package?: string }[] = [];
  const files: string[] = [];
  let host: "over" | "under" | undefined;
  for (const text of stack) {
    const entry = themeStackEntry(text);
    if (entry?.kind === "theme") {
      const found = themes.get(entry.id);
      if (found === undefined) {
        throw fail(
          "MOSTRA_KIT_THEME_UNKNOWN",
          `No theme "${entry.id}" is built in or installed for this artifact; the themes on offer are ${[...themes.keys()].map((id) => `"${id}"`).join(", ")}.`,
        );
      }
      layers.push(found);
    } else if (entry?.kind === "file") {
      const path = join(input.sourceDir, entry.path);
      if (!existsSync(path) || !statSync(path).isFile()) {
        throw fail(
          "MOSTRA_KIT_THEME_FILE_MISSING",
          `The theme stack names ./${entry.path}, which isn't in the artifact.`,
        );
      }
      files.push(entry.path);
    } else if (entry?.kind === "host") {
      host = "under";
    }
  }
  if (host !== undefined && stack[stack.length - 1] === "host") host = "over";

  const [first, ...rest] = layers;
  if (first === undefined) throw new Error("A checked stack starts with a theme.");
  const warnings: Diagnostic[] = [];
  let theme: Theme;
  try {
    const base = defineTheme(first.theme as Theme);
    theme = composeThemes(base, ...rest.map((layer) => layer.theme));
  } catch (error) {
    if (!(error instanceof ThemeError)) throw error;
    if (layers.length === 1) {
      throw fail(
        "MOSTRA_KIT_THEME_UNKNOWN",
        `The theme "${first.theme.id}" from ${first.package ?? "Mostra"} isn't a complete theme a stack can start with: ${error.problems.join("; ")}.`,
      );
    }
    warnings.push(
      createDiagnostic("MOSTRA_KIT_THEME_CONTRAST", {
        message: `The theme stack ${stack.join(", ")} makes a theme below WCAG 2.2 AA: ${error.problems.join("; ")}.`,
      }),
    );
    theme = layerThemes(
      first.theme as Theme,
      rest.map((layer) => layer.theme),
    );
  }
  const packageOf = new Map(layers.map((layer) => [layer.theme.id, layer.package]));
  const facesFrom = (file: string): string => {
    // A built-in theme's faces are @mostra/themes' files; a plugin's are its own package's.
    const owner = [...packageOf.values()].reverse().find((pkg) => pkg !== undefined);
    return `${owner ?? "@mostra/themes"}/${file}`;
  };
  return {
    stack,
    default: isDefault,
    id: theme.id,
    css: kitStylesheet(theme, { faceUrl: facesFrom }),
    files,
    ...(host !== undefined ? { host } : {}),
    warnings,
  };
}

/** The kit's registry for a base inside a build's `node_modules`, when the layout has the kit. */
export function kitRegistry(nodeModules: string, base: "base" | "radix"): string | undefined {
  const dir = join(nodeModules, "@mostra", "kit", "registry", base);
  return existsSync(dir) ? dir : undefined;
}

/**
 * The version of the kit in a build's layout, part of a version's identity (DATA_MODEL §2): its
 * registry is what `@/…` resolves into. `null` for a layout without the kit.
 */
export function kitVersionOf(nodeModules: string): string | null {
  try {
    const manifest = JSON.parse(
      readFileSync(join(nodeModules, "@mostra", "kit", "package.json"), "utf8"),
    ) as { version?: unknown };
    return typeof manifest.version === "string" ? manifest.version : null;
  } catch {
    return null;
  }
}

/** What a build takes of the kit and the theme stack, and the stack as resolved. */
export function kitBuildFor(input: {
  readonly manifest: Pick<ArtifactManifest, "kit">;
  readonly sourceDir: string;
  readonly nodeModules: string;
  readonly contributed?: readonly ContributedTheme[];
}): { readonly kit: KitBuild; readonly theme: ThemeBuild } {
  const theme = resolveThemeStack(input);
  const registry = kitRegistry(input.nodeModules, input.manifest.kit?.base ?? "base");
  return {
    kit: {
      ...(registry !== undefined ? { registry } : {}),
      themeCss: theme.css,
      themeFiles: theme.files,
      ...(theme.id !== undefined ? { themeId: theme.id } : {}),
      ...(theme.host !== undefined ? { host: theme.host } : {}),
    },
    theme,
  };
}
