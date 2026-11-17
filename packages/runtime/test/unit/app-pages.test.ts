/**
 * A hosted home's MCP Apps (D175 item 8, `server/app-pages.ts`): which pages it keeps, from whom,
 * and what it answers for each version: a kept page; else the connected owner's, kept for later;
 * else owner-offline. Never a quarantined page, never one an instance other than the owner sent,
 * never an owner's answer for another artifact, never a page that isn't an MCP App document.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RpcError } from "@mostra/protocol";
import { describe, expect, it } from "vitest";
import { silentLog } from "../../src/log.ts";
import { createAppPages } from "../../src/server/app-pages.ts";

const VERSION = "ver_0123456789ABCDEFGHJKMNPQRS";
const ARTIFACT = "art_01JB8Z3QF6S7W3N8D5K2C4V9XG";
const PAGE = "<!doctype html><title>page</title>";

function setup(options: { connected?: boolean; quarantined?: boolean; answer?: unknown } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "mostra-app-pages-"));
  const asked: unknown[] = [];
  const pages = createAppPages({
    dir,
    log: silentLog,
    artifactOf: (versionId) => (versionId === VERSION ? ARTIFACT : undefined),
    ownerOf: (artifactId) => (artifactId === ARTIFACT ? "lnk_owner" : undefined),
    underReview: () => options.quarantined === true,
    sessionOf: (link) => (link === "lnk_owner" && options.connected !== false ? 7 : undefined),
    call: async (session, method, params) => {
      asked.push({ session, method, params });
      return options.answer ?? { artifactId: ARTIFACT, html: PAGE, meta: { prefersBorder: false } };
    },
  });
  return { pages, asked };
}

async function code(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return "none";
  } catch (error) {
    return error instanceof RpcError ? error.diagnostic.code : String(error);
  }
}

describe("a hosted home's MCP Apps (D175 item 8)", () => {
  it("keeps the owner's page and answers it, with the owner away", async () => {
    const { pages, asked } = setup({ connected: false });
    const kept = await pages.keep(
      {
        versionId: VERSION,
        html: PAGE,
        meta: { csp: { connectDomains: ["https://api.example"] } },
      },
      "lnk_owner",
    );
    expect(kept.sha256).toMatch(/^[0-9a-f]{64}$/);
    await expect(pages.page(VERSION)).resolves.toEqual({
      artifactId: ARTIFACT,
      uri: `ui://mostra/view/${VERSION}`,
      html: PAGE,
      meta: { csp: { connectDomains: ["https://api.example"] } },
    });
    expect(asked).toEqual([]);
  });

  it("takes a page from the artifact's owner instance only", async () => {
    const { pages } = setup();
    expect(
      await code(pages.keep({ versionId: VERSION, html: PAGE, meta: {} }, "lnk_someone_else")),
    ).toBe("MOSTRA_REMOTE_NOT_OWNER_INSTANCE");
    expect(
      await code(
        pages.keep(
          { versionId: "ver_ABCDEFGHJKMNPQRSTVWXYZ0123", html: PAGE, meta: {} },
          "lnk_owner",
        ),
      ),
    ).toBe("MOSTRA_ARTIFACT_VERSION_NOT_FOUND");
    expect(
      await code(pages.keep({ versionId: VERSION, html: "not html", meta: {} }, "lnk_owner")),
    ).toBe("MOSTRA_HOME_INTEGRITY");
  });

  it("asks the connected owner for a page it lacks, once for callers at the same time, and keeps it", async () => {
    const { pages, asked } = setup();
    const [first, second] = await Promise.all([pages.page(VERSION), pages.page(VERSION)]);
    expect(first.html).toBe(PAGE);
    expect(second.html).toBe(PAGE);
    expect(asked).toEqual([
      {
        session: 7,
        method: "port/relay.author",
        params: { method: "app/page", params: { versionId: VERSION } },
      },
    ]);
    await pages.page(VERSION);
    expect(asked).toHaveLength(1);
  });

  it("answers owner-offline for a page it lacks with the owner away", async () => {
    const { pages } = setup({ connected: false });
    expect(await code(pages.page(VERSION))).toBe("MOSTRA_REMOTE_OWNER_OFFLINE");
  });

  it("refuses an owner's answer for another artifact, or one that isn't an MCP App", async () => {
    const other = setup({ answer: { artifactId: "art_OTHER", html: PAGE, meta: {} } });
    expect(await code(other.pages.page(VERSION))).toBe("MOSTRA_HOME_INTEGRITY");
    const broken = setup({ answer: { artifactId: ARTIFACT, html: "<p>no", meta: {} } });
    expect(await code(broken.pages.page(VERSION))).toBe("MOSTRA_HOME_INTEGRITY");
  });

  it("shows no page of a quarantined artifact or version", async () => {
    const { pages, asked } = setup({ quarantined: true });
    expect(await code(pages.page(VERSION))).toBe("MOSTRA_REMOTE_UNDER_REVIEW");
    expect(asked).toEqual([]);
  });
});
