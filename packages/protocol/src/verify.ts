/**
 * `verify` (D29, D41, D55, D72, D137; INTERFACES §13): the verdict it returns, the viewports it
 * renders, and the image-token estimates every screenshot carries. Pure and free of I/O, so the
 * runtime, the verify runner, the CLI and the MCP server share one definition.
 */
import * as z from "zod";
import { Diagnostic } from "./diagnostics/diagnostic.ts";
import { wireRegistry } from "./wire-registry.ts";

/** When a verdict's screenshots are handed to the caller (AX-05): images cost tokens. */
export type ScreenshotPolicy = "on-failure" | "always" | "never";

/** The Zod schema of the `ScreenshotPolicy` type. */
export const ScreenshotPolicy: z.ZodType<ScreenshotPolicy, string> = z
  .enum(["on-failure", "always", "never"])
  .register(wireRegistry, {
    id: "ScreenshotPolicy",
    description: "When screenshots are returned: on failure (the default), always or never.",
  });

/** One viewport verify renders at device pixel ratio 1. */
export interface VerifyViewport {
  /** Its name in the verdict: `desktop`, `mobile`, `tablet`, or `<width>x<height>`. */
  readonly name: string;
  readonly width: number;
  readonly height: number;
}

/** The viewports verify renders when the manifest names none (ROUND-3 §9): desktop and mobile. */
export const DEFAULT_VIEWPORTS: readonly VerifyViewport[] = [
  { name: "desktop", width: 1280, height: 800 },
  { name: "mobile", width: 390, height: 844 },
];

const NAMED_VIEWPORTS: Readonly<Record<string, VerifyViewport>> = {
  desktop: { name: "desktop", width: 1280, height: 800 },
  mobile: { name: "mobile", width: 390, height: 844 },
  tablet: { name: "tablet", width: 768, height: 1024 },
};

/**
 * The viewports a manifest's `verify.viewports` names (`desktop`, `mobile`, `tablet`, or
 * `<width>x<height>` from 200 to 4000 px), in its order and without repeats; the defaults when it
 * names none. Returns the names it couldn't read beside them.
 */
export function viewportsFor(names: readonly string[] | undefined): {
  readonly viewports: readonly VerifyViewport[];
  readonly unknown: readonly string[];
} {
  if (names === undefined || names.length === 0)
    return { viewports: DEFAULT_VIEWPORTS, unknown: [] };
  const viewports: VerifyViewport[] = [];
  const unknown: string[] = [];
  for (const raw of names) {
    const name = raw.trim().toLowerCase();
    const sized = /^(\d{3,4})x(\d{3,4})$/.exec(name);
    const viewport =
      NAMED_VIEWPORTS[name] ??
      (sized ? { name, width: Number(sized[1]), height: Number(sized[2]) } : undefined);
    if (
      !viewport ||
      viewport.width < 200 ||
      viewport.height < 200 ||
      viewport.width > 4000 ||
      viewport.height > 4000
    ) {
      unknown.push(raw);
      continue;
    }
    if (!viewports.some((known) => known.name === viewport.name)) viewports.push(viewport);
  }
  return { viewports: viewports.length > 0 ? viewports : DEFAULT_VIEWPORTS, unknown };
}

/** What one image costs each model family to read (D137 item 9). */
export interface TokenEstimate {
  /** Claude's high-resolution tier (Claude 4.7 and later). */
  readonly claude: number;
  /** GPT at `detail: "high"` (gpt-5.5, gpt-5.6, gpt-6-astra). */
  readonly gpt: number;
  /** Gemini 3 and 4 at the default media resolution. */
  readonly gemini: number;
}

/** Claude: tokens of an image already within its tier's limits. */
const claudeTokens = (width: number, height: number): number =>
  Math.ceil(width / 28) * Math.ceil(height / 28);

/**
 * The size Claude resizes an image to (its documented reference implementation): the largest
 * aspect-preserving size whose 28-px-rounded sides fit `maxEdge` and whose tokens fit `maxTokens`.
 */
function claudeSize(
  width: number,
  height: number,
  maxEdge: number,
  maxTokens: number,
): readonly [number, number] {
  const fits = (w: number, h: number): boolean =>
    Math.ceil(w / 28) * 28 <= maxEdge &&
    Math.ceil(h / 28) * 28 <= maxEdge &&
    claudeTokens(w, h) <= maxTokens;
  if (fits(width, height)) return [width, height];
  if (height > width) {
    const [h, w] = claudeSize(height, width, maxEdge, maxTokens);
    return [w, h];
  }
  const aspect = width / height;
  let lo = 1;
  let hi = width;
  while (lo + 1 < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (fits(mid, Math.max(Math.round(mid / aspect), 1))) lo = mid;
    else hi = mid;
  }
  return [lo, Math.max(Math.round(lo / aspect), 1)];
}

