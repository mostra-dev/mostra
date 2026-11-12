/**
 * A hosted home's pages beyond the local gateway's (ARCHITECTURE §15.6 to §15.8, INTERFACES
 * §18.4, D161, D165 items 8, 9, 13, 14): who a browser is on a link minted without a viewer, what
 * the trusted chrome shows around a view, which views and submissions the server's rules refuse
 * before they reach the ledger, and the shell routes of a hosted home of its own (the report
 * control, an anonymous viewer's name; sign-in arrives with the authorization server).
 *
 * Everything here answers through the gateway's one checked route table and its hooks
 * (`HostedAddressing`), so every rule is applied in the same order as every other route's (D96).
 */
import { randomBytes } from "node:crypto";
import {
  type ArtifactDetail,
  createDiagnostic,
  type HostedChrome,
  type Refusal,
  refusal,
} from "@mostra/protocol";
import type { LinkPolicy } from "@mostra/protocol/operator";
import {
  type Capabilities,
  type HostedAddressing,
  isRefusal,
  jsonResponse,
  type RouteContext,
  type RouteSpec,
  readJsonObject,
} from "../gateway/index.ts";
import type { Interaction } from "../interaction/index.ts";
import type { Ledger } from "../ledger/index.ts";
import type { Log } from "../log.ts";
import type { ClientAddresses, RateLimit, RateLimiter } from "./clients.ts";
import type { Operator } from "./operator.ts";

/** How long the server's reports from one address may come: 20 an hour (the operator's inbox). */
const REPORT_RATE: RateLimit = { count: 20, perMs: 60 * 60_000 };

/** Who owns a hosted home, as its pages name them (D161's sender line). */
export interface HomeOwner {
  readonly account: string;
  /** The account's display name. */
  readonly name?: string;
  /** The label of the identity provider that verified the name; absent: unverified. */
  readonly verifiedBy?: string;
}

/** Options for {@link hostedPages}. */
export interface HostedPagesOptions {
  readonly homeId: string;
  readonly ledger: Ledger;
  readonly interaction: Interaction;
  readonly capabilities: Capabilities;
  readonly artifact: (artifactId: string) => ArtifactDetail;
  readonly routeOf: (
    artifactId: string,
  ) => { readonly id: string; readonly label: string } | undefined;
  readonly owner: () => HomeOwner;
  /** Whether the server can sign a viewer in (an identity provider is configured or supplied). */
  readonly signInOffered: () => boolean;
  readonly operator: Operator;
  readonly clients: ClientAddresses;
  readonly rates: RateLimiter;
  /** `rateLimits` of the configuration, in milliseconds (D165 item 13). */
  readonly rateLimits: {
    readonly perIpSubmissions?: RateLimit | undefined;
    readonly perLinkSubmissions?: RateLimit | undefined;
  };
  /** The configuration's made-with mark (off unless an operator shows it, D161). */
  readonly madeWith?: { readonly href?: string } | undefined;
  /** Viewer sign-in on the authorization server, when one is configured (INTERFACES §18.4). */
  readonly signin?: {
    readonly start: (
      signin: { homeId: string; routeId: string; sessionId: string; shellOrigin: string },
      challenge: string,
    ) => { readonly url: string; readonly state: string };
    readonly finish: (input: {
      state: string;
      code: string;
      verifier: string;
      routeId: string;
      sessionId: string;
    }) =>
      | { readonly accountId: string; readonly name?: string; readonly provider?: string }
      | { readonly refused: string };
  };
  /** Told each view the server admitted, for metering (`views`). */
  readonly viewed?: (input: { readonly artifactId: string; readonly viewerId: string }) => void;
  readonly log: Log;
  readonly now?: () => number;
}

/** A refusal with any cataloged code (the gateway's own `refusal` takes HYGIENE codes only). */
function refuseWith(
  code: Parameters<typeof createDiagnostic>[0],
  message: string,
  status: number,
): Refusal {
  return { status, diagnostic: createDiagnostic(code, { message }) };
}

