/**
 * The operator boundary of a remote server (ARCHITECTURE §15.10, INTERFACES §18.6, D165 items 9
 * and 11): the ports an operating layer implements in an ES module the server loads in process,
 * and the handle the server gives it. Each port is optional and has a no-op default, so a
 * self-hoster needs none of it; each call is async and time-limited, and the server checks every
 * answer against the schemas below before it acts on one (an answer they refuse counts as no
 * answer).
 *
 * An operating layer imports nothing of Mostra but this module (`@mostra/protocol/operator`), so
 * the surface it builds on is this file's, versioned with `@mostra/protocol` and changed only
 * additively (D32).
 *
 * ```ts
 * import { defineOperator } from "@mostra/protocol/operator";
 *
 * export default defineOperator((server) => ({
 *   limits: { check: async (q) => (q.operation === "share" ? { allowed: true } : { allowed: true }) },
 *   abuse: { report: async (r) => { await server.quarantine({ routeId: r.routeId }, r.reason); } },
 * }));
 * ```
 *
 * Every port call and every handle target names a hosted route (`rte_…`): an artifact ID, and a
 * version ID derived from it (D89), repeat across homes when a project is copied, so a bare ID
 * would reach every tenant hosting it.
 */
import * as z from "zod";

/** The operator boundary's own revision, which a module may check (additive within it). */
export const OPERATOR_REVISION = "2026-11-08";

/** How long the server waits for each port, in milliseconds, before it acts as if none answered. */
export const OPERATOR_TIME_LIMITS: {
  readonly limits: number;
  readonly policy: number;
  readonly routing: number;
  readonly identity: number;
  readonly accounts: number;
  readonly authenticate: number;
  readonly pushed: number;
  readonly outbound: number;
} = {
  limits: 2_000,
  policy: 2_000,
  routing: 2_000,
  identity: 2_000,
  accounts: 5_000,
  authenticate: 5_000,
  pushed: 30_000,
  outbound: 30_000,
};

// ── limits ──────────────────────────────────────────────────────────────────────────────

/**
 * An operation `limits.check` judges. When the operator doesn't answer in time, `share`,
 * `version.push`, `link` and authoring fail closed, and `view`, `submit` and draft writes proceed,
 * so nothing a person typed is lost (D165 item 9).
 */
export type LimitOperation =
  | "share"
  | "version.push"
  | "link"
  | "view"
  | "submit"
  | "run"
  | "run.wait"
  | "call"
  | "mcp.call"
  | "storage";

/** What `limits.check` is asked. */
export interface LimitQuery {
  /** The account the operation counts against. */
  readonly account: string;
  /** The account's hosted home. */
  readonly home: string;
  /** The artifact, for operations on one. */
  readonly artifact?: string;
  /** The artifact's hosted route, for operations on one (WP-30). */
  readonly routeId?: string;
  /** What is asked for. */
  readonly operation: LimitOperation;
  /** How much: bytes for `storage` and `version.push`, else 1. */
  readonly quantity?: number;
}

/** How long the server may keep an answer instead of asking again, in milliseconds (WP-30). */
export interface Cacheable {
  /** Absent or 0: ask again next time. */
  readonly cacheForMs?: number;
}

/** `limits.check`'s answer. */
export type LimitAnswer =
  | ({ readonly allowed: true } & Cacheable)
  | ({
      readonly allowed: false;
      /** A diagnostic code of the operator's (the server answers `MOSTRA_REMOTE_LIMIT_REACHED`). */
      readonly code: string;
      /** Shown as text to whoever was refused. */
      readonly message: string;
      readonly retryAfterMs?: number;
    } & Cacheable);

const cacheFor = z.int().min(0).max(86_400_000).exactOptional();

/** The schema the server checks `limits.check`'s answer against. */
export const LimitAnswer: z.ZodType<LimitAnswer> = z.union([
  z.object({ allowed: z.literal(true), cacheForMs: cacheFor }),
  z.object({
    allowed: z.literal(false),
    code: z.string().min(1).max(128),
    message: z.string().max(1_000),
    retryAfterMs: z.int().min(0).max(86_400_000).exactOptional(),
    cacheForMs: cacheFor,
  }),
]);

// ── metering ────────────────────────────────────────────────────────────────────────────

