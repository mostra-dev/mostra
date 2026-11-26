/**
 * The artifact manifest (INTERFACES §2.2, D51): the metadata an artifact declares in its entry, as
 * `export const artifact = defineArtifact({...})` in TSX or as YAML frontmatter in MDX. Mostra reads
 * it statically, so every value is a literal. The same type checks `defineArtifact` for authors,
 * validates the extracted literal in the supervisor and travels on the wire in `artifact/get`.
 *
 * ```ts
 * const checked = ArtifactManifest.safeParse(extracted);
 * ```
 */
import * as z from "zod";
import { Duration, durationMs } from "./duration.ts";
import { SubmissionPolicy } from "./policy.ts";

export { SubmissionPolicy };

import { ArtifactId } from "./ids.ts";
import { TeamSettings } from "./team-settings.ts";
import { wireRegistry } from "./wire-registry.ts";

/** The families Mostra's templates and gallery know; any other string is allowed too. */
export type ArtifactFamily =
  | "questionnaire"
  | "proposal"
  | "prototype"
  | "review"
  | "dashboard"
  | "deck"
  | "demo"
  | "inbox"
  | "tasks"
  | (string & {});

/** A related artifact (PRODUCT J6): a later round, a follow-up, a replacement. */
export interface ArtifactLink {
  /** How this artifact relates to the other one. */
  readonly rel: "round-of" | "follows" | "replaces" | (string & {});
  /** The other artifact's ID. */
  readonly artifact: string;
}

/** A live terminal session the artifact declares (ROUND-3 §5.1, D65). */
export interface TerminalSpec {
  /** The program and its arguments. */
  readonly command: readonly string[];
  /** Its working directory, relative to the artifact's source. */
  readonly cwd?: string;
  /** Extra environment variables. */
  readonly env?: Readonly<Record<string, string>>;
  /** The terminal's width in cells. */
  readonly cols?: number;
  /** The terminal's height in cells. */
  readonly rows?: number;
  /** Whether viewers may type into it. Sessions are read-only by default. */
  readonly input?: boolean;
}

/**
 * A web demo the artifact declares (TM-08, D185): a front end Mostra builds from its source into
 * the version and serves under `/_mostra/demos/<name>/` ({@link DemoBuildSpec}). The dev-server
 * forms (a command to run, a port to attach to, ROUND-3 §5.4) stay readable, and `verify` refuses
 * them with `MOSTRA_DEMO_UNSUPPORTED` (D185 item 3).
 */
export type DemoSpec =
  | DemoBuildSpec
  | {
      readonly command: readonly string[];
      readonly cwd?: string;
      readonly ready?: string;
      readonly bridge?: boolean;
    }
  | { readonly attach: number; readonly bridge?: boolean };

/** A demo built from its source (D185 item 3). */
export interface DemoBuildSpec {
  /** The demo's project folder, relative to the artifact's directory. */
  readonly source: string;
  /** The command that builds it, run in `source`: `["pnpm", "build"]`. */
  readonly build: readonly string[];
  /** The folder the build writes, relative to `source`, holding its `index.html`. */
  readonly output: string;
  /** Settings for the build, never secrets: a demo holds none. */
  readonly env?: Readonly<Record<string, string>>;
  /** How the demo moves between its pages: `history` (the default) or `hash`. */
  readonly routing?: "history" | "hash";
  /** Whether its documents get the review agent, so comments anchor inside it. Default `true`. */
  readonly bridge?: boolean;
  /** The build's time limit: `10m` by default, at most `60m`. */
  readonly timeout?: Duration;
}

/** Whether a demo is declared as a build (D185), not as a dev server. */
export function isDemoBuild(spec: DemoSpec): spec is DemoBuildSpec {
  return "build" in spec && "source" in spec && "output" in spec;
}

/** The path a demo is served under, and its build's `MOSTRA_DEMO_BASE`: `/_mostra/demos/<name>/`. */
export function demoBase(name: string): string {
  return `/_mostra/demos/${name}/`;
}

