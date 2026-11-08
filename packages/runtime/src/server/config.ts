/**
 * The remote server's configuration (INTERFACES §18.1): a JSON file (`--config`) and
 * `MOSTRA_SERVER_<KEY>` variables, read before the server serves anything. A configuration it
 * can't use stops it, naming the key (`MOSTRA_REMOTE_CONFIG_INVALID`). Domains are configuration,
 * never code (D137, D165 item 0a): the dossier and this code name only `example` hosts.
 */
import { readFileSync } from "node:fs";
import { createDiagnostic, Duration, RpcError } from "@mostra/protocol";
import * as z from "zod";
import type { Environment } from "../log.ts";
import { validProxies } from "./clients.ts";

/** A rate: `count` per `per` (a duration such as `1m`, as links' lifetimes are written). */
const RateSchema: z.ZodType<Rate> = z.object({
  count: z.int().min(1),
  per: Duration,
});

/** A host name a link can use: lower-case labels of letters, digits and hyphens. */
const HostName: z.ZodString = z
  .string()
  .regex(
    /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*(:\d{1,5})?$/,
    {
      message: "must be a lower-case host name, with a port only for a local test",
    },
  );

/**
 * An origin the server is reached at: `https:`, or `http:` for loopback and `*.localhost` (tests
 * and a self-hoster's first run).
 */
const Origin: z.ZodType<string> = z.string().refine(
  (value) => {
    try {
      const url = new URL(value);
      if (url.origin !== value) return false;
      if (url.protocol === "https:") return true;
      return (
        url.protocol === "http:" &&
        (url.hostname === "127.0.0.1" ||
          url.hostname === "localhost" ||
          url.hostname.endsWith(".localhost") ||
          url.hostname === "[::1]")
      );
    } catch {
      return false;
    }
  },
  { message: "must be an https: origin (http: only on loopback), with no path" },
);

/** A rate limit: `count` per `per`. */
export interface Rate {
  readonly count: number;
  readonly per: string;
}

/** An identity provider sign-in goes through (§18.5); WP-30 adds `oidc` and `github`. */
export interface IdentityProviderConfig {
  readonly id: string;
  readonly kind: "development" | "oidc" | "github";
  readonly label?: string | undefined;
  readonly issuer?: string | undefined;
  readonly clientId?: string | undefined;
  readonly clientSecretFile?: string | undefined;
}

/** The configuration a remote server runs with (INTERFACES §18.1). */
export interface RemoteServerConfig {
  readonly apiOrigin: string;
  readonly domains: { readonly active: string; readonly spares?: string[] | undefined };
  readonly scheme?: "https" | "http" | undefined;
  readonly trustedProxies?: string[] | undefined;
  readonly identityProviders?: IdentityProviderConfig[] | undefined;
  readonly rateLimits?:
    | {
        readonly perIp?:
          | { readonly submissions?: Rate | undefined; readonly requests?: Rate | undefined }
          | undefined;
        readonly perLink?:
          | { readonly submissions?: Rate | undefined; readonly relayedRuns?: Rate | undefined }
          | undefined;
        readonly ipv6Prefix?: number | undefined;
      }
    | undefined;
  readonly ledger?: { readonly walAutocheckpoint?: number | undefined } | undefined;
  readonly relay?:
    | {
        readonly waitingRunsPerArtifact?: number | undefined;
        readonly drainPerSecond?: number | undefined;
      }
    | undefined;
  readonly homes?: { readonly idleCloseMinutes?: number | undefined } | undefined;
  readonly framing?: { readonly frameAncestors: "'none'" } | undefined;
  readonly operator?: string | undefined;
  readonly chatHosts?: Record<string, unknown> | undefined;
}

