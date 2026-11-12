/**
 * The remote server's configuration of an OpenID Connect provider's chosen claims (MT-03,
 * INTERFACES §18.1, §18.5): `claims` names a few short ID-token claims of an `oidc` entry; any other
 * kind, or a name that isn't one, stops the server before it serves anything, naming the key.
 */
import { RpcError } from "@mostra/protocol";
import { describe, expect, it } from "vitest";
import { readServerConfig } from "../../src/server/config.ts";

const base = {
  apiOrigin: "https://api.example",
  domains: { active: "usercontent.example" },
};

/** Reads a configuration given as `MOSTRA_SERVER_IDENTITY_PROVIDERS`; its error's message. */
const read = (identityProviders: unknown): string | undefined => {
  try {
    readServerConfig(undefined, {
      MOSTRA_SERVER_API_ORIGIN: base.apiOrigin,
      MOSTRA_SERVER_DOMAINS: JSON.stringify(base.domains),
      MOSTRA_SERVER_IDENTITY_PROVIDERS: JSON.stringify(identityProviders),
    });
    return undefined;
  } catch (error) {
    if (!(error instanceof RpcError)) throw error;
    return `${error.diagnostic.code}: ${error.diagnostic.message}`;
  }
};

const oidc = { id: "google", kind: "oidc", issuer: "https://accounts.google.com", clientId: "c" };

describe("an oidc provider's chosen claims (MT-03)", () => {
  it("takes a few claim names on an oidc entry", () => {
    expect(read([{ ...oidc, claims: ["hd"] }])).toBeUndefined();
    expect(read([{ ...oidc, claims: ["hd", "groups", "urn:zitadel:iam:org:id", "x.y-z_1"] }])).toBe(
      undefined,
    );
  });

  it("refuses claims on any other kind, too many, none, or a name that isn't one", () => {
    expect(read([{ id: "github", kind: "github", clientId: "c", claims: ["hd"] }])).toMatch(
      /^MOSTRA_REMOTE_CONFIG_INVALID: .*identityProviders\.0\.claims.*only an `oidc` provider/,
    );
    expect(read([{ ...oidc, claims: [] }])).toMatch(
      /^MOSTRA_REMOTE_CONFIG_INVALID: .*identityProviders\.0\.claims/,
    );
    expect(read([{ ...oidc, claims: Array.from({ length: 9 }, (_, n) => `c${n}`) }])).toMatch(
      /^MOSTRA_REMOTE_CONFIG_INVALID: .*identityProviders\.0\.claims/,
    );
    for (const name of ["", "has space", "9starts-with-digit", "x".repeat(65), "a/b"]) {
      expect(read([{ ...oidc, claims: [name] }]), name).toMatch(
        /^MOSTRA_REMOTE_CONFIG_INVALID: .*identityProviders\.0\.claims\.0/,
      );
    }
  });
});