/** A demo build's time limit when its spec names none (D185 item 3): 10 minutes. */
export const DEMO_TIMEOUT_DEFAULT_MS: number = 10 * 60_000;
/** The longest time limit a demo's spec may name (D185 item 3): 60 minutes. */
export const DEMO_TIMEOUT_MAX_MS: number = 60 * 60_000;

/** A demo's name: 1 to 64 lower-case letters, digits and `-`, starting with a letter or digit. */
export const DEMO_NAME: RegExp = /^[a-z0-9][a-z0-9-]{0,63}$/;

/**
 * A count by choice the artifact opts into (D165 item 12, RM-07): every accepted submission adds
 * one to the choice its viewer-scoped `field` holds, counted in the submit transaction, and viewers
 * read the counts with `useLive("$tally/<field>")`. A value outside `choices`, or none, counts
 * nothing, so free text is never shown.
 */
export interface TallySpec {
  /** The viewer-scoped field whose value is counted. */
  readonly field: string;
  /** The values counted: 2 to 50 distinct strings. */
  readonly choices: readonly string[];
  /** Below this many answers (default 0), viewers see only the total, never the counts. */
  readonly minTotal?: number;
}

/** How the artifact behaves on a remote server (D165, INTERFACES §18). */
export interface HostedSettings {
  /**
   * Relayed action runs while the owner instance is away (D165 item 4): `queue` (the default)
   * waits up to `limit` (default `24h`, at most `7d`), `fail` ends a run at once.
   */
  readonly offline?: { readonly actions?: "queue" | "fail"; readonly limit?: Duration };
  /** Who may trigger relayed actions (D159): `signed-in` (the default) or anyone with the `link`. */
  readonly actions?: "signed-in" | "link";
  /** Who may submit (D165 item 13): anyone with the `link` (the default), or `signed-in` viewers. */
  readonly submissions?: "link" | "signed-in";
  /** Link previews (D161): `generic` (the default) or the artifact's `title`. */
  readonly preview?: "generic" | "title";
}

/** The longest offline limit a hosted artifact may set: 7 days (D165 item 4). */
export const HOSTED_OFFLINE_LIMIT_MAX_MS: number = 7 * 24 * 60 * 60 * 1000;

/** The offline limit of a hosted artifact that sets none: 24 hours (D165 item 4). */
export const HOSTED_OFFLINE_LIMIT_DEFAULT: Duration = "24h";

/** The fewest and most choices a tally counts (INTERFACES §18.4). */
export const TALLY_CHOICES_MIN = 2;
/** The most choices a tally counts. */
export const TALLY_CHOICES_MAX = 50;

/** The artifact manifest (INTERFACES §2.2). Every field except `title` is optional. */
export interface ArtifactManifest {
  /** The artifact's ID. Written by `mostra new`; without one, the artifact is bound to its source path at first publish (D51). */
  readonly id?: string;
  /** The title people see. */
  readonly title: string;
  /** One or two sentences on what the artifact is for. */
  readonly description?: string;
  /** What kind of artifact it is; templates and the gallery group by it. */
  readonly family?: ArtifactFamily;
  /** Related artifacts. */
  readonly links?: readonly ArtifactLink[];
  /** How the artifact is built and served: `spa`, the default and the only mode in v1 (D19). */
  readonly mode?: "spa";
  /** The submission policy the artifact requests; the host decides (D39, D63). */
  readonly submission?: SubmissionPolicy;
  /**
   * The kit's shadcn base (default `base`, D72) and the theme stack (D181 item 2): a theme, or an
   * ordered list whose later entries override the earlier ones; `themeStackOf` reads it.
   */
  readonly kit?: { readonly base?: "base" | "radix"; readonly theme?: string | readonly string[] };
  /** Live terminal sessions by name (D65). */
  readonly terminals?: Readonly<Record<string, TerminalSpec>>;
  /** Web demos by name (D65). */
  readonly demos?: Readonly<Record<string, DemoSpec>>;
  /** Stability limits for the artifact's worker (D62). */
  readonly limits?: {
    readonly heapMb?: number;
    readonly watchdogMs?: number;
    readonly idleMinutes?: number;
  };
  /** `verify` settings (D65). */
  readonly verify?: {
    readonly viewports?: readonly string[];
    readonly frames?: readonly string[];
    readonly extraChecks?: readonly string[];
    readonly smoke?: boolean;
  };
  /** Counts by choice of fixed-choice fields (D165 item 12). */
  readonly tally?: readonly TallySpec[];
  /** How the artifact behaves on a remote server (D165). */
  readonly hosted?: HostedSettings;
  /** Team settings: what viewers see of each other's status and presence (D168). */
  readonly team?: TeamSettings;
}