/** A counter's name (INTERFACES §18.6). */
export type MeterName =
  | "views"
  | "submissions"
  | "requests"
  | "bytes.stored"
  | "bytes.egress"
  | "relay.messages"
  | "mcp.calls"
  | "home.activeSeconds"
  | (string & {});

/**
 * One counter of a batch. `views` carry `viewerKey`, a monthly pseudonymous key (an HMAC under a
 * key the server rotates each month), never an identity: per account for a signed-in viewer, per
 * viewer for a link minted with one, and per route for an anonymous viewer, since the shell gives
 * each route a different key and none spans routes (HY-08). `mcp.calls` carry `client`, the MCP
 * client's `clientInfo` name (D148).
 */
export interface MeterCounter {
  /** What is counted. */
  readonly name: MeterName;
  /** The account it counts against. */
  readonly account: string;
  /** The account's hosted home. */
  readonly home?: string;
  /** The artifact, for counters of one. */
  readonly artifactId?: string;
  /** The artifact's hosted route, for counters of one. */
  readonly routeId?: string;
  /** How much in the batch's window: a count, bytes or seconds. */
  readonly value: number;
  /** What tells counters of one name apart (`viewerKey`, `client`). */
  readonly dimensions?: Readonly<Record<string, string>>;
}

/** What `metering.record` receives, at least once, idempotent by `batchId`. */
export interface MeterBatch {
  /** Stable across retries: a batch delivered twice is the same batch. */
  readonly batchId: string;
  /** Where the window the counters cover starts. */
  readonly from: string;
  /** Where it ends. */
  readonly to: string;
  /** The counters, one per name, account, route and dimensions. */
  readonly counters: readonly MeterCounter[];
}

// ── sign-in: identity providers and accounts ────────────────────────────────────────────

/**
 * Who an identity provider says signed in (INTERFACES §18.5). `facts` carries what a provider
 * tells beyond that (GitHub's account age, `createdAt`), for an operator's policy.
 */
export interface SignInIdentity {
  /** The provider's ID (`IdentityProvider.id`). */
  readonly provider: string;
  /** The provider's own stable ID for the person. */
  readonly subject: string;
  /** The person's email address, when the provider gives one. */
  readonly email?: string;
  /** Whether the provider verified `email`. */
  readonly emailVerified?: boolean;
  /** The display name the provider gives. */
  readonly name?: string;
  /** What else the provider tells (an account's age as `createdAt`). */
  readonly facts?: Readonly<Record<string, unknown>>;
}

/** The schema the server checks a provider's `SignInIdentity` against. */
export const SignInIdentity: z.ZodType<SignInIdentity> = z.object({
  provider: z.string().regex(/^[a-z][a-z0-9-]{0,31}$/),
  subject: z.string().min(1).max(256),
  email: z.string().max(320).exactOptional(),
  emailVerified: z.boolean().exactOptional(),
  name: z.string().max(256).exactOptional(),
  facts: z.record(z.string(), z.unknown()).exactOptional(),
});

/** PKCE for one sign-in at a provider: the server makes it; the provider sends `challenge`. */
export interface SignInPkce {
  /** The S256 challenge the provider's authorization request carries. */
  readonly challenge: string;
  /** Always S256. */
  readonly method: "S256";
  /** The verifier the provider's code exchange sends. */
  readonly verifier: string;
}

/** What a provider's `authorize` and `callback` are told about the sign-in in progress. */
export interface SignInContext {
  /** The provider's return address on the API origin: `<apiOrigin>/signin/<id>/callback`. */
  readonly redirectUri: string;
  /** A fresh value an OpenID Connect provider binds its ID token to. */
  readonly nonce: string;
}

/**
 * An identity provider behind the sign-in port (D165 item 8): the built-in OpenID Connect and
 * GitHub adapters, a development one for tests, or one an operator module supplies.
 */
export interface IdentityProvider {
  /** Lower-case letters, digits and hyphens, at most 32: part of its callback's path. */
  readonly id: string;
  /** What the sign-in page calls it ("GitHub"). */
  readonly label: string;
  /** Where to send the person: the provider's authorization URL with `state` and PKCE. */
  authorize(state: string, pkce: SignInPkce, context: SignInContext): string | Promise<string>;
  /**
   * The person the provider names on return, from its callback's query (each parameter once; a
   * repeated one is refused before this is called). The server has already
   * checked `state`; the provider exchanges the code (with `pkce.verifier`) and checks what it
   * gets. Throws when sign-in failed.
   */
  callback(
    params: Readonly<Record<string, string>>,
    context: SignInContext & { readonly state: string; readonly pkce: SignInPkce },
  ): Promise<SignInIdentity>;
}

