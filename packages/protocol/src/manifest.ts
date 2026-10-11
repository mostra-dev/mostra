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
import { ArtifactId } from "./ids.ts";
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

/**
 * The submission policy an artifact requests (D10, D39, D63). The host decides the policy in force;
 * the manifest only asks for one.
 */
export type SubmissionPolicy =
  | { readonly policy: "once"; readonly scope?: "per-artifact" | "per-viewer" }
  | { readonly policy: "epochs" }
  | { readonly policy: "none" };

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
];

const strings = z.array(z.string()).readonly();

/** The Zod schema of the `ArtifactLink` type. */
export const ArtifactLink: z.ZodType<ArtifactLink> = z
  .object({ rel: z.string().min(1), artifact: z.string().min(1) })
  .register(wireRegistry, {
    id: "ArtifactLink",
    description: "A related artifact: how this one relates (rel) and the other artifact's ID.",
  });

/** The Zod schema of the `SubmissionPolicy` type. */
export const SubmissionPolicy: z.ZodType<SubmissionPolicy> = z
  .discriminatedUnion("policy", [
    z.object({
      policy: z.literal("once"),
      scope: z.enum(["per-artifact", "per-viewer"]).exactOptional(),
    }),
    z.object({ policy: z.literal("epochs") }),
    z.object({ policy: z.literal("none") }),
  ])
  .register(wireRegistry, {
    id: "SubmissionPolicy",
    description: "A submission policy: once (per-artifact or per-viewer), epochs, or none.",
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
  })
  .register(wireRegistry, {
    id: "ArtifactManifest",
    description:
      "The artifact manifest (INTERFACES §2.2): literal metadata from the entry's defineArtifact call or MDX frontmatter.",
  });