/** The keys of the artifact manifest, in INTERFACES §2.2 order. Other keys are warnings (FAILURE_MODEL §10). */
export const ARTIFACT_MANIFEST_KEYS: readonly (keyof ArtifactManifest)[] = [
  "id",
  "title",
  "description",
  "family",
  "links",
  "mode",
  "submission",
  "kit",
  "terminals",
  "demos",
  "limits",
  "verify",
  "tally",
  "hosted",
  "team",
];

const strings = z.array(z.string()).readonly();

/** The Zod schema of the `ArtifactLink` type. */
export const ArtifactLink: z.ZodType<ArtifactLink> = z
  .object({ rel: z.string().min(1), artifact: z.string().min(1) })
  .register(wireRegistry, {
    id: "ArtifactLink",
    description: "A related artifact: how this one relates (rel) and the other artifact's ID.",
  });

const TerminalSpec: z.ZodType<TerminalSpec> = z.object({
  command: z.array(z.string()).min(1).readonly(),
  cwd: z.string().exactOptional(),
  env: z.record(z.string(), z.string()).readonly().exactOptional(),
  cols: z.int().min(1).exactOptional(),
  rows: z.int().min(1).exactOptional(),
  input: z.boolean().exactOptional(),
});

const DemoSpec: z.ZodType<DemoSpec> = z.union([
  z.object({
    source: z.string().min(1),
    build: z.array(z.string().min(1)).min(1).readonly(),
    output: z.string().min(1),
    env: z.record(z.string(), z.string()).readonly().exactOptional(),
    routing: z.enum(["history", "hash"]).exactOptional(),
    bridge: z.boolean().exactOptional(),
    timeout: Duration.exactOptional(),
  }),
  z.object({
    command: z.array(z.string()).min(1).readonly(),
    cwd: z.string().exactOptional(),
    ready: z.string().exactOptional(),
    bridge: z.boolean().exactOptional(),
  }),
  z.object({ attach: z.int().min(1).max(65535), bridge: z.boolean().exactOptional() }),
]);

/** The Zod schema of the `TallySpec` type. */
export const TallySpec: z.ZodType<TallySpec> = z
  .object({
    field: z.string().min(1).max(256),
    choices: z
      .array(z.string().min(1).max(256))
      .min(TALLY_CHOICES_MIN)
      .max(TALLY_CHOICES_MAX)
      .readonly(),
    minTotal: z.int().min(0).exactOptional(),
  })
  .register(wireRegistry, {
    id: "TallySpec",
    description:
      "A count by choice of a viewer-scoped field: its field, 2 to 50 distinct choices and minTotal.",
  });

/** The Zod schema of the `HostedSettings` type. */
export const HostedSettings: z.ZodType<HostedSettings> = z
  .object({
    offline: z
      .object({
        actions: z.enum(["queue", "fail"]).exactOptional(),
        limit: Duration.exactOptional(),
      })
      .exactOptional(),
    actions: z.enum(["signed-in", "link"]).exactOptional(),
    submissions: z.enum(["link", "signed-in"]).exactOptional(),
    preview: z.enum(["generic", "title"]).exactOptional(),
  })
  .register(wireRegistry, {
    id: "HostedSettings",
    description:
      "How an artifact behaves on a remote server: offline actions, who may act and submit, previews.",
  });

