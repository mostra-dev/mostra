/**
 * A hosted home's MCP Apps (D175 item 8, `server/app-pages.ts`): the home makes each version's
 * page itself, once however many ask at a time, and keeps the first one made, as one whole file.
 * It never answers or keeps a page for a version under review or removed, also when the review or
 * the removal came while the page was being made (review findings R01-2, R01-8, R02-18).
 */
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type AppPageResult, RpcError } from "@mostra/protocol";
import { describe, expect, it } from "vitest";
import { silentLog } from "../../src/log.ts";
import { createAppPages } from "../../src/server/app-pages.ts";

const VERSION = "ver_0123456789ABCDEFGHJKMNPQRS";
const ARTIFACT = "art_01JB8Z3QF6S7W3N8D5K2C4V9XG";

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "mostra-app-pages-"));
  const state = { quarantined: false, hosted: true, made: 0 };
  // Each making waits until the test lets it end, so a review or removal can come meanwhile.
  let finish: (() => void) | undefined;
  let hold = false;
  const pages = createAppPages({
    dir,
    log: silentLog,
    artifactOf: (versionId) => (state.hosted && versionId === VERSION ? ARTIFACT : undefined),
    underReview: () => state.quarantined,
    make: async (artifactId, versionId): Promise<AppPageResult> => {
      state.made += 1;
      if (hold) await new Promise<void>((resolve) => (finish = resolve));
      return {
        artifactId,
        uri: `ui://mostra/view/${versionId}`,
        html: `<!doctype html><title>page ${state.made}</title>`,
        meta: { prefersBorder: true },
      };
    },
  });
  const holding = () => {
    hold = true;
  };
  const release = () => {
    hold = false;
    finish?.();
  };
  return { dir, pages, state, holding, release };
}

async function code(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    return error instanceof RpcError ? error.diagnostic.code : String(error);
  }
}

describe("a hosted home's MCP Apps (D175 item 8)", () => {
  it("makes a version's page once for every caller at a time, and keeps it as one file", async () => {
    const { dir, pages, state } = setup();
    const [first, second] = await Promise.all([pages.page(VERSION), pages.page(VERSION)]);
    expect(state.made).toBe(1);
    expect(first.html).toBe("<!doctype html><title>page 1</title>");
    expect(second).toEqual(first);
    expect(first.meta).toEqual({ prefersBorder: true });
    // Kept whole, in one file, with nothing written aside left over.
    expect(readdirSync(join(dir, "pages"))).toEqual([`${VERSION}.json`]);
    const kept = JSON.parse(readFileSync(join(dir, "pages", `${VERSION}.json`), "utf8"));
    expect(kept).toEqual({ html: first.html, meta: first.meta });
    // Answered from the file later: nothing is made again.
    expect((await pages.page(VERSION)).html).toBe(first.html);
    expect(state.made).toBe(1);
  });

  it("refuses an unknown version and a quarantined one before it makes anything", async () => {
    const { pages, state } = setup();
    expect(await code(pages.page("ver_ZZZZZZZZZZZZZZZZZZZZZZZZZZ"))).toBe(
      "MOSTRA_ARTIFACT_VERSION_NOT_FOUND",
    );
    state.quarantined = true;
    expect(await code(pages.page(VERSION))).toBe("MOSTRA_REMOTE_UNDER_REVIEW");
    expect(state.made).toBe(0);
  });

  it("shows and keeps nothing of a page made while its version was quarantined (R01-8)", async () => {
    const { dir, pages, state, holding, release } = setup();
    holding();
    const asked = code(pages.page(VERSION));
    await new Promise((resolve) => setTimeout(resolve, 10));
    state.quarantined = true;
    release();
    expect(await asked).toBe("MOSTRA_REMOTE_UNDER_REVIEW");
    expect(readdirSync(dir)).not.toContain("pages");
  });

  it("keeps nothing of a page made while its version was removed, and makes it afresh if it's shared again (R01-8)", async () => {
    const { dir, pages, state, holding, release } = setup();
    holding();
    const asked = code(pages.page(VERSION));
    await new Promise((resolve) => setTimeout(resolve, 10));
    await pages.forget(VERSION);
    release();
    expect(await asked).toBe("MOSTRA_ARTIFACT_VERSION_NOT_FOUND");
    expect(readdirSync(dir)).not.toContain("pages");
    // The same artifact shared again: the version is back, and its page is made for it.
    expect((await pages.page(VERSION)).html).toBe("<!doctype html><title>page 2</title>");
    expect(state.made).toBe(2);
  });

  it("removes a kept page with its version", async () => {
    const { dir, pages, state } = setup();
    await pages.page(VERSION);
    await pages.forget(VERSION);
    state.hosted = false;
    expect(readdirSync(join(dir, "pages"))).toEqual([]);
    expect(await code(pages.page(VERSION))).toBe("MOSTRA_ARTIFACT_VERSION_NOT_FOUND");
  });
});
