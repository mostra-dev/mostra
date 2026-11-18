/**
 * Where an OAuth client's own pages are (MT-06, INTERFACES §18.5): an operator's own app signs a
 * person out of the server's sign-in from its pages, whose `Origin` must be exactly its metadata
 * document's origin; no other kind of client has pages the server takes a sign-out from.
 */
import { afterEach, describe, expect, it } from "vitest";
import { type Ledger, openLedger } from "../../src/ledger/index.ts";
import { silentLog } from "../../src/log.ts";
import { SERVER_MIGRATIONS } from "../../src/server/directory.ts";
import { createClients, type OAuthClient } from "../../src/server/oauth-clients.ts";
import { tempDir } from "../support.ts";

const open: Ledger[] = [];
afterEach(() => {
  for (const ledger of open.splice(0)) ledger.close();
});

function clients(env: Record<string, string> = {}) {
  const opening = openLedger({
    storeDir: tempDir("oauth-clients-directory"),
    fileName: "server.sqlite",
    runtimeVersion: "1.0.0",
    owner: { pid: process.pid, startTime: "boot/1" },
    log: silentLog,
    migrations: SERVER_MIGRATIONS,
    locking: "normal",
  });
  if (!opening.ok) throw new Error("locked");
  open.push(opening.ledger);
  return createClients({
    directory: opening.ledger,
    log: silentLog,
    env,
    isShellOrigin: () => false,
  });
}

const client = (id: string, kind: OAuthClient["kind"]): OAuthClient => ({
  id,
  kind,
  name: "An app",
  redirectUris: [],
  postLogoutRedirectUris: [],
  trust: kind === "metadata" ? "operator" : "first-party",
});

describe("a client's own pages (MT-06)", () => {
  it("are its metadata document's origin, its port included", () => {
    const all = clients();
    expect(all.pagesOrigin(client("https://account.example/oauth/client.json", "metadata"))).toBe(
      "https://account.example",
    );
    expect(all.pagesOrigin(client("https://account.example:8443/c.json", "metadata"))).toBe(
      "https://account.example:8443",
    );
  });

  it("are none for a registered client, a hosted shell or the CLI", () => {
    const all = clients();
    expect(all.pagesOrigin(client("mcl_0123", "registered"))).toBeUndefined();
    expect(
      all.pagesOrigin(client("https://usercontent.example/_mostra/signin", "shell")),
    ).toBeUndefined();
    expect(all.pagesOrigin(client("mostra-cli", "cli"))).toBeUndefined();
  });

  it("are a test's loopback origin over http only for that one origin", () => {
    const test = clients({ MOSTRA_TEST_CIMD_ORIGIN: "http://localhost:5000" });
    expect(test.pagesOrigin(client("https://localhost:5000/a.json", "metadata"))).toBe(
      "http://localhost:5000",
    );
    expect(test.pagesOrigin(client("https://localhost:5001/a.json", "metadata"))).toBe(
      "https://localhost:5001",
    );
    expect(clients().pagesOrigin(client("https://localhost:5000/a.json", "metadata"))).toBe(
      "https://localhost:5000",
    );
  });
});

describe("the operator's word on a client (MT-06)", () => {
  it("is read from the configuration, once the ID is normalized, and fetches nothing", () => {
    const opening = openLedger({
      storeDir: tempDir("oauth-clients-vouched"),
      fileName: "server.sqlite",
      runtimeVersion: "1.0.0",
      owner: { pid: process.pid, startTime: "boot/1" },
      log: silentLog,
      migrations: SERVER_MIGRATIONS,
      locking: "normal",
    });
    if (!opening.ok) throw new Error("locked");
    open.push(opening.ledger);
    const all = createClients({
      directory: opening.ledger,
      log: silentLog,
      env: {},
      isShellOrigin: () => false,
      operatorClients: [{ clientId: "https://account.example/oauth/client.json", name: "Account" }],
    });
    expect(all.vouches("https://account.example/oauth/client.json")).toBe(true);
    expect(all.vouches("https://ACCOUNT.example:443/oauth/client.json")).toBe(true);
    expect(all.vouches("https://account.example/other.json")).toBe(false);
    expect(all.vouches("mcl_0123")).toBe(false);
    expect(all.vouches("")).toBe(false);
  });
});