/** GPT at `detail: "high"`: fit 2048 × 2048, then a 2,500-patch budget, then the 1.2 multiplier. */
function gptTokens(width: number, height: number): number {
  let w = width;
  let h = height;
  const edge = Math.min(1, 2048 / Math.max(w, h));
  if (edge < 1) {
    w = Math.max(1, Math.round(w * edge));
    h = Math.max(1, Math.round(h * edge));
  }
  let patches = Math.ceil(w / 32) * Math.ceil(h / 32);
  const budget = 2500;
  if (patches > budget) {
    const shrink = Math.sqrt((32 ** 2 * budget) / (w * h));
    const adjusted =
      shrink *
      Math.min(
        Math.floor((w * shrink) / 32) / ((w * shrink) / 32),
        Math.floor((h * shrink) / 32) / ((h * shrink) / 32),
      );
    patches = Math.ceil(Math.floor(w * adjusted) / 32) * Math.ceil(Math.floor(h * adjusted) / 32);
  }
  return Math.ceil(patches * 1.2);
}

/**
 * What an image of `width` × `height` pixels costs Claude, GPT and Gemini to read, by each
 * provider's published rule as verified on 2026-10-17 (VERIFIED_FACTS, WP-09). Estimates: harnesses
 * use them to budget, and each provider may round differently by a token.
 */
export function estimateImageTokens(width: number, height: number): TokenEstimate {
  const [cw, ch] = claudeSize(width, height, 2576, 4784);
  return { claude: claudeTokens(cw, ch), gpt: gptTokens(width, height), gemini: 1120 };
}

/** One screenshot in a verdict (AX-05). */
export interface VerdictScreenshot {
  readonly viewport: string;
  /** The PNG, at device pixel ratio 1. */
  readonly path: string;
  readonly width: number;
  readonly height: number;
  readonly tokensEstimate: TokenEstimate;
  /** Whether the caller is handed the image: on failure, or when asked (`screenshots`). */
  readonly returned: boolean;
}

/** One ARIA snapshot in a verdict: the text-only picture of what a viewport shows. */
export interface VerdictAria {
  readonly viewport: string;
  /** The snapshot's YAML. */
  readonly path: string;
  /** A one-line count of what it holds: headings, controls, landmarks. */
  readonly summary: string;
}

/** The verdict of one `verify` run (INTERFACES §13). `status` is `fail` exactly when an error exists. */
export interface VerifyVerdict {
  readonly status: "pass" | "fail";
  readonly artifact: {
    /** The artifact, when it has one already: a manifest `id` or a published path. */
    readonly id?: string;
    readonly path: string;
    readonly sourceDigest: string;
    readonly envDigest: string;
    /** The version this source would publish as, when the artifact is known (D89). */
    readonly versionId?: string;
  };
  readonly diagnostics: readonly Diagnostic[];
  readonly screenshots: readonly VerdictScreenshot[];
  readonly aria: readonly VerdictAria[];
  readonly smoke: {
    /** Controls the smoke test used. */
    readonly interactions: number;
    /** Server functions that don't check `dryRun()` and were refused instead of run (D55). */
    readonly skippedActions: readonly string[];
    /** Field writes the interactions caused. */
    readonly stateChanges: number;
  };
  readonly regressions: {
    /** The version compared against: the newest whose recorded verdict passed (D137 item 4). */
    readonly against?: string;
    /** Controls and landmarks the baseline had and this source doesn't, in brief. */
    readonly aria?: string;
    /** The share of pixels that differ from the baseline, per viewport. */
    readonly pixels?: readonly { readonly viewport: string; readonly ratio: number }[];
    /** Contracts the baseline had that this source drops: fields, actions, live sources, pages. */
    readonly contracts?: readonly string[];
  };
  /** How long each stage took, in milliseconds, and `total`. */
  readonly timingsMs: Readonly<Record<string, number>>;
}

const tokenEstimate: z.ZodType<TokenEstimate> = z.object({
  claude: z.int().min(0),
  gpt: z.int().min(0),
  gemini: z.int().min(0),
});

/** The Zod schema of the `VerifyVerdict` type. */
export const VerifyVerdict: z.ZodType<VerifyVerdict> = z
  .object({
    status: z.enum(["pass", "fail"]),
    artifact: z.object({
      id: z.string().exactOptional(),
      path: z.string(),
      sourceDigest: z.string(),
      envDigest: z.string(),
      versionId: z.string().exactOptional(),
    }),
    diagnostics: z.array(Diagnostic).readonly(),
    screenshots: z
      .array(
        z.object({
          viewport: z.string(),
          path: z.string(),
          width: z.int().min(1),
          height: z.int().min(1),
          tokensEstimate: tokenEstimate,
          returned: z.boolean(),
        }),
      )
      .readonly(),
    aria: z
      .array(z.object({ viewport: z.string(), path: z.string(), summary: z.string() }))
      .readonly(),
    smoke: z.object({
      interactions: z.int().min(0),
      skippedActions: z.array(z.string()).readonly(),
      stateChanges: z.int().min(0),
    }),
    regressions: z.object({
      against: z.string().exactOptional(),
      aria: z.string().exactOptional(),
      pixels: z
        .array(z.object({ viewport: z.string(), ratio: z.number().min(0).max(1) }))
        .readonly()
        .exactOptional(),
      contracts: z.array(z.string()).readonly().exactOptional(),
    }),
    timingsMs: z.record(z.string(), z.number().min(0)),
  })
  .register(wireRegistry, {
    id: "VerifyVerdict",
    description:
      "The verdict of artifact/verify: pass or fail, diagnostics, screenshots with token estimates, ARIA snapshots, the smoke test, regressions and timings.",
  });