/** The Zod schema of the `ArtifactManifest` type. Objects stay open, so newer keys pass through. */
export const ArtifactManifest: z.ZodType<ArtifactManifest> = z
  .object({
    id: ArtifactId.schema.exactOptional(),
    title: z.string().min(1),
    description: z.string().exactOptional(),
    family: z.string().min(1).exactOptional(),
    links: z.array(ArtifactLink).readonly().exactOptional(),
    mode: z.literal("spa").exactOptional(),
    submission: SubmissionPolicy.exactOptional(),
    kit: z
      .object({
        base: z.enum(["base", "radix"]).exactOptional(),
        theme: z.union([z.string(), z.array(z.string()).readonly()]).exactOptional(),
      })
      .exactOptional(),
    terminals: z.record(z.string(), TerminalSpec).readonly().exactOptional(),
    demos: z.record(z.string(), DemoSpec).readonly().exactOptional(),
    limits: z
      .object({
        heapMb: z.int().min(1).exactOptional(),
        watchdogMs: z.int().min(1).exactOptional(),
        idleMinutes: z.number().min(0).exactOptional(),
      })
      .exactOptional(),
    verify: z
      .object({
        viewports: strings.exactOptional(),
        frames: strings.exactOptional(),
        extraChecks: strings.exactOptional(),
        smoke: z.boolean().exactOptional(),
      })
      .exactOptional(),
    tally: z.array(TallySpec).readonly().exactOptional(),
    hosted: HostedSettings.exactOptional(),
    team: TeamSettings.exactOptional(),
  })
  .register(wireRegistry, {
    id: "ArtifactManifest",
    description:
      "The artifact manifest (INTERFACES §2.2): literal metadata from the entry's defineArtifact call or MDX frontmatter.",
  });

/**
 * The rules of a manifest that JSON Schema can't state, checked after its schema by everything
 * that reads a manifest (D165 items 4, 12): a tally's choices are distinct, each field is tallied
 * once, and an offline limit is at most 7 days. Answers the first problem, with its field's path.
 */
export function manifestProblem(
  manifest: ArtifactManifest,
): { readonly path: string; readonly message: string } | undefined {
  const fields = new Set<string>();
  for (const [index, tally] of (manifest.tally ?? []).entries()) {
    if (new Set(tally.choices).size !== tally.choices.length) {
      return { path: `tally.${index}.choices`, message: "a tally's choices must be distinct" };
    }
    if (fields.has(tally.field)) {
      return { path: `tally.${index}.field`, message: `\`${tally.field}\` is tallied twice` };
    }
    fields.add(tally.field);
  }
  const limit = manifest.hosted?.offline?.limit;
  if (limit !== undefined && durationMs(limit) > HOSTED_OFFLINE_LIMIT_MAX_MS) {
    return { path: "hosted.offline.limit", message: "an offline limit is at most 7d" };
  }
  for (const [name, spec] of Object.entries(manifest.demos ?? {})) {
    if (!isDemoBuild(spec)) continue;
    if (!DEMO_NAME.test(name)) {
      return {
        path: `demos.${name}`,
        message:
          "a demo's name is 1 to 64 lower-case letters, digits and -, starting with a letter or digit",
      };
    }
    if (spec.timeout !== undefined && durationMs(spec.timeout) > DEMO_TIMEOUT_MAX_MS) {
      return { path: `demos.${name}.timeout`, message: "a demo's build timeout is at most 60m" };
    }
    for (const key of ["source", "output"] as const) {
      const value = spec[key].replaceAll("\\", "/");
      if (value.startsWith("/") || /^[a-z]:/i.test(value)) {
        return { path: `demos.${name}.${key}`, message: `a demo's ${key} is a relative path` };
      }
    }
    if (spec.output.replaceAll("\\", "/").split("/").includes("..")) {
      return {
        path: `demos.${name}.output`,
        message: "a demo's output is a folder inside its source",
      };
    }
  }
  const stack = manifest.kit?.theme;
  if (stack !== undefined) {
    const problem = themeStackProblem(typeof stack === "string" ? [stack] : stack);
    if (problem !== undefined) return { path: "kit.theme", message: problem };
  }
  return undefined;
}