/**
 * `accounts.resolve`'s answer: the account (`status` `suspended` refuses sign-in), a **first
 * sign-in step** on the operator's origin, or a refusal shown as text.
 *
 * A step: the server sends the person to `step.url` with `mostra_return` added, an address on the
 * API origin (`/signin/return?step=<handle>`). The handle is single-use, lasts 15 minutes and is
 * bound to the browser that started the sign-in (a `__Host-` cookie on the API origin, never on a
 * user-content domain), so it can't be replayed or swapped. When the person comes back the server
 * calls `resolve` again with the same identity and `context.steps` one higher; at most three steps
 * per sign-in (WP-30, D167).
 */
export type AccountResolution =
  | {
      readonly account: string;
      readonly name?: string;
      readonly status: "active" | "suspended";
    }
  | { readonly step: { readonly url: string } }
  | { readonly refused: { readonly message: string } };

/** The schema the server checks `accounts.resolve`'s answer against. */
export const AccountResolution: z.ZodType<AccountResolution> = z.union([
  z.object({
    account: z.string().min(1).max(128),
    name: z.string().max(256).exactOptional(),
    status: z.enum(["active", "suspended"]),
  }),
  z.object({ step: z.object({ url: z.url({ protocol: /^https$/ }).max(2_048) }) }),
  z.object({ refused: z.object({ message: z.string().max(1_000) }) }),
]);

/** Where an operator-issued credential was presented (D165 item 9, Opus review of WP-28). */
export type CredentialResource = "host" | "mcp" | "files";

/**
 * `accounts.authenticate`'s answer for a credential the operator issued, or `null`. `subject`
 * names the credential stably (a service key's ID): a binding with it is one owner instance link
 * of the account, kept per subject, so a program can run an always-on owner instance.
 */
export interface AuthenticatedCredential {
  /** The account the credential acts for. */
  readonly account: string;
  /** What it may do: `mostra` for everything a sign-in may. */
  readonly scope: readonly string[];
  /** The credential's own stable name, which keys its instance link. */
  readonly subject?: string;
}

/** The schema the server checks `accounts.authenticate`'s answer against. */
export const AuthenticatedCredential: z.ZodType<AuthenticatedCredential | null> = z
  .object({
    account: z.string().min(1).max(128),
    scope: z.array(z.string().max(64)).max(32),
    subject: z
      .string()
      .regex(/^[A-Za-z0-9._:-]{1,128}$/)
      .exactOptional(),
  })
  .nullable();

// ── abuse ───────────────────────────────────────────────────────────────────────────────

/** A report from the shell's report control (`POST /a/{routeId}/_mostra/report`). */
export interface AbuseReport {
  /** The reported route. */
  readonly routeId: string;
  /** The route's label. */
  readonly label: string;
  /** The artifact's own ID (as its manifest names it). */
  readonly artifactId: string;
  /** The hosted home. */
  readonly home: string;
  /** The version the reporter saw, when the shell knew it. */
  readonly versionId?: string;
  /** The reason the reporter chose. */
  readonly reason: string;
  /** What the reporter wrote, as text. */
  readonly detail?: string;
  /** When the report was made. */
  readonly at: string;
}

/** What `abuse.pushed` receives after each version push, with read access to its client files. */
export interface PushedVersion {
  /** The route the version was pushed to. */
  readonly routeId: string;
  /** The route's label. */
  readonly label: string;
  /** The artifact's own ID (as its manifest names it). */
  readonly artifactId: string;
  /** The hosted home. */
  readonly home: string;
  /** The pushed version. */
  readonly versionId: string;
  /** The version's `manifest.json`, parsed. */
  readonly manifest: unknown;
  /** Every client file's path (`client/…`). */
  readonly files: readonly string[];
  /** A client file's bytes, by its path in the listing. */
  read(path: string): Promise<Uint8Array>;
}