/** The milliseconds of a duration such as `7d` (checked by the operator's schema). */
function durationMs(text: string): number {
  const unit = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 }[text.slice(-1)] ?? 0;
  return Number(text.slice(0, -1)) * unit;
}

/** The gateway hooks of one hosted home's pages. */
export function hostedPages(
  options: HostedPagesOptions,
): Required<
  Pick<
    HostedAddressing,
    | "client"
    | "anonymousViewer"
    | "admitView"
    | "blocked"
    | "chrome"
    | "admitSubmit"
    | "shellRoutes"
  >
> {
  const { ledger, interaction, capabilities, operator, log } = options;
  const now = options.now ?? (() => Date.now());

  /** A route's quarantine: the whole route's, or this version's (D165 item 9). */
  const quarantineOf = (artifactId: string, versionId: string): string | undefined =>
    ledger.read(
      (db) =>
        db.get<{ reason: string }>(
          "SELECT reason FROM quarantine WHERE artifact_id = ? AND version_id IN ('', ?) LIMIT 1",
          artifactId,
          versionId,
        )?.reason,
    );

  const underReview = (): Refusal =>
    refuseWith(
      "MOSTRA_REMOTE_UNDER_REVIEW",
      "This page is under review by the server's operator.",
      403,
    );

  const policyFor = (artifactId: string, tokenId?: string): Promise<LinkPolicy> => {
    const route = options.routeOf(artifactId);
    if (!route) return Promise.resolve({});
    return operator.linkPolicy({
      account: options.owner().account,
      home: options.homeId,
      routeId: route.id,
      artifactId,
      ...(tokenId !== undefined ? { tokenId } : {}),
    });
  };

  /**
   * A link past the operator's longest lifetime or idle limit: revoked now, 410 (D165 item 9).
   * "Idle" is as `LinkPolicy.idleExpiry` says, without a view: the link's last view before the one
   * being admitted, which isn't recorded yet. A session's `last_seen_at` can't stand for it, since
   * the visit asking has just written its own (a fresh browser's exchange, or any request of a
   * returning one), so an idle link would open for every new visit (MT-03).
   */
  const expired = (tokenId: string, policy: LinkPolicy): Refusal | undefined => {
    if (policy.maxTtl === undefined && policy.idleExpiry === undefined) return undefined;
    const used = ledger.read((db) =>
      db.get<{ created_at: string; last: string | null }>(
        `SELECT t.created_at, (SELECT MAX(v.opened_at) FROM view v WHERE v.token_id = t.id) AS last
           FROM token t WHERE t.id = ?`,
        tokenId,
      ),
    );
    if (!used) return undefined;
    const minted = Date.parse(used.created_at);
    const lastUse = Math.max(minted, used.last === null ? 0 : Date.parse(used.last));
    const tooOld = policy.maxTtl !== undefined && now() - minted > durationMs(policy.maxTtl);
    const idle = policy.idleExpiry !== undefined && now() - lastUse > durationMs(policy.idleExpiry);
    if (!tooOld && !idle) return undefined;
    capabilities.revoke(tokenId);
    log.info("hosted.link_expired", { tokenId, why: tooOld ? "max-ttl" : "idle" });
    return refusal("MOSTRA_HYGIENE_TOKEN_REVOKED", "This link has expired.", 410);
  };

  const limitRefusal = (
    verdict: Awaited<ReturnType<Operator["limit"]>>,
  ): (Refusal & { readonly retryAfter?: number }) | undefined => {
    if (verdict.allowed !== false) return undefined;
    return {
      ...refuseWith("MOSTRA_REMOTE_LIMIT_REACHED", verdict.message, 403),
      ...(verdict.retryAfterMs !== undefined
        ? { retryAfter: Math.max(1, Math.ceil(verdict.retryAfterMs / 1000)) }
        : {}),
    };
  };

  const rateRefusal = (retryAfterS: number): Refusal & { readonly retryAfter: number } => ({
    ...refuseWith(
      "MOSTRA_REMOTE_RATE_LIMITED",
      "Too many answers came through here in a short time; try again shortly.",
      429,
    ),
    retryAfter: retryAfterS,
  });

  const shellRoutes = (helpers: Parameters<NonNullable<HostedAddressing["shellRoutes"]>>[0]) => {
    const meta = (context: RouteContext) => ({
      method: context.request.method,
      path: new URL(context.request.url).pathname,
      document: false,
    });

    /** The report control (D161): reaches the operator's `abuse.report`. */
    const report = async (context: RouteContext): Promise<Response> => {
      const artifactId = context.artifactId as string;
      const body = await readJsonObject(context.request, 16 * 1024);
      if (isRefusal(body)) return helpers.refuse(body, meta(context));
      const reason = body["reason"];
      const detail = body["detail"];
      if (
        typeof reason !== "string" ||
        !/^[a-z][a-z0-9-]{0,31}$/.test(reason) ||
        (detail !== undefined && (typeof detail !== "string" || detail.length > 2_000))
      ) {
        return helpers.refuse(
          refusal(
            "MOSTRA_HYGIENE_REQUEST_MALFORMED",
            "A report names a `reason` (a short word) and at most 2000 characters of `detail`.",
          ),
          meta(context),
        );
      }
      const limited = options.rates.take(
        `report:${options.clients.keyOf(context.client)}`,
        REPORT_RATE,
      );
      if (!limited.ok) return helpers.refuse(rateRefusal(limited.retryAfterS), meta(context));
      const route = options.routeOf(artifactId);
      if (!route) {
        return helpers.refuse(
          refusal("MOSTRA_HYGIENE_NOT_SERVED", "No route here."),
          meta(context),
        );
      }
      await operator.report({
        routeId: route.id,
        label: route.label,
        artifactId,
        home: options.homeId,
        ...(context.session?.versionId !== undefined
          ? { versionId: context.session.versionId }
          : {}),
        reason,
        ...(typeof detail === "string" && detail !== "" ? { detail } : {}),
        at: new Date(now()).toISOString(),
      });
      log.info("hosted.reported", { routeId: route.id, reason });
      return jsonResponse({}, { status: 202 });
    };

    /** An anonymous viewer's self-chosen name, recorded unverified (D165 item 8). */
    const name = async (context: RouteContext): Promise<Response> => {
      const body = await readJsonObject(context.request, 4 * 1024);
      if (isRefusal(body)) return helpers.refuse(body, meta(context));
      const value = body["name"];
      const cleaned =
        value === null
          ? null
          : typeof value === "string"
            ? value.replace(/\s+/g, " ").trim().slice(0, 64)
            : undefined;
      if (cleaned === undefined || cleaned === "") {
        return helpers.refuse(
          refusal("MOSTRA_HYGIENE_REQUEST_MALFORMED", "`name` is a short text, or null."),
          meta(context),
        );
      }
      const viewerId = interaction.viewerOf(context.session?.viewerId);
      if (!interaction.nameAnonymous(viewerId, cleaned)) {
        return helpers.refuse(
          refusal(
            "MOSTRA_HYGIENE_SCOPE_DENIED",
            "Only a viewer who isn't signed in names themselves here; a signed-in name is the account's.",
          ),
          meta(context),
        );
      }
      return jsonResponse({ viewer: interaction.viewer(viewerId) });
    };

    /**
     * A page's sign-in, from a click in the trusted chrome only (INTERFACES §18.4): the address of
     * the authorization server, with `state` bound to this route and this shell session.
     */
    const signinStart = async (context: RouteContext): Promise<Response> => {
      const body = await readJsonObject(context.request, 4 * 1024);
      if (isRefusal(body)) return helpers.refuse(body, meta(context));
      const challenge = body["challenge"];
      const route = options.routeOf(context.artifactId as string);
      if (
        typeof challenge !== "string" ||
        !/^[A-Za-z0-9_-]{43}$/.test(challenge) ||
        !route ||
        !options.signin ||
        !context.session
      ) {
        return helpers.refuse(
          refusal(
            "MOSTRA_HYGIENE_REQUEST_MALFORMED",
            "A sign-in starts with a PKCE S256 challenge.",
          ),
          meta(context),
        );
      }
      const started = options.signin.start(
        {
          homeId: options.homeId,
          routeId: route.id,
          sessionId: context.session.id,
          // The shell's own origin: the pipeline checked the request's Origin is exactly it.
          shellOrigin: context.request.headers.get("origin") ?? "",
        },
        challenge,
      );
      return jsonResponse(started);
    };

    /** The code back from the authorization server: the session acts as the account from now on. */
    const signinFinish = async (context: RouteContext): Promise<Response> => {
      const body = await readJsonObject(context.request, 8 * 1024);
      if (isRefusal(body)) return helpers.refuse(body, meta(context));
      const route = options.routeOf(context.artifactId as string);
      const { code, verifier, state } = body as Record<string, unknown>;
      if (
        typeof code !== "string" ||
        typeof verifier !== "string" ||
        typeof state !== "string" ||
        !route ||
        !options.signin ||
        !context.session
      ) {
        return helpers.refuse(
          refusal(
            "MOSTRA_HYGIENE_REQUEST_MALFORMED",
            "Send the sign-in's code, verifier and state.",
          ),
          meta(context),
        );
      }
      const finished = options.signin.finish({
        code,
        verifier,
        state,
        routeId: route.id,
        sessionId: context.session.id,
      });
      if ("refused" in finished) {
        log.warn("hosted.signin_refused", { routeId: route.id });
        return helpers.refuse(
          refusal("MOSTRA_HYGIENE_SCOPE_DENIED", finished.refused, 403),
          meta(context),
        );
      }
      // A link minted for a named person keeps acting as that person (D104); any other session
      // now acts as the account, its name verified by its provider (D165 item 8).
      const viewerId = interaction.viewerForAccount(finished.accountId, finished.name);
      if (context.session.grant.viewerId === undefined) {
        const sessionId = context.session.id;
        ledger.write((db) =>
          db.run("UPDATE session SET viewer_id = ? WHERE id = ?", viewerId, sessionId),
        );
      }
      log.info("hosted.signed_in", { routeId: route.id });
      return jsonResponse({ viewer: interaction.viewer(viewerId) });
    };

    const routes: RouteSpec[] = [
      {
        method: "POST",
        path: "/a/:artifactId/_mostra/session/signin/start",
        intent: "mutation",
        auth: "session",
        handler: signinStart,
      },
      {
        method: "POST",
        path: "/a/:artifactId/_mostra/session/signin",
        intent: "mutation",
        auth: "session",
        handler: signinFinish,
      },
      {
        method: "POST",
        path: "/a/:artifactId/_mostra/report",
        intent: "mutation",
        auth: "session",
        handler: report,
      },
      {
        method: "POST",
        path: "/a/:artifactId/_mostra/session/name",
        intent: "mutation",
        auth: "session",
        handler: name,
      },
    ];
    return routes;
  };

  return {
    client: (incoming) => options.clients.of(incoming),

    anonymousViewer: (browser) =>
      interaction.viewerForAnonymous(
        // Without the route's key (storage blocked), a fresh viewer for this session alone: its
        // draft is this page's until a reload, never anyone else's.
        browser ?? `session:${randomBytes(16).toString("hex")}`,
      ),

    async admitView(input) {
      if (quarantineOf(input.artifactId, input.versionId) !== undefined) return underReview();
      const policy = await policyFor(input.artifactId, input.tokenId);
      const gone = expired(input.tokenId, policy);
      if (gone) return gone;
      const route = options.routeOf(input.artifactId);
      // `view` proceeds when the operator doesn't answer: nothing a person sees is held up by it.
      const verdict = await operator.limit({
        account: options.owner().account,
        home: options.homeId,
        artifact: input.artifactId,
        ...(route ? { routeId: route.id } : {}),
        operation: "view",
      });
      const refused = limitRefusal(verdict);
      if (refused) return refused;
      return undefined;
    },

    blocked: (artifactId, versionId) =>
      quarantineOf(artifactId, versionId) !== undefined ? underReview() : undefined,

    async chrome(input) {
      const owner = options.owner();
      const viewer = interaction.viewer(input.viewerId);
      const policy = await policyFor(input.artifactId, input.tokenId);
      options.viewed?.({ artifactId: input.artifactId, viewerId: input.viewerId });
      const chrome: HostedChrome = {
        ...(owner.name !== undefined
          ? {
              sender: {
                name: owner.name,
                ...(owner.verifiedBy !== undefined ? { verifiedBy: owner.verifiedBy } : {}),
              },
            }
          : {}),
        viewer:
          viewer.kind === "account"
            ? { kind: "account", ...(viewer.name ? { name: viewer.name } : {}), verified: true }
            : viewer.kind === "anonymous"
              ? {
                  kind: "anonymous",
                  ...(viewer.name ? { name: viewer.name } : {}),
                  verified: false,
                }
              : { kind: "named", ...(viewer.name ? { name: viewer.name } : {}), verified: false },
        signIn: viewer.kind !== "account" && options.signInOffered(),
        ...(policy.footer !== undefined ? { footer: policy.footer } : {}),
        ...(policy.afterSubmit !== undefined ? { afterSubmit: policy.afterSubmit } : {}),
        ...((policy.madeWith?.show ?? options.madeWith !== undefined)
          ? {
              madeWith: {
                ...((policy.madeWith?.href ?? options.madeWith?.href)
                  ? { href: (policy.madeWith?.href ?? options.madeWith?.href) as string }
                  : {}),
              },
            }
          : {}),
        ...(policy.interstitial !== undefined ? { interstitial: policy.interstitial } : {}),
      };
      return chrome;
    },

    async admitSubmit(page, context) {
      const detail = options.artifact(page.artifactId);
      // `hosted.submissions: "signed-in"`: an account, or a link minted for a named person.
      if (detail.manifest?.hosted?.submissions === "signed-in") {
        const viewer = interaction.viewer(page.viewerId);
        const named = context.session?.grant.viewerId !== undefined;
        if (viewer.kind !== "account" && !named) {
          return refuseWith(
            "MOSTRA_REMOTE_SIGN_IN_REQUIRED",
            "This page takes answers from signed-in viewers; sign in, then submit again. The draft is kept.",
            403,
          );
        }
      }
      // The server's rates (D165 item 13), then the operator's `limits`. The rates are taken first,
      // together or not at all (Fable review, 8), so an attempt past them never reaches the
      // operator, concurrent ones included; an attempt the operator then refuses gets its tokens
      // back (second Fable review, 2). Nothing is recorded past either, and the draft is kept.
      const limits = options.rateLimits;
      const wanted: { key: string; rate: NonNullable<typeof limits.perIpSubmissions> }[] = [];
      if (limits.perIpSubmissions) {
        wanted.push({
          key: `submit-ip:${options.clients.keyOf(context.client)}`,
          rate: limits.perIpSubmissions,
        });
      }
      if (limits.perLinkSubmissions && page.tokenId !== undefined) {
        wanted.push({ key: `submit-link:${page.tokenId}`, rate: limits.perLinkSubmissions });
      }
      const taken = options.rates.takeAll(wanted);
      if (!taken.ok) return rateRefusal(taken.retryAfterS);
      // The operator's `limits`: a refusal keeps the draft; no answer lets the submission through.
      const route = options.routeOf(page.artifactId);
      const verdict = await operator.limit({
        account: options.owner().account,
        home: options.homeId,
        artifact: page.artifactId,
        ...(route ? { routeId: route.id } : {}),
        operation: "submit",
      });
      const refused = limitRefusal(verdict);
      if (refused) options.rates.refundAll(wanted);
      return refused;
    },

    shellRoutes,
  };
}

/** A diagnostic for a hosted home this server won't serve now: suspended, or moving. */
export function homeUnavailable(why: "suspended" | "moving"): ReturnType<typeof createDiagnostic> {
  return why === "suspended"
    ? createDiagnostic("MOSTRA_REMOTE_HOME_SUSPENDED", {
        message: "This account's pages are suspended by the server's operator.",
      })
    : createDiagnostic("MOSTRA_REMOTE_HOME_MOVING", {
        message: "This account's pages are moving to another machine; try again in a minute.",
      });
}
