/**
 * The remote server's configuration (INTERFACES §18.1): a JSON file (`--config`) and
 * `MOSTRA_SERVER_<KEY>` variables, read before the server serves anything. A configuration it
 * can't use stops it, naming the key (`MOSTRA_REMOTE_CONFIG_INVALID`). Domains are configuration,
 * never code (D137, D165 item 0a): the dossier and this code name only `example` hosts.
 */
import { readFileSync } from "node:fs";
import { createDiagnostic, Duration, RpcError } from "@mostra/protocol";
import { safeHref } from "@mostra/themes";
import * as z from "zod";
import type { AppearanceConfig } from "../gateway/index.ts";
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

/**
 * A name or a short line a server's pages show (D171): 1 to 64 characters with no control,
 * format or separator characters, as `verifierLabel` holds labels, so one can't read as another.
 */
const PageName: z.ZodType<string> = z
  .string()
  .min(1)
  .max(64)
  .refine((value) => value.trim() !== "" && !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value), {
    message: "must be 1 to 64 characters with no control or format characters",
  });

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
  /**
   * An `oidc` provider's ID-token claims that go into `SignInIdentity.facts` under their own names,
   * when present (a Google Workspace account's domain, `hd`): at most 8 short names (MT-03).
   */
  readonly claims?: string[] | undefined;
}

/**
 * The label a configured provider's verified names carry on a hosted page's sender line ("verified
 * with GitHub"): its `label`, else GitHub's name or its ID; none for the development provider, which
 * takes the typed name on trust (D161). Recorded on each identity the provider links (MT-03).
 */
export function configuredVerifier(provider: IdentityProviderConfig): string | undefined {
  if (provider.kind === "development") return undefined;
  return verifierLabel(provider.label ?? (provider.kind === "github" ? "GitHub" : provider.id));
}

/**
 * A verifier's label as the sender line may show it (MT-03, and its Opus review): text of 1 to 64
 * characters with no control, format (bidirectional overrides, zero-width joiners), line or
 * paragraph separator characters, which could make one label read as another's ("verified with
 * GitHub" from reversed text); anything else is no label.
 */
export function verifierLabel(label: unknown): string | undefined {
  if (typeof label !== "string") return undefined;
  if (label.trim() === "" || label.length > 64) return undefined;
  if (/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(label)) return undefined;
  return label;
}

/** Claim names that would reach an object's prototype rather than a key of its own. */
const RESERVED_CLAIMS = new Set(["__proto__", "constructor", "prototype"]);

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
  /** How the server's own pages look and name themselves (D171). */
  readonly appearance?: AppearanceConfig | undefined;
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
          claims: z
            .array(
              z
                .string()
                .regex(/^[A-Za-z_][A-Za-z0-9_.:-]{0,63}$/, {
                  message: "must be claim names of at most 64 letters, digits and `_.:-`",
                })
                .refine((name) => !RESERVED_CLAIMS.has(name), {
                  message: "can't name `__proto__`, `constructor` or `prototype`",
                }),
            )
            .min(1)
            .max(8)
            .optional(),
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
    appearance: z
      .strictObject({
        theme: z.enum(["studio", "mostra"]).optional(),
        name: PageName.nullable().optional(),
        logo: z
          .strictObject({
            file: z.string().regex(/\.(svg|png|webp)$/i, {
              message: "must be an .svg, .png or .webp file",
            }),
            alt: PageName,
            width: z.int().min(1).max(400),
            height: z.int().min(1).max(120),
          })
          .optional(),
        stageLine: PageName.optional(),
        default: z.enum(["system", "light", "dark"]).optional(),
        footer: z
          .array(
            z.strictObject({
              href: z.string().refine((href) => safeHref(href) !== undefined, {
                message: "must be an https: address or a path of this server",
              }),
              text: PageName,
            }),
          )
          .max(6)
          .optional(),
      })
      .optional(),
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
  const claimed = (config.identityProviders ?? []).findIndex(
    (provider) => provider.claims !== undefined && provider.kind !== "oidc",
  );
  if (claimed >= 0) {
    throw invalid(
      `The configuration key \`identityProviders.${claimed}.claims\` can't be used: only an \`oidc\` provider passes on its ID token's claims.`,
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
