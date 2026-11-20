/**
 * `theme/list` and `theme/show` (D179 item 6): the themes an artifact may name and what a stack
 * makes, read without building anything. The composition root hands in how an artifact's manifest,
 * source and installed plugins are found, so this module reaches no other module's internals.
 */
import {
  type ArtifactManifest,
  type SourceRef,
  themeListMethod,
  themeShowMethod,
  themeStackOf,
} from "@mostra/protocol";
import { handler, type MethodHandler } from "../protocol-server/index.ts";
import {
  type ContributedTheme,
  contributedThemes,
  resolveThemeStack,
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
}): MethodHandler[] {
  const contributedOf = (artifact: ThemeArtifact | undefined): ContributedTheme[] =>
    artifact?.plugins === undefined
      ? []
      : contributedThemes(artifact.plugins.nodeModules, artifact.plugins.names);
  return [
    handler(themeListMethod, async (params) => {
      const artifact = params.artifact ? await options.artifact(params.artifact) : undefined;
      const themes = themeSummaries(contributedOf(artifact));
      if (artifact === undefined) return { themes };
      const { stack, default: isDefault } = themeStackOf(artifact.manifest);
      return { themes, artifact: { stack, default: isDefault } };
    }),
    handler(themeShowMethod, async (params) => {
      const artifact = params.artifact ? await options.artifact(params.artifact) : undefined;
      const manifest: Pick<ArtifactManifest, "kit"> =
        params.theme !== undefined
          ? { kit: { ...artifact?.manifest.kit, theme: params.theme } }
          : (artifact?.manifest ?? {});
      const build = resolveThemeStack({
        manifest,
        // Without an artifact, a stack naming a `./file.css` has nowhere to find it: refused as
        // missing, which is what it is.
        sourceDir: artifact?.sourceDir ?? "/nonexistent",
        contributed: contributedOf(artifact),
      });
      return themeShown(build, params.css === true);
    }),
  ];
}
