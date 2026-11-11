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

/** A web demo the artifact declares (ROUND-3 §5.4, TM-08): a command to run, or a port to attach to. */
export type DemoSpec =
  | {
      readonly command: readonly string[];
      readonly cwd?: string;
      readonly ready?: string;
      readonly bridge?: boolean;
    }
  | { readonly attach: number; readonly bridge?: boolean };

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
  /** The kit's shadcn base (default `base`, D72) and theme. */
  readonly kit?: { readonly base?: "base" | "radix"; readonly theme?: string };
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
        theme: z.string().exactOptional(),
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
  return undefined;
}
