/**
 * The builder's types, shared by the supervisor side (`index.ts`) and the builder child
 * (`child/`). Nothing here imports the bundler, so the supervisor can use them.
 */
import type { ArtifactManifest, Diagnostic } from "@mostra/protocol";
import type { FieldCoverage } from "./coverage.ts";

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
  /**
   * The live sources `live.ts` exports (D56), each with `always` when its `defineLive` literal
   * says it (WP-08); absent when the builder couldn't tell, and the worker reports it.
   */
  readonly liveSources: readonly { readonly key: string; readonly always?: boolean }[];
  /** The routes of `pages/`, empty for a single-page artifact. */
  readonly pages: readonly PageRoute[];
  /** The terminal sessions the manifest declares, by name. */
  readonly terminals: readonly string[];
  /** The web demos the manifest declares, by name. */
  readonly demos: readonly string[];
  /**
   * The field IDs the version's code can use (D109). Absent in versions built before WP-07, which
   * cover every field ID.
   */
  readonly fields?: FieldCoverage;
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
  /**
   * The version being built (D89: known from the digests before the build). The page carries it
   * (`<meta name="mostra-version">`), so a frame tells its shell which version it loaded (D98
   * item 5). Same digests, same ID, so the build stays a function of its inputs.
   */
  readonly versionId: string;
  /** The `node_modules` the build links: the warm layout, or the artifact's lock layout (D95). */
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

/**
 * `mostra dev`'s child (D140 item 12): the supervisor asks the builder child for a Vite dev
 * server over a mirror of the artifact's source, reached only through the dev sandbox's gateway.
 */
export const DEV_METHOD = "builder/dev";
/**
 * Supervisor to child: these files of the mirror changed (`{ changes: DevChange[] }`). The child
 * watches nothing itself: the supervisor, which keeps the mirror, says exactly what changed.
 */
export const DEV_CHANGED_METHOD = "builder/dev.changed";

/** One file of the mirror that changed, relative to its `source/`. */
export interface DevChange {
  readonly file: string;
  readonly kind: "add" | "change" | "unlink";
}

/** Supervisor to child: tell every page to load again (a new server bundle runs now). */
export const DEV_RELOAD_METHOD = "builder/dev.reload";
/** Child to supervisor: the server bundle was built again (or failed to build). */
export const DEV_SERVER_NOTIFICATION = "builder/dev.server";
/** Child to supervisor: the client modules of these files were updated in place (HMR). */
export const DEV_UPDATE_NOTIFICATION = "builder/dev.update";

/** What the dev child serves. */
export interface DevRequest {
  /** The dev root: generated files, `node_modules`, and the mirror of the source in `source/`. */
  readonly root: string;
  readonly entry: string;
  readonly entryHasDefault: boolean;
  readonly manifest: ArtifactManifest;
  /** The dev version's ID, in every page's `mostra-version` meta (D115). */
  readonly versionId: string;
  readonly nodeModules: string;
  /** Where the server bundle and `registry.json` go: the dev version's directory. */
  readonly outDir: string;
  /** The secret every request from the gateway carries; nothing else reaches the dev server. */
  readonly secret: string;
}

/** The header that carries {@link DevRequest.secret}. */
export const DEV_SECRET_HEADER = "x-mostra-dev-secret";

/** A server build of the dev child: what `registry.json` now holds, or why it failed. */
export type DevServerBuild =
  | { readonly ok: true; readonly registry: VersionRegistry; readonly server: boolean }
  | { readonly ok: false; readonly diagnostics: readonly Diagnostic[] };

/** The dev child's answer to {@link DEV_METHOD}: its loopback port and its first server build. */
export interface DevReady {
  readonly port: number;
  readonly build: DevServerBuild;
}

/**
 * The files written into the staging root so the bundler's upward searches stop there instead of
 * reaching directories above the home (VR-01): a `tsconfig.json` with the compile settings Mostra
 * chooses (an artifact's own `tsconfig.json`, part of its source, still applies to its files),
 * and a `package.json` that marks the build as ES modules. Their contents are part of
 * `buildConfigDigest`.
 */
export const STAGING_FILES: Readonly<Record<string, string>> = {
  "tsconfig.json": `${JSON.stringify(
    {
      compilerOptions: {
        target: "ES2022",
        useDefineForClassFields: true,
        jsx: "react-jsx",
        jsxImportSource: "react",
        experimentalDecorators: false,
      },
    },
    null,
    2,
  )}\n`,
  "package.json": `${JSON.stringify({ private: true, type: "module" }, null, 2)}\n`,
};

/**
 * The declaration that types `useLive` from `live.ts` (D56): client code reads the source types
 * through `typeof import`, never by importing server code at run time. Written beside the build's
 * other generated files for the type check, never into the artifact's source.
 */
export const LIVE_DECLARATION: string = `// Generated by Mostra: the types of this artifact's live sources (D56).
import type { LiveValuesOf } from "@mostra/react";

declare module "@mostra/react" {
  interface LiveSources extends LiveValuesOf<typeof import("../source/live")> {}
}
`;
