/**
 * The builder's types, shared by the supervisor side (`index.ts`) and the builder child
 * (`child/`). Nothing here imports the bundler, so the supervisor can use them.
 */
import type { ArtifactManifest, Diagnostic } from "@mostra/protocol";

/** One `"use server"` export (D54, D55): what the client stub calls and the worker runs. */
export interface ServerFunctionEntry {
  /** `<module>#<export>`, for example `actions.ts#sendReply`. */
  readonly id: string;
  /** The module's path inside the artifact. */
  readonly module: string;
  /** The export's name (`default` for a default export). */
  readonly export: string;
  /** Whether the function references `dryRun()` from `@mostra/server`, opting into `verify`'s smoke test (D55). */
  readonly dryRun: boolean;
}

/** One route of a `pages/` artifact (D57). */
export interface PageRoute {
  /** The React Router path: `/`, `/settings`, `/reports/:id`. */
  readonly path: string;
  /** The page's file inside the artifact. */
  readonly file: string;
}

/**
 * What a version contains, read by `verify`, the shell, the worker and `results` (INTERFACES §11).
 * Written as `registry.json` in the version directory. Later packages add keys (fields, WP-07).
 */
export interface VersionRegistry {
  readonly schemaVersion: 1;
  /** The entry, inside the artifact. */
  readonly entry: string;
  /** Every `"use server"` export. */
  readonly actions: readonly ServerFunctionEntry[];
  /** The live sources `live.ts` exports (D56). */
  readonly liveSources: readonly { readonly key: string }[];
  /** The routes of `pages/`, empty for a single-page artifact. */
  readonly pages: readonly PageRoute[];
  /** The terminal sessions the manifest declares, by name. */
  readonly terminals: readonly string[];
  /** The web demos the manifest declares, by name. */
  readonly demos: readonly string[];
}

/** What the supervisor asks the builder child to build (`builder/build`). */
export interface BuildRequest {
  /** The staging directory; the artifact's snapshot is in its `source/`. */
  readonly stagingDir: string;
  /** The entry, inside the snapshot. */
  readonly entry: string;
  /** Whether the entry has a default export: the page, or with `pages/` the layout. */
  readonly entryHasDefault: boolean;
  /** The artifact's manifest (with its title resolved). */
  readonly manifest: ArtifactManifest;
  /** The warm set's `node_modules` (D91), linked as the build's `node_modules`. */
  readonly nodeModules: string;
  /** Where the client build goes; a server build goes beside it in `server/`. */
  readonly outDir: string;
}

/** The builder child's answer. */
export type BuildResponse =
  | { readonly ok: true; readonly registry: VersionRegistry; readonly server: boolean }
  | { readonly ok: false; readonly diagnostics: readonly Diagnostic[] };

/** The IPC method the supervisor calls on the builder child. */
export const BUILD_METHOD = "builder/build";