/** The notification `artifact/verify` sends while it runs, when the client accepts it. */
export const ARTIFACT_PROGRESS = "artifact/progress";

/** `artifact/progress`: one stage of a long request started or ended. */
export interface ArtifactProgressParams {
  /** The `progressToken` the request carried. */
  readonly progressToken: string;
  /** The stage: `prepare`, `build`, `boot`, `render`, `smoke`, `regression` … */
  readonly stage: string;
  /** How much of the request is done, from 0 to 1, when known. */
  readonly fraction?: number;
}

/** The Zod schema of the `ArtifactProgressParams` type. */
export const ArtifactProgressParams: z.ZodType<ArtifactProgressParams> = z
  .object({
    progressToken: z.string().min(1),
    stage: z.string().min(1),
    fraction: z.number().min(0).max(1).exactOptional(),
  })
  .register(wireRegistry, {
    id: "ArtifactProgressParams",
    description: "One stage of a long request (artifact/verify) started.",
  });

/**
 * What a verify run's page tells the runner about its fields (D137 item 3), on
 * `globalThis[VERIFY_PROBE]` in the `verify` target only: every field it mounted, how, and with
 * which initial value's type. @internal
 */
export const VERIFY_PROBE = "__mostraVerify";

/** One mounted field, as the probe reports it. @internal */
export interface ProbedField {
  readonly id: string;
  readonly scope: "viewer" | "artifact";
  /** The hook that named it: `useField`, `useChoice`, `useForm` or `storage`. */
  readonly hook: string;
  /** `typeof` its initial value, `array` or `null`. */
  readonly initialType: string;
  /** How many components have it mounted now. */
  readonly mounts: number;
  /** Other hook kinds, scopes or initial types it was mounted with, if any. */
  readonly conflicts: readonly string[];
}

/** The verify runner's methods (ARCHITECTURE §1): the supervisor asks, the runner answers. @internal */
export const VERIFY_RUNNER_METHODS = {
  /** Opens one capability link in a fresh browser context and reports what the page did. */
  render: "verify/render",
  /** Compares two screenshots and writes their difference. */
  compare: "verify/compare",
} as const;

/** `verify/render`'s params. @internal */
export interface RenderRequest {
  /** The capability link to open, as a viewer would (D137 item 1). */
  readonly url: string;
  readonly viewport: VerifyViewport;
  /** The fixed time `Date` reports, in ms since the epoch: the same for every render of a run. */
  readonly clockMs: number;
  /** Where the screenshot and the ARIA snapshot are written, named after `name`. */
  readonly outDir: string;
  readonly name: string;
  /** What to collect besides readiness and the page's own errors. */
  readonly collect: {
    readonly screenshot: boolean;
    readonly aria: boolean;
    readonly axe: boolean;
    /** The page's mounted fields, from the field probe. */
    readonly fields: boolean;
    /** Run the smoke test after rendering, within this budget. */
    readonly smoke?: { readonly maxInteractions: number; readonly maxMs: number };
  };
  /** When this render must have ended, in ms since the epoch. */
  readonly deadline: number;
}

/** `verify/render`'s answer. @internal */
export interface RenderResult {
  /** Whether the page reported `mostra/ready`. */
  readonly ready: boolean;
  /** What the runner found: page errors, console output, failed requests, axe, smoke, blank. */
  readonly findings: readonly Diagnostic[];
  readonly screenshot?: { readonly path: string; readonly width: number; readonly height: number };
  readonly aria?: { readonly path: string; readonly text: string };
  readonly fields?: readonly ProbedField[];
  readonly smoke?: {
    readonly interactions: number;
    readonly stateChanges: number;
    /** Server functions the sandbox refused during the smoke test. */
    readonly skipped: readonly string[];
    /** Whether it stopped at its budget. */
    readonly budget: boolean;
  };
  /** Whether the render ran past its deadline and stopped where it was. */
  readonly timedOut: boolean;
  readonly timingsMs: Readonly<Record<string, number>>;
}

/** `verify/compare`'s params. @internal */
export interface CompareRequest {
  readonly a: string;
  readonly b: string;
  /** Where to write the difference image. */
  readonly diff: string;
}

/** `verify/compare`'s answer. @internal */
export interface CompareResult {
  /** The share of pixels that differ beyond pixelmatch's perceptual threshold. */
  readonly ratio: number;
  /** Whether the two images had different sizes (then `ratio` is 1). */
  readonly sizeChanged: boolean;
}
