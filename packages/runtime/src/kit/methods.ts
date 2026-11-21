/**
 * `theme/list` and `theme/show` (D181 item 6): the themes an artifact may name and what a stack
 * makes, read without building anything. The composition root hands in how an artifact's manifest,
 * source and installed plugins are found, so this module reaches no other module's internals.
 */
import {
  type ArtifactManifest,
  type SourceRef,
  themeListMethod,
  themeShowMethod,
} from "@mostra/protocol";
import { handler, type MethodHandler } from "../protocol-server/index.ts";
import {
  type ContributedTheme,
  contributedThemes,
  resolveThemeStack,
  stackChosen,
  themeShown,
  themeSummaries,
} from "./stack.ts";

/** An artifact as the theme methods read it. */
export interface ThemeArtifact {
  readonly manifest: ArtifactManifest;
  /** Its source directory, where its own `./file.css` layers are. */
  readonly sourceDir: string;
  /** Its working lockfile's plugins and the layout they are installed in, when it has one. */
  readonly plugins?: { readonly names: readonly string[]; readonly nodeModules: string };
}

/** The handlers of `theme/list` and `theme/show`. */
export function themeMethods(options: {
  /** Reads an artifact's manifest, source and plugins, installing nothing. */
  readonly artifact: (ref: SourceRef) => Promise<ThemeArtifact>;
  /** The home's stack for a page that names none, as publish builds it (D181 item 5). */
  readonly homeTheme?: () => string | readonly string[] | undefined;
}): MethodHandler[] {
  const homeTheme = (): { homeTheme?: string | readonly string[] } => {
    const theme = options.homeTheme?.();
    return theme !== undefined ? { homeTheme: theme } : {};
  };
  const contributedOf = (artifact: ThemeArtifact | undefined): ContributedTheme[] =>
    artifact?.plugins === undefined
      ? []
      : contributedThemes(artifact.plugins.nodeModules, artifact.plugins.names);
  return [
    handler(themeListMethod, async (params) => {
      const artifact = params.artifact ? await options.artifact(params.artifact) : undefined;
      const themes = themeSummaries(contributedOf(artifact));
      if (artifact === undefined) return { themes };
      const { stack, default: isDefault } = stackChosen({
        manifest: artifact.manifest,
        ...homeTheme(),
      });
      return { themes, artifact: { stack, default: isDefault } };
    }),
    handler(themeShowMethod, async (params) => {
      const artifact = params.artifact ? await options.artifact(params.artifact) : undefined;
      const manifest: Pick<ArtifactManifest, "kit"> = artifact?.manifest ?? {};
      const build = resolveThemeStack({
        manifest,
        ...homeTheme(),
        ...(params.theme !== undefined ? { override: params.theme } : {}),
        // Without an artifact, a stack naming a `./file.css` has nowhere to find it: refused as
        // missing, which is what it is.
        sourceDir: artifact?.sourceDir ?? "/nonexistent",
        contributed: contributedOf(artifact),
      });
      return themeShown(build, params.css === true);
    }),
  ];
}