/** The schema of {@link RemoteServerConfig}. */
const Config: z.ZodType<RemoteServerConfig> & { readonly shape: Record<string, unknown> } =
  z.strictObject({
    apiOrigin: Origin,
    domains: z.strictObject({
      active: HostName,
      spares: z.array(HostName).optional(),
    }),
    /**
     * The scheme the user-content domain is served on: `https` behind a TLS terminator, `http`
     * for a loopback test. Default `https`.
     */
    scheme: z.enum(["https", "http"]).optional(),
    trustedProxies: z.array(z.string()).optional(),
    identityProviders: z
      .array(
        z.strictObject({
          id: z.string().regex(/^[a-z][a-z0-9-]{0,31}$/),
          kind: z.enum(["development", "oidc", "github"]),
          label: z.string().min(1).optional(),
          issuer: z.string().optional(),
          clientId: z.string().optional(),
          clientSecretFile: z.string().optional(),
        }),
      )
      .optional(),
    rateLimits: z
      .strictObject({
        perIp: z
          .strictObject({ submissions: RateSchema.optional(), requests: RateSchema.optional() })
          .optional(),
        perLink: z
          .strictObject({ submissions: RateSchema.optional(), relayedRuns: RateSchema.optional() })
          .optional(),
        ipv6Prefix: z.int().min(1).max(128).optional(),
      })
      .optional(),
    ledger: z.strictObject({ walAutocheckpoint: z.int().min(0).optional() }).optional(),
    relay: z
      .strictObject({
        waitingRunsPerArtifact: z.int().min(1).optional(),
        drainPerSecond: z.number().positive().optional(),
      })
      .optional(),
    homes: z.strictObject({ idleCloseMinutes: z.number().positive().optional() }).optional(),
    framing: z.strictObject({ frameAncestors: z.literal("'none'") }).optional(),
    operator: z.string().optional(),
    chatHosts: z.record(z.string(), z.unknown()).optional(),
  });

/** The configuration keys, and the variable each also comes from. */
const KEYS = Object.keys(Config.shape) as (keyof RemoteServerConfig)[];

/** `apiOrigin` → `MOSTRA_SERVER_API_ORIGIN`. */
function variableOf(key: string): string {
  return `MOSTRA_SERVER_${key.replace(/[A-Z]/g, (letter) => `_${letter}`).toUpperCase()}`;
}

function invalid(message: string): RpcError {
  return new RpcError(createDiagnostic("MOSTRA_REMOTE_CONFIG_INVALID", { message }));
}

/**
 * Reads the configuration: the file, then each `MOSTRA_SERVER_<KEY>` (a string for a string key,
 * JSON for the others) over it. Throws `MOSTRA_REMOTE_CONFIG_INVALID` naming the first key it
 * can't use.
 */
export function readServerConfig(file: string | undefined, env: Environment): RemoteServerConfig {
  let raw: Record<string, unknown> = {};
  if (file !== undefined) {
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch (error) {
      throw invalid(
        `The configuration file ${file} can't be read (${(error as NodeJS.ErrnoException).code ?? "error"}).`,
      );
    }
    try {
      const parsed = JSON.parse(text) as unknown;
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new Error("not an object");
      }
      raw = parsed as Record<string, unknown>;
    } catch {
      throw invalid(`The configuration file ${file} isn't a JSON object.`);
    }
  }
  for (const key of KEYS) {
    const variable = variableOf(key);
    const value = env[variable];
    if (value === undefined || value === "") continue;
    const stringKey = key === "apiOrigin" || key === "operator" || key === "scheme";
    if (stringKey) raw[key] = value;
    else {
      try {
        raw[key] = JSON.parse(value) as unknown;
      } catch {
        throw invalid(`${variable} isn't JSON.`);
      }
    }
  }
  const checked = Config.safeParse(raw);
  if (!checked.success) {
    const issue = checked.error.issues[0];
    const path = issue?.path.join(".") || "(configuration)";
    throw invalid(
      `The configuration key \`${path}\` can't be used: ${issue?.message ?? "invalid"}.`,
    );
  }
  const config = checked.data;
  const domains = [config.domains.active, ...(config.domains.spares ?? [])];
  const api = new URL(config.apiOrigin).host;
  if (domains.some((domain) => domain === api || api.endsWith(`.${domain}`))) {
    throw invalid(
      "The configuration key `apiOrigin` can't be on a user-content domain: sign-in and the binding live apart from tenant pages (D165 item 7).",
    );
  }
  const proxy = validProxies(config.trustedProxies ?? []);
  if (proxy !== undefined) {
    throw invalid(
      `The configuration key \`trustedProxies\` names ${JSON.stringify(proxy)}, which is neither an address nor a CIDR block.`,
    );
  }
  if (new Set(domains).size !== domains.length) {
    throw invalid("The configuration key `domains` names one domain twice.");
  }
  return config;
}
