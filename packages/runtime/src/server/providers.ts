/**
 * The remote server's identity providers (INTERFACES §18.5, D165 item 8): the sign-in port's
 * built-in adapters, configured in `identityProviders`, beside those an operator module supplies
 * (asked at every sign-in, so its set can change while the server runs, D167):
 *
 * - `oidc`: any OpenID Connect provider, by its issuer's discovery document; the authorization
 *   code flow with PKCE (S256) and a nonce, and the ID token checked (signature, issuer, audience,
 *   expiry, nonce) by `openid-client`.
 * - `github`: GitHub's OAuth web flow with PKCE, then `GET /user` for the account's stable ID, its
 *   login and name, and its age (`facts.createdAt`) for an operator's policy.
 * - `development`: a page that asks for a name and trusts it, for tests and a self-hoster's first
 *   run; its names are never shown as verified.
 *
 * A provider's client secret is read from `clientSecretFile`, never from the configuration itself,
 * and is never logged.
 */
import { readFileSync } from "node:fs";
import { createDiagnostic, RpcError } from "@mostra/protocol";
import type {
  IdentityProvider,
  SignInContext,
  SignInIdentity,
  SignInPkce,
} from "@mostra/protocol/operator";
import * as oidc from "openid-client";
import type { Environment, Log } from "../log.ts";
import type { IdentityProviderConfig } from "./config.ts";

/** How long a provider's discovery, token exchange or user lookup may take. */
const PROVIDER_TIMEOUT_MS = 8_000;

/** GitHub's endpoints (VERIFIED_FACTS, WP-30). */
const GITHUB = {
  authorize: "https://github.com/login/oauth/authorize",
  token: "https://github.com/login/oauth/access_token",
  user: "https://api.github.com/user",
} as const;

/** A built-in provider: the port's shape, and whether its names are verified. */
export interface BuiltInProvider extends IdentityProvider {
  readonly kind: IdentityProviderConfig["kind"];
  /** Whether the names it gives are verified by someone (all but `development`). */
  readonly verifies: boolean;
}

function invalid(message: string): RpcError {
  return new RpcError(createDiagnostic("MOSTRA_REMOTE_CONFIG_INVALID", { message }));
}

function secretOf(config: IdentityProviderConfig): string {
  if (config.clientSecretFile === undefined) {
    throw invalid(
      `The identity provider \`${config.id}\` needs \`clientSecretFile\`, a file holding its client secret.`,
    );
  }
  try {
    const secret = readFileSync(config.clientSecretFile, "utf8").trim();
    if (secret === "") throw new Error("empty");
    return secret;
  } catch {
    throw invalid(
      `The identity provider \`${config.id}\`'s \`clientSecretFile\` (${config.clientSecretFile}) can't be read, or is empty.`,
    );
  }
}

/** A fetch bounded in time, for a provider's own endpoints. */
async function timedFetch(url: string, init: RequestInit): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS) });
}

/** The OpenID Connect adapter. Discovery happens at the first sign-in and is kept. */
function oidcProvider(config: IdentityProviderConfig, env: Environment): BuiltInProvider {
  if (config.issuer === undefined || config.clientId === undefined) {
    throw invalid(
      `The identity provider \`${config.id}\` (oidc) needs \`issuer\` and \`clientId\`.`,
    );
  }
  const secret = secretOf(config);
  const issuer = new URL(config.issuer);
  // A test provider on loopback speaks http; nothing else may.
  const insecure =
    issuer.protocol === "http:" &&
    env["MOSTRA_TEST_OIDC_INSECURE"] === "1" &&
    (issuer.hostname === "127.0.0.1" || issuer.hostname === "localhost");
  if (issuer.protocol !== "https:" && !insecure) {
    throw invalid(`The identity provider \`${config.id}\`'s \`issuer\` must be an https: URL.`);
  }
  let discovered: Promise<oidc.Configuration> | undefined;
  const configuration = (): Promise<oidc.Configuration> => {
    discovered ??= oidc
      .discovery(
        issuer,
        config.clientId as string,
        undefined,
        oidc.ClientSecretPost(secret),
        insecure ? { execute: [oidc.allowInsecureRequests], timeout: 8 } : { timeout: 8 },
      )
      .catch((error: unknown) => {
        discovered = undefined;
        throw error;
      });
    return discovered;
  };
  return {
    id: config.id,
    label: config.label ?? config.id,
    kind: "oidc",
    verifies: true,
    async authorize(state: string, pkce: SignInPkce, context: SignInContext) {
      const url = oidc.buildAuthorizationUrl(await configuration(), {
        redirect_uri: context.redirectUri,
        scope: "openid email profile",
        state,
        nonce: context.nonce,
        code_challenge: pkce.challenge,
        code_challenge_method: "S256",
      });
      return url.href;
    },
    async callback(params, context) {
      const current = new URL(context.redirectUri);
      for (const [key, value] of Object.entries(params)) current.searchParams.set(key, value);
      const tokens = await oidc.authorizationCodeGrant(await configuration(), current, {
        pkceCodeVerifier: context.pkce.verifier,
        expectedState: context.state,
        expectedNonce: context.nonce,
        idTokenExpected: true,
      });
      const claims = tokens.claims();
      if (!claims) throw new Error("The provider sent no ID token.");
      const name =
        typeof claims["name"] === "string"
          ? claims["name"]
          : typeof claims["preferred_username"] === "string"
            ? claims["preferred_username"]
            : undefined;
      const identity: SignInIdentity = {
        provider: config.id,
        subject: claims.sub,
        ...(typeof claims["email"] === "string" ? { email: claims["email"] } : {}),
        ...(typeof claims["email_verified"] === "boolean"
          ? { emailVerified: claims["email_verified"] }
          : {}),
        ...(name !== undefined ? { name } : {}),
      };
      return identity;
    },
  };
}