/** `abuse.pushed`'s answer: quarantine the version, or nothing. */
export type PushedAnswer = { readonly quarantine?: { readonly reason: string } } | undefined;

/** The schema the server checks `abuse.pushed`'s answer against. */
export const PushedAnswer: z.ZodType<PushedAnswer> = z
  .object({ quarantine: z.object({ reason: z.string().max(1_000) }).exactOptional() })
  .optional();

// ── policy ──────────────────────────────────────────────────────────────────────────────

/** What `policy.link` is asked about one link of one route. */
export interface LinkQuery {
  /** The account that owns the route. */
  readonly account: string;
  /** Its hosted home. */
  readonly home: string;
  /** The route. */
  readonly routeId: string;
  /** The artifact's own ID (as its manifest names it). */
  readonly artifactId: string;
  /** The link, once it exists. */
  readonly tokenId?: string;
}

/**
 * Per link and artifact (D161): an interstitial before the page, the longest link lifetime and an
 * idle expiry (durations such as `7d`), the after-submit line, the footer's wording (it can't be
 * hidden on a public link), and the made-with mark.
 */
export interface LinkPolicy extends Cacheable {
  /** A page the shell shows before the artifact, once per browser and link; its message as text. */
  readonly interstitial?: { readonly kind: string; readonly message?: string };
  /** The longest a link may live from when it was minted. */
  readonly maxTtl?: string;
  /** A link unused for this long expires. */
  readonly idleExpiry?: string;
  /** The line after "Your answer was sent.", as text. */
  readonly afterSubmit?: string;
  /** The footer's wording in place of "Never enter passwords", as text. */
  readonly footer?: string;
  /** Whether the made-with mark shows, and where it links. */
  readonly madeWith?: { readonly show: boolean; readonly href?: string };
}

const duration = z.string().regex(/^[1-9][0-9]{0,8}[smhd]$/);

/** The schema the server checks `policy.link`'s answer against. */
export const LinkPolicy: z.ZodType<LinkPolicy> = z.object({
  interstitial: z
    .object({ kind: z.string().min(1).max(64), message: z.string().max(2_000).exactOptional() })
    .exactOptional(),
  maxTtl: duration.exactOptional(),
  idleExpiry: duration.exactOptional(),
  afterSubmit: z.string().max(500).exactOptional(),
  footer: z.string().min(1).max(500).exactOptional(),
  madeWith: z
    .object({ show: z.boolean(), href: z.url({ protocol: /^https$/ }).exactOptional() })
    .exactOptional(),
  cacheForMs: cacheFor,
});

/**
 * How Mostra behaves in one chat host (D160): how a page renders there (an MCP App resource, or
 * the hosted link), and what a reached limit may say (`limit-reached` only, or the operator's
 * message).
 */
export interface ChatHostPolicy {
  /** `app`: through the MCP Apps resource; `link`: the hosted link only. */
  readonly render?: "app" | "link";
  /** What a reached limit may say there. */
  readonly quota?: "limit-reached" | "message";
}

/** The schema of the `ChatHostPolicy` type, for configuration and `policy.chatHost`. */
export const ChatHostPolicy: z.ZodType<ChatHostPolicy> = z.object({
  render: z.enum(["app", "link"]).exactOptional(),
  quota: z.enum(["limit-reached", "message"]).exactOptional(),
});

// ── routing ─────────────────────────────────────────────────────────────────────────────

/**
 * `routing.resolve`'s answer for an exact `Host` the server doesn't serve by itself (any host but
 * a configured user-content domain's apex and its routes' labels):
 *
 * - `shell`: the host shows the hosted shell (`/a/<routeId>`) for one home's routes, whose frames
 *   are served on `<route label>.<domain>`. `domain` is a configured user-content domain, or one
 *   the operator supplies (an organization's own, whose TLS the operator's edge terminates for the
 *   host and every label under `domain`); the server serves those labels once the host is
 *   recorded, without asking again.
 * - `route`: the host shows the shell of one route only (`/a/<routeId>`), with its frames on its
 *   label under the active domain: a chosen, readable name.
 * - `null`: nothing is served (421).
 *
 * A host the operator supplies is recorded like the server's own labels, bound to its home
 * forever: never issued to another home, so no origin's storage passes between tenants (D165).
 */
