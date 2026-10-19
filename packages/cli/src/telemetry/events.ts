/**
 * Telemetry's event schema 1 (D140 item 8), the one published in `docs/reference/telemetry.md`.
 * Every event is checked against it before it is queued and again before it is sent, so nothing
 * that isn't on that page can leave the machine: the objects are strict, every string is from a
 * closed set or a pattern, and no field takes free text.
 */
import { DIAGNOSTIC_AREAS } from "@mostra/protocol";
import * as z from "zod";
import { HARNESSES, type Harness } from "./harness.ts";

/** The schema version every event carries. */
export const SCHEMA = 1;

/** The duration buckets of `cli.command`. */
export const DURATIONS = ["<1s", "1-5s", "5-30s", "30s-2m", "2-10m", ">10m"] as const;

/** A command's duration bucket. */
export function durationBucket(ms: number): (typeof DURATIONS)[number] {
  if (ms < 1000) return "<1s";
  if (ms < 5000) return "1-5s";
  if (ms < 30_000) return "5-30s";
  if (ms < 120_000) return "30s-2m";
  if (ms < 600_000) return "2-10m";
  return ">10m";
}

/** A catalog-shaped diagnostic code: `MOSTRA_<AREA>_<NAME>`, never a message. */
const code = z
  .string()
  .regex(new RegExp(`^MOSTRA_(${DIAGNOSTIC_AREAS.join("|")})_[A-Z0-9_]{1,64}$`));

/** A command path from the definitions: lowercase words. */
const command = z.string().regex(/^[a-z]+( [a-z]+)?$/);

const common = {
  schema: z.literal(SCHEMA),
  at: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00Z$/),
  installId: z.uuid(),
  version: z.string().regex(/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/),
  os: z.enum(["darwin", "linux"]),
  arch: z.string().regex(/^[a-z0-9]{2,12}$/),
  node: z.int().min(0).max(999),
  harness: z.enum([...HARNESSES, "other", "none"]),
  ci: z.boolean(),
  consent: z.enum(["explicit", "default"]),
};

/** The fields every event carries. */
export interface CommonFields {
  readonly schema: typeof SCHEMA;
  readonly at: string;
  readonly installId: string;
  readonly version: string;
  readonly os: "darwin" | "linux";
  readonly arch: string;
  readonly node: number;
  readonly harness: Harness;
  readonly ci: boolean;
  readonly consent: "explicit" | "default";
}

/** One event, as sent (D140 item 8). */
export type TelemetryEvent = CommonFields &
  (
    | { readonly event: "cli.first_run" }
    | {
        readonly event: "cli.command";
        readonly command: string;
        readonly exit: number;
        readonly duration: (typeof DURATIONS)[number];
        readonly json: boolean;
        readonly error?: string | undefined;
      }
    | {
        readonly event: "verify.result";
        readonly status: "pass" | "fail";
        readonly codes: readonly string[];
        readonly codesTruncated: boolean;
      }
    | { readonly event: "publish.done"; readonly reused: boolean; readonly forced: boolean }
    | {
        readonly event: "share.done";
        readonly kind: "tailnet" | "funnel" | "cloudflare" | "remote";
      }
    | {
        readonly event: "mcp.session";
        readonly client: (typeof HARNESSES)[number] | "other";
        readonly clientVersion?: string | undefined;
      }
  );

/** Every event Mostra may send, as a strict union on `event`. */
export const TelemetryEvent: z.ZodType<TelemetryEvent> = z.discriminatedUnion("event", [
  z.strictObject({ ...common, event: z.literal("cli.first_run") }),
  z.strictObject({
    ...common,
    event: z.literal("cli.command"),
    command,
    exit: z.int().min(0).max(255),
    duration: z.enum(DURATIONS),
    json: z.boolean(),
    error: code.optional(),
  }),
  z.strictObject({
    ...common,
    event: z.literal("verify.result"),
    status: z.enum(["pass", "fail"]),
    codes: z.array(code).max(50),
    codesTruncated: z.boolean(),
  }),
  z.strictObject({
    ...common,
    event: z.literal("publish.done"),
    reused: z.boolean(),
    forced: z.boolean(),
  }),
  // Emitted by WP-13 and WP-29.
  z.strictObject({
    ...common,
    event: z.literal("share.done"),
    kind: z.enum(["tailnet", "funnel", "cloudflare", "remote"]),
  }),
  // Emitted by WP-15: a known agent's ID for the MCP client, or `other`; its version only then.
  z.strictObject({
    ...common,
    event: z.literal("mcp.session"),
    client: z.enum([...HARNESSES, "other"]),
    clientVersion: z
      .string()
      .regex(/^[0-9A-Za-z.+-]{1,32}$/)
      .optional(),
  }),
]);

/** `at`: now in UTC, rounded down to the minute. */
export function minute(now: Date): string {
  return `${now.toISOString().slice(0, 16)}:00Z`;
}

/** The distinct catalog codes of `codes`, sorted, at most 50, and whether some were left out. */
export function catalogCodes(
  codes: readonly string[],
  known: ReadonlySet<string>,
): { codes: string[]; codesTruncated: boolean } {
  const distinct = [...new Set(codes.filter((value) => known.has(value)))].sort();
  return { codes: distinct.slice(0, 50), codesTruncated: distinct.length > 50 };
}