/** The GitHub adapter: an OAuth app's web flow with PKCE (VERIFIED_FACTS, WP-30). */
function githubProvider(config: IdentityProviderConfig, env: Environment): BuiltInProvider {
  if (config.clientId === undefined) {
    throw invalid(`The identity provider \`${config.id}\` (github) needs \`clientId\`.`);
  }
  const secret = secretOf(config);
  // Tests point the adapter at a fake GitHub on loopback; nothing else may.
  const base = env["MOSTRA_TEST_GITHUB_BASE"];
  const endpoints =
    base !== undefined && /^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(base)
      ? {
          authorize: `${base}/login/oauth/authorize`,
          token: `${base}/login/oauth/access_token`,
          user: `${base}/user`,
        }
      : GITHUB;
  return {
    id: config.id,
    label: config.label ?? "GitHub",
    kind: "github",
    verifies: true,
    authorize(state, pkce, context) {
      const url = new URL(endpoints.authorize);
      url.searchParams.set("client_id", config.clientId as string);
      url.searchParams.set("redirect_uri", context.redirectUri);
      url.searchParams.set("state", state);
      url.searchParams.set("scope", "");
      url.searchParams.set("allow_signup", "true");
      url.searchParams.set("code_challenge", pkce.challenge);
      url.searchParams.set("code_challenge_method", "S256");
      return url.href;
    },
    async callback(params, context) {
      if (params["error"] !== undefined) {
        throw new Error(`GitHub refused the sign-in (${params["error"]}).`);
      }
      const code = params["code"];
      if (code === undefined) throw new Error("GitHub sent no code.");
      const exchanged = await timedFetch(endpoints.token, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          client_id: config.clientId as string,
          client_secret: secret,
          code,
          redirect_uri: context.redirectUri,
          code_verifier: context.pkce.verifier,
        }).toString(),
      });
      const token = (await exchanged.json().catch(() => ({}))) as {
        access_token?: string;
        error?: string;
      };
      if (!exchanged.ok || typeof token.access_token !== "string") {
        throw new Error(`GitHub's code exchange failed (${token.error ?? exchanged.status}).`);
      }
      const user = await timedFetch(endpoints.user, {
        headers: {
          accept: "application/vnd.github+json",
          authorization: `Bearer ${token.access_token}`,
          "user-agent": "mostra-remote-server",
        },
      });
      const found = (await user.json().catch(() => ({}))) as {
        id?: number;
        login?: string;
        name?: string | null;
        email?: string | null;
        created_at?: string;
      };
      if (!user.ok || typeof found.id !== "number") {
        throw new Error(`GitHub's user lookup failed (${user.status}).`);
      }
      return {
        provider: config.id,
        // The numeric ID: a login can be renamed and then taken by someone else.
        subject: String(found.id),
        ...(typeof found.email === "string" ? { email: found.email } : {}),
        name: found.name ?? found.login ?? String(found.id),
        facts: {
          login: found.login ?? null,
          ...(found.created_at !== undefined ? { createdAt: found.created_at } : {}),
        },
      };
    },
  };
}

/**
 * The development adapter: the device page and the sign-in page ask for a name and trust it
 * (D166 item 4). Its `authorize` sends the person to the server's own name page.
 */
function developmentProvider(config: IdentityProviderConfig, apiOrigin: string): BuiltInProvider {
  return {
    id: config.id,
    label: config.label ?? "Development sign-in",
    kind: "development",
    verifies: false,
    authorize(state) {
      const url = new URL(`${apiOrigin}/signin/${config.id}/name`);
      url.searchParams.set("state", state);
      return url.href;
    },
    async callback(params) {
      const name = (params["name"] ?? "").trim().slice(0, 64);
      if (name === "") throw new Error("No name was given.");
      return { provider: config.id, subject: name.toLowerCase(), name };
    },
  };
}

/** Builds the configured providers; a provider it can't use stops the server, naming it. */
export function builtInProviders(
  configs: readonly IdentityProviderConfig[],
  options: { readonly apiOrigin: string; readonly env: Environment; readonly log: Log },
): BuiltInProvider[] {
  const seen = new Set<string>();
  return configs.map((config) => {
    if (seen.has(config.id)) throw invalid(`Two identity providers are named \`${config.id}\`.`);
    seen.add(config.id);
    const provider =
      config.kind === "oidc"
        ? oidcProvider(config, options.env)
        : config.kind === "github"
          ? githubProvider(config, options.env)
          : developmentProvider(config, options.apiOrigin);
    options.log.info("signin.provider", { id: config.id, kind: config.kind });
    return provider;
  });
}
