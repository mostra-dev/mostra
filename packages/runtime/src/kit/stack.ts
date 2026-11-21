/**
 * The kit's side of the runtime (D181, KT-03, KT-04): an artifact's theme stack resolved into
 * what its build includes, and where the kit's per-base registry is. The runtime never imports
 * the kit (it is the artifact's package, REPO_STANDARDS §3): it reads the kit's files from the
 * build's layout, and makes the theme's stylesheet from `@mostra/themes`.
 *
 * ```ts
 * const theme = resolveThemeStack({ manifest, sourceDir });
 * // theme.css goes inside the build's Tailwind run, then theme.files, in order.
 * ```
 */
import { createHash } from "node:crypto";
import { type Dirent, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import {
  type ArtifactManifest,
  createDiagnostic,
  type Diagnostic,
  RpcError,
  type ThemeShowResult,
  type ThemeSummary,
  themeStackEntry,
  themeStackOf,
  themeStackProblem,
} from "@mostra/protocol";
import {
  ARTIFACT_THEMES,
  composeThemes,
  defineTheme,
  defineThemeLayer,
  isCompleteTheme,
  kitStylesheet,
  layerThemes,
  type Theme,
  ThemeError,
  type ThemeLayer,
  themeValues,
} from "@mostra/themes";
import type { KitBuild } from "../builder/index.ts";

/** A theme a plugin installed for the artifact contributes (D181 item 4). */
export interface ContributedTheme {
  readonly theme: ThemeLayer;
  /** The package that contributes it, for messages and its faces' URLs. */
  readonly package: string;
}

/** What an artifact's build takes of its theme stack. */
export interface ThemeBuild {
  /** The stack as the manifest writes it, or the default's. */
  readonly stack: readonly string[];
  /** Whether the page named no theme and wears the default (D181 item 2). */
  readonly default: boolean;
  /** The id of the theme the stack's themes make, or `undefined` for `"none"`. */
  readonly id?: string;
  /** The theme's stylesheet, for inside the build's Tailwind run; empty for `"none"`. */
  readonly css: string;
  /** The artifact's own CSS layers, paths inside it, in the stack's order. */
  readonly files: readonly string[];
  /**
   * Where the host's look goes, when the stack has `"host"` (D181 item 5): `over` everything,
   * when it is last, or `under` the artifact's own files that follow it.
   */
  readonly host?: "over" | "under";
  /** What the build should say but not refuse: a stack below contrast (D68). */
  readonly warnings: readonly Diagnostic[];
  /** The theme the stack's themes make, absent for `"none"`. */
  readonly theme?: Theme;
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

/** What a stack is resolved from. */
export interface StackInput {
  readonly manifest: Pick<ArtifactManifest, "kit">;
  /** The artifact's snapshot, where its own layers are. */
  readonly sourceDir: string;
  readonly contributed?: readonly ContributedTheme[];
  /** The home's stack for a page that names none (`HomeConfig.look.theme`, D181 item 5). */
  readonly homeTheme?: string | readonly string[];
  /** Another stack for one run (`verify --theme`, `theme show <theme>`, D181 item 6). */
  readonly override?: string | readonly string[];
}

/**
 * The stack a page is built in, and whether it is a default: the run's own stack when one is
 * asked for, else the manifest's, else the home's, else Studio. Publish, verify, `mostra dev` and
 * `theme/show` all choose it here, so each shows what the others build (Opus review of WP-18,
 * finding 6).
 */
export function stackChosen(input: Pick<StackInput, "manifest" | "homeTheme" | "override">): {
  readonly stack: readonly string[];
  readonly default: boolean;
} {
  const asStack = (theme: string | readonly string[]): readonly string[] =>
    typeof theme === "string" ? [theme] : theme;
  if (input.override !== undefined) return { stack: asStack(input.override), default: false };
  const named = themeStackOf(input.manifest);
  if (named.default && input.homeTheme !== undefined) {
    return { stack: asStack(input.homeTheme), default: true };
  }
  return named;
}

/** The faces a theme has, by role. */
const FACE_ROLES = ["sans", "display", "mono"] as const;

/**
 * Resolves a manifest's theme stack (D181 items 2 and 5) against the built-in themes, the themes
 * the artifact's plugins contribute and its own files. Throws `MOSTRA_MANIFEST_INVALID` for a
 * stack that can't be written so, `MOSTRA_KIT_THEME_UNKNOWN`, `MOSTRA_KIT_THEME_FILE_MISSING` or
 * `MOSTRA_KIT_THEME_CONFLICT`; a stack whose themes break a text pair builds, with
 * `MOSTRA_KIT_THEME_CONTRAST` among its warnings.
 */
export function resolveThemeStack(input: StackInput): ThemeBuild {
  const { stack, default: isDefault } = stackChosen(input);
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
  if (!isCompleteTheme(first.theme)) {
    throw fail(
      "MOSTRA_KIT_THEME_UNKNOWN",
      `The theme "${first.theme.id}" from ${first.package ?? "Mostra"} is a layer, not a complete theme, so it can't start a stack: name a complete theme first (${[
        ...themes.values(),
      ]
        .filter((entry) => isCompleteTheme(entry.theme))
        .map((entry) => `"${entry.theme.id}"`)
        .join(", ")}), then "${first.theme.id}".`,
    );
  }
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
  // Each face's files come from the package of the layer that last set that face: a built-in
  // theme's from @mostra/themes, a plugin's from its own (Opus review of WP-18, finding 5).
  const faceOwner = new Map<string, string>();
  for (const layer of layers) {
    for (const role of FACE_ROLES) {
      if (layer.theme.faces?.[role] !== undefined) {
        faceOwner.set(role, layer.package ?? "@mostra/themes");
      }
    }
  }
  const fileOwner = new Map<string, string>();
  for (const role of FACE_ROLES) {
    for (const file of theme.faces[role].files) {
      fileOwner.set(file.file, faceOwner.get(role) ?? "@mostra/themes");
    }
  }
  const facesFrom = (file: string): string =>
    [fileOwner.get(file) ?? "@mostra/themes", file].join("/");
  return {
    stack,
    default: isDefault,
    id: theme.id,
    css: kitStylesheet(theme, { faceUrl: facesFrom }),
    files,
    ...(host !== undefined ? { host } : {}),
    warnings,
    theme,
  };
}

/**
 * The themes the plugins in an artifact's lockfile contribute (D181 item 4): each `contributes.themes`
 * file of each plugin's package in the build's layout, read as JSON and checked as a theme layer
 * (`defineThemeLayer`). The plugin gate checked the manifests before; a theme file that isn't one
 * is `MOSTRA_KIT_THEME_UNKNOWN`, naming the plugin and the file.
 */
export function contributedThemes(
  nodeModules: string,
  plugins: readonly string[],
): ContributedTheme[] {
  const found: ContributedTheme[] = [];
  for (const name of plugins) {
    const dir = join(nodeModules, name);
    let manifest: { contributes?: { themes?: { theme?: unknown }[] } } | undefined;
    try {
      manifest = (
        JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as { mostra?: typeof manifest }
      ).mostra;
    } catch {
      continue;
    }
    for (const entry of manifest?.contributes?.themes ?? []) {
      if (typeof entry.theme !== "string") continue;
      const file = resolve(dir, entry.theme);
      const inside = relative(dir, file);
      if (inside.startsWith("..")) continue;
      let theme: ThemeLayer;
      try {
        theme = defineThemeLayer(JSON.parse(readFileSync(file, "utf8")) as ThemeLayer);
      } catch (error) {
        const problem =
          error instanceof ThemeError ? error.problems.join("; ") : (error as Error).message;
        throw fail(
          "MOSTRA_KIT_THEME_UNKNOWN",
          `The plugin ${name}'s theme ${entry.theme} can't be used: ${problem}.`,
        );
      }
      found.push({ theme, package: name });
    }
  }
  return found;
}

/** What `theme/list` says of one theme. */
export function themeSummaries(contributed: readonly ContributedTheme[] = []): ThemeSummary[] {
  const defaultId = themeStackOf({}).stack[0];
  return [...availableThemes(contributed)].map(([id, entry]) => ({
    id,
    name: entry.theme.name,
    description: entry.theme.description,
    source: entry.package === undefined ? ("built-in" as const) : ("plugin" as const),
    ...(entry.package !== undefined ? { package: entry.package } : {}),
    complete: isCompleteTheme(entry.theme),
    default: id === defaultId,
  }));
}

/** What `theme/show` says of a resolved stack. */
export function themeShown(build: ThemeBuild, css: boolean): ThemeShowResult {
  const theme = build.theme;
  return {
    stack: build.stack,
    default: build.default,
    ...(theme !== undefined
      ? {
          id: theme.id,
          name: theme.name,
          faces: {
            sans: theme.faces.sans.family,
            display: theme.faces.display.family,
            mono: theme.faces.mono.family,
          },
          values: themeValues(theme),
        }
      : {}),
    files: build.files,
    ...(build.host !== undefined ? { host: build.host } : {}),
    ...(css ? { css: build.css } : {}),
    warnings: build.warnings,
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
  const root = join(nodeModules, "@mostra", "kit");
  let version: unknown;
  try {
    version = (
      JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version?: unknown }
    ).version;
  } catch {
    return null;
  }
  if (typeof version !== "string") return null;
  // The release, and a digest of what a build reads of it (its registry and CSS), so a kit whose
  // files differ under the same release (a development build, a patched install) is another
  // environment, never a reused verdict (VR-01).
  const hash = createHash("sha256");
  const walk = (dir: string, prefix: string): void => {
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      const path = `${prefix}${entry.name}`;
      if (entry.isDirectory()) walk(join(dir, entry.name), `${path}/`);
      else if (entry.isFile()) {
        hash
          .update(`${path}\0`)
          .update(readFileSync(join(dir, entry.name)))
          .update("\0");
      }
    }
  };
  walk(join(root, "registry"), "registry/");
  walk(join(root, "css"), "css/");
  return `${version}+${hash.digest("hex").slice(0, 16)}`;
}

/** What a build takes of the kit and the theme stack, and the stack as resolved. */
export function kitBuildFor(input: StackInput & { readonly nodeModules: string }): {
  readonly kit: KitBuild;
  readonly theme: ThemeBuild;
} {
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