/** The theme stack of a page that names none (D181 item 2). */
export const DEFAULT_THEME_STACK: readonly string[] = ["studio"];

/** The most entries a theme stack may have. */
export const THEME_STACK_MAX = 8;

/** One entry of a theme stack, by what it names. */
export type ThemeStackEntry =
  /** A built-in theme, or one an installed plugin contributes, by its id. */
  | { readonly kind: "theme"; readonly id: string }
  /** A CSS file in the artifact, by its path inside it (`./brand.css`). */
  | { readonly kind: "file"; readonly path: string }
  /** The colours, radius and faces of the host the page is shown in (D181 item 5). */
  | { readonly kind: "host" };

/** A theme's id: lower case, `a-z`, digits and hyphens, at most 32 characters. */
const THEME_ID = /^[a-z][a-z0-9-]{0,31}$/;
/** A CSS file inside the artifact: `./`, then segments of plain characters, ending in `.css`. */
const THEME_FILE = /^\.\/[A-Za-z0-9._\-/]{1,200}\.css$/;

/** Whether a stack's file path stays inside the artifact: no empty, `.` or `..` segment. */
function staysInside(path: string): boolean {
  return path.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

/** What one entry of a stack names, or `undefined` for text that names nothing. */
export function themeStackEntry(text: string): ThemeStackEntry | undefined {
  if (text === "host") return { kind: "host" };
  if (THEME_ID.test(text) && text !== "none") return { kind: "theme", id: text };
  if (THEME_FILE.test(text) && staysInside(text.slice(2)))
    return { kind: "file", path: text.slice(2) };
  return undefined;
}

/**
 * Why a theme stack can't be built, or `undefined` when it can (D181 item 2): `"none"` stands
 * alone; otherwise the first entry is a theme, which must be complete; the themes come first,
 * then the artifact's own files, with `"host"` once, after every theme (where a file after it
 * still overrides it) or last; no entry twice; at most eight.
 */
export function themeStackProblem(stack: readonly string[]): string | undefined {
  if (stack.length === 0) return 'name a theme, or "none" for no theme';
  if (stack.includes("none")) {
    return stack.length === 1 ? undefined : '"none" stands alone: it builds no theme at all';
  }
  if (stack.length > THEME_STACK_MAX) return `at most ${THEME_STACK_MAX} entries`;
  if (new Set(stack).size !== stack.length) return "an entry appears twice";
  const entries = stack.map((text) => ({ text, entry: themeStackEntry(text) }));
  const unknown = entries.find(({ entry }) => entry === undefined);
  if (unknown !== undefined) {
    return `"${unknown.text}" is neither a theme's id, a CSS file of the artifact ("./brand.css") nor "host"`;
  }
  if (entries[0]?.entry?.kind !== "theme") {
    return 'the first entry is a complete theme, such as "studio" or "arcata"; files and "host" go after it';
  }
  let seenOther = false;
  for (const { text, entry } of entries) {
    if (entry?.kind === "theme" && seenOther) {
      return `the theme "${text}" comes after a file or "host": themes go first, then the artifact's own files`;
    }
    if (entry?.kind !== "theme") seenOther = true;
  }
  return undefined;
}

/** A manifest's theme stack as written, or the default when it names none. */
export function themeStackOf(manifest: Pick<ArtifactManifest, "kit">): {
  readonly stack: readonly string[];
  /** Whether the page named no theme, and wears the default. */
  readonly default: boolean;
} {
  const theme = manifest.kit?.theme;
  if (theme === undefined) return { stack: DEFAULT_THEME_STACK, default: true };
  return { stack: typeof theme === "string" ? [theme] : theme, default: false };
}