export type RoutingAnswer =
  | ({ readonly shell: { readonly domain: string; readonly home: string } } & Cacheable)
  | ({ readonly route: { readonly home: string; readonly routeId: string } } & Cacheable)
  | null;

/**
 * A host name of at least two labels, lower case; a port only as a local test server's hosts carry
 * one (the server's own configuration allows the same).
 */
const hostName = z
  .string()
  .regex(
    /^(?=.{1,253}(:|$))[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+(:\d{1,5})?$/,
  );

/** The schema the server checks `routing.resolve`'s answer against. */
export const RoutingAnswer: z.ZodType<RoutingAnswer> = z.union([
  z.object({
    shell: z.object({ domain: hostName, home: z.string().min(1) }),
    cacheForMs: cacheFor,
  }),
  z.object({
    route: z.object({ home: z.string().min(1), routeId: z.string().min(1) }),
    cacheForMs: cacheFor,
  }),
  z.null(),
]);

/** The schema of `routing.linkHost`'s answer: a shell host, or `null` for the active domain. */
export const LinkHost: z.ZodType<string | null> = hostName.nullable();

// ── events ──────────────────────────────────────────────────────────────────────────────

/** The kind of an outbound event. */
export type OperatorEventKind =
  | "submission.accepted"
  | "version.pushed"
  | "run.ended"
  | "roster.completed"
  | (string & {});

/**
 * One outbound event, delivered at least once with a stable `eventId`. `payload`:
 * `submission.accepted` carries the submission's `Results` (INTERFACES §8, the `Results` type of `@mostra/protocol`); `version.pushed`
 * `{ versionId, number }`; `run.ended` `{ runId, action, status }`; `roster.completed`
 * `{ round, respondents, submissions: { ref, submissionId }[] }`, when every expected respondent
 * answered (D168).
 * `label` is the route's label, so an operator running several servers behind one front learns
 * which serves which label (WP-30).
 */
export interface OperatorEvent {
  /** Stable across retries. */
  readonly eventId: string;
  /** What happened. */
  readonly kind: OperatorEventKind;
  /** The account that owns the route. */
  readonly account: string;
  /** Its hosted home. */
  readonly home: string;
  /** The route. */
  readonly routeId: string;
  /** The route's label. */
  readonly label: string;
  /** The artifact's own ID (as its manifest names it). */
  readonly artifactId: string;
  /** When it happened. */
  readonly at: string;
  /** What the kind carries. */
  readonly payload: unknown;
}

// ── the module ──────────────────────────────────────────────────────────────────────────

/** The ports an operator module implements; each is optional, with the default named. */
export interface OperatorPorts {
  /** Allows or refuses an operation for an account. Default: allow. */
  readonly limits?: { check(q: LimitQuery): Promise<LimitAnswer> };
  /** Counters in batches, at least once. Default: discard. */
  readonly metering?: { record(batch: MeterBatch): Promise<void> };
  /**
   * Identity providers beside the configured ones, asked at each sign-in so the set can change
   * while the server runs (WP-30). Default: none.
   */
  readonly identity?: {
    providers(): Promise<readonly IdentityProvider[]> | readonly IdentityProvider[];
  };
  /**
   * Sign-in identities to accounts, a first sign-in step, and credentials the operator issued.
   * Default: the server's own accounts, no step, no outside credential.
   */
  readonly accounts?: {
    resolve(
      identity: SignInIdentity,
      context: { readonly steps: number },
    ): Promise<AccountResolution>;
    authenticate?(
      bearer: string,
      context: { readonly resource: CredentialResource },
    ): Promise<AuthenticatedCredential | null>;
    status?(account: string): Promise<"active" | "suspended">;
  };
  /** Reports and the after-push hook. Default: nothing. */
  readonly abuse?: {
    report(r: AbuseReport): Promise<void>;
    pushed?(v: PushedVersion): Promise<PushedAnswer>;
  };
  /** Per link and per chat host. Default: nothing beyond configuration. */
  readonly policy?: {
    link(q: LinkQuery): Promise<LinkPolicy>;
    chatHost?(client: {
      readonly name: string;
      readonly redirectHost?: string;
    }): Promise<ChatHostPolicy | null>;
  };
  /**
   * Hosts the operator supplies, and the host a new link is minted on. Default: the server's own
   * labels, and links on the active domain.
   */
  readonly routing?: {
    resolve(host: string): Promise<RoutingAnswer>;
    /**
     * The shell host a new link of this route is minted on (one `resolve` answers `shell` or
     * `route` for), or `null` for the active domain (WP-30). A link keeps the host it was minted
     * on (D137).
     */
    linkHost?(q: {
      readonly account: string;
      readonly home: string;
      readonly routeId: string;
    }): Promise<string | null>;
  };
  /** Outbound events, at least once with stable IDs. Default: discard. */
  readonly events?: { deliver(e: OperatorEvent): Promise<void> };
  /**
   * Invitations to expected respondents (D121, D168): for each respondent a hosted roster names
   * with an `email`, when they are added or their personal link is replaced, so the operator can
   * mail them their link. At least once, ordered per home, with a stable `invitationId`. No mailer
   * ships: the open server only hands them over. Default: none sent.
   */
  readonly invitations?: { send(invitation: Invitation): Promise<void> };
}

/**
 * One invitation (D168). `url` is the respondent's personal link, a capability URL whose secret is
 * in its fragment: the server never stores or logs it (it builds it from the link's token when it
 * hands the invitation over), so the operator mails it and keeps it no longer than that.
 */
export interface Invitation {
  /** Stable across retries: `<home>:<tokenId>`, one per personal link. */
  readonly invitationId: string;
  /** The account that owns the route. */
  readonly account: string;
  /** Its hosted home. */
  readonly home: string;
  /** The route. */
  readonly routeId: string;
  /** The route's label. */
  readonly label: string;
  /** The artifact's ID. */
  readonly artifactId: string;
  /** The artifact's title, as its latest version names it. */
  readonly title: string;
  /** Who is invited: the owner's key for them, their name and the address to write to. */
  readonly respondent: { readonly ref: string; readonly name?: string; readonly email: string };
  /** Who invites: the owner's display name and the provider that verified it, when one did. */
  readonly sender: { readonly name?: string; readonly verifiedBy?: string };
  /** The personal link. */
  readonly url: string;
  /** When the link stops working, when it has a lifetime. */
  readonly expiresAt?: string;
  /** When the respondent was added, or their link replaced. */
  readonly at: string;
}

/** A hosted route, or one version of it: what the handle's quarantine and release act on. */
export type RouteTarget =
  | { readonly routeId: string }
  | { readonly routeId: string; readonly versionId: string };

/**
 * What the server gives its operator module (INTERFACES §18.6). Every target names a hosted route.
 * Each call is durable when it resolves.
 */
export interface ServerHandle {
  /** The operator boundary's revision this server speaks. */
  readonly revision: string;
  /** The server's API origin. */
  readonly apiOrigin: string;
  /** A neutral "under review" page from the shell; data kept; `release` restores it. */
  quarantine(target: RouteTarget, reason: string): Promise<void>;
  /** Ends a quarantine. */
  release(target: RouteTarget): Promise<void>;
  /** Views keep working; submissions and relayed actions are refused; only the operator resumes. */
  pause(routeId: string, reason: string): Promise<void>;
  /** Ends an operator's pause (and an owner's, too). */
  resume(routeId: string): Promise<void>;
  /** Refuses the home's bindings, pushes, links and pages until `resumeHome`. */
  suspendHome(home: string, reason: string): Promise<void>;
  /** Ends a suspension. */
  resumeHome(home: string): Promise<void>;
  /** Revokes every link of a route; answers how many were live. */
  revokeLinks(routeId: string): Promise<number>;
  /** Revokes one link (410 from then on). */
  revokeLink(tokenId: string): Promise<void>;
  /** Closes the home and refuses to reopen it, to move it between data directories. */
  drainHome(home: string): Promise<void>;
  /** Serves a drained home again. */
  releaseHome(home: string): Promise<void>;
  /** A restore from a backup: rotates the home's incarnation before it serves anything. */
  restored(home: string): Promise<void>;
  /** Deletion: explicit, never part of another action. The route's label is never issued again. */
  remove(routeId: string): Promise<void>;
}

/** An operator module's default export. */
export type OperatorModule = (server: ServerHandle) => OperatorPorts | Promise<OperatorPorts>;

/** Types an operator module's default export; returns it unchanged. */
export function defineOperator(module: OperatorModule): OperatorModule {
  return module;
}
