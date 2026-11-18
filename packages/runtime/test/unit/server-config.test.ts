/**
 * The remote server's configuration of an OpenID Connect provider's chosen claims (MT-03,
 * INTERFACES §18.1, §18.5): `claims` names a few short ID-token claims of an `oidc` entry; any other
 * kind, or a name that isn't one, stops the server before it serves anything, naming the key. And
 * the operator's own clients (`operatorClients`, MT-05): a few metadata-document client IDs, each
 * written as its URL normalizes it, with a name the consent page can show as it reads.
 */
import { RpcError } from "@mostra/protocol";
import { describe, expect, it } from "vitest";
import { readServerConfig, verifierLabel } from "../../src/server/config.ts";

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
    // A name that reaches an object's prototype rather than a key of its own (the Opus review).
    for (const name of [
      "",
      "has space",
      "9starts-with-digit",
      "x".repeat(65),
      "a/b",
      "__proto__",
      "constructor",
      "prototype",
    ]) {
      expect(read([{ ...oidc, claims: [name] }]), name).toMatch(
        /^MOSTRA_REMOTE_CONFIG_INVALID: .*identityProviders\.0\.claims\.0/,
      );
    }
  });
});

describe("a verifier's label (MT-03)", () => {
  it("is text the sender line can show as it reads", () => {
    expect(verifierLabel("GitHub")).toBe("GitHub");
    expect(verifierLabel("Acme SSO")).toBe("Acme SSO");
    expect(verifierLabel("Ünïcode Ltd.")).toBe("Ünïcode Ltd.");
  });

  it("is none when it is empty, too long, not text, or holds control or format characters", () => {
    for (const label of [
      "",
      "   ",
      "x".repeat(65),
      42,
      undefined,
      "\u202EbuHtiG", // a right-to-left override: renders as "GitHub"
      "Git\u200DHub", // a zero-width joiner
      "Git\nHub",
      "Git\u2028Hub",
      "Git\u0000Hub",
    ]) {
      expect(verifierLabel(label), JSON.stringify(label)).toBeUndefined();
    }
  });
});

/** Reads a configuration given as `MOSTRA_SERVER_OPERATOR_CLIENTS`; its error's message. */
const readClients = (operatorClients: unknown): string | undefined => {
  try {
    readServerConfig(undefined, {
      MOSTRA_SERVER_API_ORIGIN: base.apiOrigin,
      MOSTRA_SERVER_DOMAINS: JSON.stringify(base.domains),
      MOSTRA_SERVER_OPERATOR_CLIENTS: JSON.stringify(operatorClients),
    });
    return undefined;
  } catch (error) {
    if (!(error instanceof RpcError)) throw error;
    return `${error.diagnostic.code}: ${error.diagnostic.message}`;
  }
};

describe("an operator's own clients (MT-05)", () => {
  const account = {
    clientId: "https://account.example/oauth-client.json",
    name: "Example account",
  };

  it("takes a few metadata-document clients, each with its name", () => {
    expect(readClients([account])).toBeUndefined();
    expect(
      readClients([account, { clientId: "https://example.com/apps/billing?v=1", name: "Billing" }]),
    ).toBeUndefined();
  });

  it("refuses a client that isn't a metadata document's normal URL, a name it can't show, or one named twice", () => {
    for (const [entry, key] of [
      [{ ...account, clientId: "http://account.example/oauth-client.json" }, "0.clientId"],
      [{ ...account, clientId: "https://account.example/" }, "0.clientId"],
      [{ ...account, clientId: "https://account.example/c.json#x" }, "0.clientId"],
      [{ ...account, clientId: "https://Account.Example/c.json" }, "0.clientId"],
      [{ ...account, clientId: "https://account.example/a/../c.json" }, "0.clientId"],
      [{ ...account, clientId: "mcl_0123" }, "0.clientId"],
      [{ ...account, clientId: "https://10.0.0.5/client.json" }, "0.clientId"],
      [{ ...account, clientId: "https://[::1]/client.json" }, "0.clientId"],
      [{ ...account, name: "" }, "0.name"],
      [{ ...account, name: "x".repeat(65) }, "0.name"],
      [{ ...account, name: "Example\u202Etnuocca" }, "0.name"],
      [{ clientId: account.clientId }, "0.name"],
      [{ ...account, verified: true }, "0"],
    ] as const) {
      expect(readClients([entry]), JSON.stringify(entry)).toMatch(
        new RegExp(
          `^MOSTRA_REMOTE_CONFIG_INVALID: The configuration key \`operatorClients\\.${key.replace(".", "\\.")}`,
        ),
      );
    }
    expect(readClients([])).toMatch(/`operatorClients`/);
    expect(
      readClients(
        Array.from({ length: 17 }, (_, i) => ({
          ...account,
          clientId: `${account.clientId}?${i}`,
        })),
      ),
    ).toMatch(/`operatorClients`/);
    expect(readClients([account, { ...account, name: "Again" }])).toBe(
      "MOSTRA_REMOTE_CONFIG_INVALID: The configuration key `operatorClients.1.clientId` names a client an earlier entry names.",
    );
    // A tenant's page, or a hosted shell's own client, on the user-content domain or under it.
    for (const clientId of [
      "https://usercontent.example/_mostra/signin",
      "https://abcdefghijklmnopqrstuvwxyz.usercontent.example/client.json",
    ]) {
      expect(readClients([account, { clientId, name: "Tenant" }]), clientId).toBe(
        "MOSTRA_REMOTE_CONFIG_INVALID: The configuration key `operatorClients.1.clientId` is on a user-content domain, whose pages are the tenants'.",
      );
    }
  });
});
