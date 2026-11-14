/**
 * Teams through a real `mostra-runtime daemon` (WP-31, D168): expected respondents with personal
 * links over the host protocol (CO-01), the `submitted:all` and `submitted:<N>` waits with the
 * durable roster events (CO-02), each respondent's status to hosts and to pages (CO-03), presence
 * between pages over the browser protocol, rate-limited and never stored (CO-04), attribution of a
 * shared field (CO-05), and what each visibility setting lets a page see (CO-07).
 */
import { cpSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BROWSER_PROTOCOL_REVISION, MutationId } from "@mostra/protocol";
import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Answer, Browser, type Opened, openLink } from "../browser-client.ts";
import { GatewayHome, ok, refused } from "../gateway-home.ts";
import { tempDir } from "../support.ts";

const V = BROWSER_PROTOCOL_REVISION;
const FIXTURE = join(import.meta.dirname, "..", "fixtures", "artifacts", "team");

/** A respondent's page in its own browser: posts to its frame with its session's CSRF token. */
class Page {
  readonly browser: Browser;
  readonly opened: Opened;

  constructor(browser: Browser, opened: Opened) {
    this.browser = browser;
    this.opened = opened;
  }

  post(path: string, body: unknown): Promise<Answer> {
    return this.browser.fetchJson(this.opened.frameOrigin, `/_mostra/v/${V}/${path}`, {
      body,
      csrf: this.opened.frameCsrf,
    });
  }

  poll(cursor?: string, wait = 0): Promise<Answer> {
    const query = `view=${this.opened.viewId}&wait=${wait}${cursor !== undefined ? `&cursor=${cursor}` : ""}`;
    return this.browser.fetchJson(this.opened.frameOrigin, `/_mostra/v/${V}/events/poll?${query}`);
  }

  async snapshot(): Promise<{
    cursor: string;
    viewer: { id: string; name?: string };
    draft: { revision: string };
    state: { revision: string; fields: Record<string, { updatedBy?: Record<string, unknown> }> };
  }> {
    const answer = await this.poll();
    expect(answer.status).toBe(200);
    return (answer.json() as { snapshot: never }).snapshot;
  }

  respondents(): Promise<Answer> {
    return this.post("respondents", { viewId: this.opened.viewId });
  }

  presence(body: Record<string, unknown>): Promise<Answer> {
    return this.post("presence", { viewId: this.opened.viewId, ...body });
  }

  async submit(): Promise<Answer> {
    const snapshot = await this.snapshot();
    return this.post("submit", {
      viewId: this.opened.viewId,
      expectedRevision: snapshot.draft.revision,
      channel: "artifact",
    });
  }

  /** The ephemeral messages of `kind` this page's polls bring within `ms`. */
  async ephemeral(kind: string, ms = 2_000): Promise<Record<string, unknown>[]> {
    const found: Record<string, unknown>[] = [];
    let cursor = (await this.snapshot()).cursor;
    const until = Date.now() + ms;
    while (Date.now() < until) {
      const answer = await this.poll(cursor, 1);
      const body = answer.json() as {
        cursor: string;
        ephemeral?: { kind: string; [key: string]: unknown }[];
      };
      cursor = body.cursor ?? cursor;
      for (const message of body.ephemeral ?? []) if (message.kind === kind) found.push(message);
      if (found.length > 0) break;
    }
    return found;
  }
}

async function page(url: string): Promise<Page> {
  const browser = new Browser();
  return new Page(browser, await openLink(browser, url));
}

/** Publishes a copy of the team fixture with `visibility` in its manifest. */
async function publishTeam(
  gateway: GatewayHome,
  visibility: "private" | "counts" | "names",
  policy?: unknown,
): Promise<{ artifactId: string; url: string }> {
  const dir = join(tempDir(`team-${visibility}`), "team");
  cpSync(FIXTURE, dir, { recursive: true });
  const entry = join(dir, "index.tsx");
  writeFileSync(
    entry,
    readFileSync(entry, "utf8").replace('visibility: "names"', `visibility: "${visibility}"`),
  );
  const receipt = ok<{ artifactId: string; url: string }>(
    await gateway.client.call(
      "artifact/publish",
      { source: { path: dir }, ...(policy !== undefined ? { policy } : {}) },
      120_000,
    ),
  );
  return receipt;
}

interface RosterAnswer {
  roster: {
    round: number;
    complete: boolean;
    counts: { total: number; notOpened: number; drafting: number; submitted: number };
    respondents: { ref: string; viewerId: string; status: string; tokenId?: string }[];
  };
  links: { ref: string; link: { url: string; tokenId: string; viewer?: { id: string } } }[];
}

const FIVE = ["ada", "grace", "edsger", "barbara", "alan"].map((name) => ({
  ref: `${name}@example.com`,
  name: name[0]?.toUpperCase() + name.slice(1),
}));

describe("expected respondents and their personal links (CO-01, CO-02, CO-03)", () => {
  const gateway = new GatewayHome();

  beforeAll(() => gateway.start(), 180_000);
  afterAll(() => gateway.stop());

  /** A team form of its own for each case: its roster of five and each one's page, open. */
  async function five(requestId?: string) {
    const { artifactId } = await publishTeam(gateway, "names");
    const added = ok<RosterAnswer>(
      await gateway.client.call("roster/add", {
        artifact: { artifactId },
        respondents: FIVE,
        ...(requestId !== undefined ? { requestId } : {}),
      }),
    );
    const pages = new Map<string, Page>();
    for (const entry of added.links) pages.set(entry.ref, await page(entry.link.url));
    return { artifactId, added, pages };
  }

  it("gives a roster of five five personal links that act as five viewers, and its changes are events", async () => {
    const { artifactId, added, pages } = await five("add-five");
    expect(added.links.map((entry) => entry.ref)).toEqual(FIVE.map((one) => one.ref));
    expect(new Set(added.links.map((entry) => entry.link.tokenId)).size).toBe(5);
    expect(added.roster.counts).toEqual({ total: 5, notOpened: 5, drafting: 0, submitted: 0 });
    // Each link opens as its respondent: five pages, five viewers, the roster's own.
    const viewers = new Map<string, string>();
    for (const entry of added.links) {
      const snapshot = await (pages.get(entry.ref) as Page).snapshot();
      viewers.set(entry.ref, snapshot.viewer.id);
    }
    expect(new Set(viewers.values()).size).toBe(5);
    for (const respondent of added.roster.respondents) {
      expect(viewers.get(respondent.ref)).toBe(respondent.viewerId);
    }
    // The same call again replays its links; adding the same people again keeps them.
    const replay = ok<RosterAnswer>(
      await gateway.client.call("roster/add", {
        artifact: { artifactId },
        respondents: FIVE,
        requestId: "add-five",
      }),
    );
    expect(replay.links.map((entry) => entry.link.url)).toEqual(
      added.links.map((entry) => entry.link.url),
    );
    const again = ok<RosterAnswer>(
      await gateway.client.call("roster/add", { artifact: { artifactId }, respondents: FIVE }),
    );
    expect(again.links.map((entry) => entry.link.tokenId)).toEqual(
      added.links.map((entry) => entry.link.tokenId),
    );
    // Roster changes are durable events hosts read; pages never see them.
    const events = ok<{ events: { type: string; payload: Record<string, unknown> }[] }>(
      await gateway.client.call("events/read", {
        filter: { artifacts: [artifactId], types: ["roster.*"] },
      }),
    );
    expect(events.events.map((event) => event.type)).toEqual(["roster.changed"]);
    expect(events.events[0]?.payload["added"]).toHaveLength(5);
    const seen = await (pages.get("ada@example.com") as Page).poll("0");
    expect(seen.body).not.toContain("roster.");
  });

  it("keeps a re-added respondent's link only while it is the one the request would mint (Opus review 6)", async () => {
    const { artifactId } = await publishTeam(gateway, "names");
    const add = async (extra: Record<string, unknown>) => {
      const answer = ok<RosterAnswer>(
        await gateway.client.call("roster/add", {
          artifact: { artifactId },
          respondents: [{ ref: "ada@example.com", name: "Ada" }],
          ...extra,
        }),
      );
      return answer.links[0]?.link.tokenId as string;
    };
    const first = await add({});
    expect(await add({})).toBe(first);
    // Each step changes one thing, and each gets a new link for the same respondent: other scopes
    // (the same ones in another order and without `view` are the same), a pinned version, an expiry.
    const scopes = ["view", "draft", "submit"];
    const narrow = await add({ scopes });
    expect(narrow).not.toBe(first);
    expect(await add({ scopes: ["submit", "draft"] })).toBe(narrow);
    const pinned = await add({ scopes, version: 1 });
    expect(pinned).not.toBe(narrow);
    expect(await add({ scopes, version: 1 })).toBe(pinned);
    const expiring = await add({ scopes, version: 1, ttl: "7d" });
    expect(expiring).not.toBe(pinned);
    expect(await add({ scopes, version: 1, ttl: "7d" })).toBe(expiring);
    // The roster names the newest; the replaced links weren't revoked, since Ada may hold them.
    const roster = ok<RosterAnswer["roster"]>(
      await gateway.client.call("roster/get", { artifact: { artifactId } }),
    );
    expect(roster.respondents[0]?.tokenId).toBe(expiring);
    const events = ok<{ events: { payload: Record<string, unknown> }[] }>(
      await gateway.client.call("events/read", {
        filter: { artifacts: [artifactId], types: ["roster.changed"] },
      }),
    );
    expect(
      events.events.filter((event) => (event.payload["relinked"] as unknown[] | undefined)?.length),
    ).toHaveLength(3);
  });

  it("shows each respondent's status alike to hosts and to pages", async () => {
    const { artifactId, pages } = await five();
    await (pages.get("ada@example.com") as Page).submit();
    const roster = ok<RosterAnswer["roster"]>(
      await gateway.client.call("roster/get", { artifact: { artifactId } }),
    );
    expect(Object.fromEntries(roster.respondents.map((one) => [one.ref, one.status]))).toEqual({
      "ada@example.com": "submitted",
      "grace@example.com": "drafting",
      "edsger@example.com": "drafting",
      "barbara@example.com": "drafting",
      "alan@example.com": "drafting",
    });
    const fromPage = await (pages.get("grace@example.com") as Page).respondents();
    expect(fromPage.status).toBe(200);
    const body = fromPage.json() as {
      counts: Record<string, number>;
      respondents: { name: string; status: string; self: boolean; key: string }[];
      self: { name: string };
    };
    expect(body.counts).toEqual({ total: 5, notOpened: 0, drafting: 4, submitted: 1 });
    expect(body.self.name).toBe("Grace");
    expect(body.respondents.map((one) => [one.name, one.status])).toEqual(
      roster.respondents.map((one, index) => [FIVE[index]?.name, one.status]),
    );
    // A page learns no one's ref or viewer ID.
    const text = JSON.stringify(body);
    for (const one of roster.respondents) {
      expect(text).not.toContain(one.ref);
      expect(text).not.toContain(one.viewerId);
    }
  });

  it("satisfies submitted:all exactly when the last respondent submits, and submitted:<N> at the N-th", async () => {
    const { artifactId, pages } = await five();
    expect((await (pages.get("ada@example.com") as Page).submit()).status).toBe(200);
    const waiting = gateway.client.call(
      "wait",
      { artifact: { artifactId }, until: "submitted:all", timeoutMs: 60_000 },
      70_000,
    );
    const third = gateway.client.call(
      "wait",
      { artifact: { artifactId }, until: "submitted:3", timeoutMs: 60_000 },
      70_000,
    );
    let settled = false;
    void waiting.then(() => {
      settled = true;
    });
    for (const ref of ["grace@example.com", "edsger@example.com", "barbara@example.com"]) {
      expect((await (pages.get(ref) as Page).submit()).status).toBe(200);
    }
    const counted = ok<{ status: string; event: { type: string } }>(await third);
    expect(counted.status).toBe("satisfied");
    expect(counted.event.type).toBe("submission.created");
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(settled).toBe(false);
    expect((await (pages.get("alan@example.com") as Page).submit()).status).toBe(200);
    const all = ok<{
      status: string;
      event: { type: string; payload: { submissions: unknown[] } };
    }>(await waiting);
    expect(all.status).toBe("satisfied");
    expect(all.event.type).toBe("roster.completed");
    expect(all.event.payload.submissions).toHaveLength(5);
    // Every answer the completion counts is there to read.
    const listed = ok<{ results: { submission: { id: string } }[]; more: boolean }>(
      await gateway.client.call("results/list", { artifact: { artifactId } }),
    );
    expect(listed.results).toHaveLength(5);
    expect(listed.more).toBe(false);
    const roster = ok<RosterAnswer["roster"]>(
      await gateway.client.call("roster/get", { artifact: { artifactId } }),
    );
    expect(roster.complete).toBe(true);
    // Waiting again with no cursor answers at once (once per-viewer is level-triggered).
    const now = ok<{ status: string }>(
      await gateway.client.call("wait", {
        artifact: { artifactId },
        until: "submitted:all",
        timeoutMs: 0,
      }),
    );
    expect(now.status).toBe("satisfied");
  });

  it("refuses the team waits an artifact's policy can never meet", async () => {
    const perArtifact = await publishTeam(gateway, "private", {
      policy: "once",
      scope: "per-artifact",
    });
    expect(
      refused(
        await gateway.client.call("wait", {
          artifact: { artifactId: perArtifact.artifactId },
          until: "submitted:all",
          timeoutMs: 0,
        }),
      ),
    ).toBe("MOSTRA_TEAM_ROSTER_POLICY");
  });
});

describe("presence, attribution and visibility between pages (CO-04, CO-05, CO-07)", () => {
  const gateway = new GatewayHome();

  beforeAll(() => gateway.start(), 180_000);
  afterAll(() => gateway.stop());

  async function team(visibility: "private" | "counts" | "names", count: number) {
    const { artifactId } = await publishTeam(gateway, visibility);
    const added = ok<RosterAnswer>(
      await gateway.client.call("roster/add", {
        artifact: { artifactId },
        respondents: FIVE.slice(0, count),
      }),
    );
    const pages: Page[] = [];
    for (const entry of added.links) pages.push(await page(entry.link.url));
    return { artifactId, pages };
  }

  it("carries cursors between three viewers within the rate, refuses past it, and stops sharing when a viewer leaves", async () => {
    const { pages } = await team("names", 3);
    const [ada, grace, edsger] = pages as [Page, Page, Page];
    for (const [index, one] of pages.entries()) {
      const answer = await one.presence({ cursor: { x: 100 + index, y: 200 + index } });
      expect(answer.status).toBe(200);
    }
    // Each sees the other two, by name, with their cursors.
    const state = (await ada.presence({})).json() as {
      peers: { name?: string; self: boolean; cursor?: { x: number } }[];
      others: number;
    };
    expect(state.others).toBe(2);
    expect(
      state.peers
        .filter((peer) => !peer.self)
        .map((peer) => [peer.name, peer.cursor?.x])
        .sort(),
    ).toEqual([
      ["Edsger", 102],
      ["Grace", 101],
    ]);
    // A moving cursor reaches another page as an ephemeral message on its own poll.
    const heard = grace.ephemeral("presence", 3_000);
    await edsger.presence({ cursor: { x: 555, y: 9 } });
    const messages = await heard;
    expect(messages.length).toBeGreaterThan(0);
    expect(JSON.stringify(messages.at(-1))).toContain("555");
    // Past 20 updates a second, a view is refused with Retry-After; nothing else changes.
    const burst = await Promise.all(
      Array.from({ length: 40 }, (_, index) => edsger.presence({ cursor: { x: index, y: 0 } })),
    );
    const limited = burst.filter((answer) => answer.status === 429);
    expect(limited.length).toBeGreaterThan(0);
    expect(limited[0]?.header("retry-after")).toBeDefined();
    const refusal = limited[0]?.json() as { code?: string } | undefined;
    expect(refusal?.code).toBe("MOSTRA_TEAM_PRESENCE_RATE_LIMITED");
    // Opting out: a viewer that leaves is gone for the others at once.
    expect((await edsger.presence({ leave: true })).status).toBe(200);
    expect(((await ada.presence({})).json() as { others: number }).others).toBe(1);
  });

  it("holds no presence in the ledger, ever", async () => {
    const { pages } = await team("names", 2);
    const marker = "presence-marker-31";
    for (const one of pages) {
      await one.presence({ cursor: { x: 73_137, y: 31_031 }, selection: { element: marker } });
    }
    await gateway.stop();
    // Every table and every text value: the cursor, the selection and the marker appear nowhere.
    const ledger = new Database(join(gateway.home.home, "store", "ledger.sqlite"), {
      readonly: true,
    });
    try {
      const tables = ledger
        .prepare("SELECT name FROM sqlite_schema WHERE type = 'table'")
        .all() as { name: string }[];
      expect(tables.map((table) => table.name).filter((name) => /presence/i.test(name))).toEqual(
        [],
      );
      for (const { name } of tables) {
        for (const row of ledger.prepare(`SELECT * FROM "${name}"`).all()) {
          const text = JSON.stringify(row);
          expect(text).not.toContain(marker);
          // The cursor's numbers as values of their own: a hash or an ID in hexadecimal or base32
          // may hold the same digits inside it by chance (seen in CI, a token's secret_hash).
          expect(text).not.toMatch(/(?<![0-9A-Za-z])73137(?![0-9A-Za-z])/);
          expect(text).not.toMatch(/(?<![0-9A-Za-z])31031(?![0-9A-Za-z])/);
        }
      }
    } finally {
      ledger.close();
      await gateway.start();
    }
  });

  it("shows each viewer who changed a shared field and when, by name and by the same key as the roster", async () => {
    const { pages } = await team("names", 2);
    const [ada, grace] = pages as [Page, Page];
    const write = async (who: Page, value: string) => {
      const snapshot = await who.snapshot();
      const answer = await who.post("fields", {
        mutationId: MutationId.create(),
        scope: "artifact",
        baseRevision: snapshot.state.revision,
        viewId: who.opened.viewId,
        ops: [{ id: "actions", value }],
      });
      expect(answer.status).toBe(200);
    };
    await write(ada, "Ship the CLI");
    const byAda = (await grace.snapshot()).state.fields["actions"]?.updatedBy;
    const graceSees = (await grace.respondents()).json() as {
      respondents: { name: string; key: string }[];
    };
    const adaKey = graceSees.respondents.find((one) => one.name === "Ada")?.key;
    expect(byAda).toMatchObject({ kind: "viewer", name: "Ada", key: adaKey });
    expect(byAda?.["id"]).toBeUndefined();
    await write(grace, "Ship the CLI and the docs");
    const byGrace = (await ada.snapshot()).state.fields["actions"]?.updatedBy;
    expect(byGrace).toMatchObject({ kind: "viewer", name: "Grace" });
    expect(byGrace?.["key"]).not.toBe(adaKey);
  });

  it("returns exactly what each visibility setting promises to a respondent's page", async () => {
    for (const visibility of ["private", "counts", "names"] as const) {
      const { pages } = await team(visibility, 2);
      const [ada, grace] = pages as [Page, Page];
      await grace.presence({ cursor: { x: 1, y: 1 } });
      const roster = (await ada.respondents()).json() as Record<string, unknown>;
      const presence = (await ada.presence({})).json() as {
        peers: { self: boolean }[];
        others?: number;
      };
      expect(roster["visibility"]).toBe(visibility);
      expect((roster["self"] as { name: string }).name).toBe("Ada");
      expect("counts" in roster).toBe(visibility !== "private");
      expect("respondents" in roster).toBe(visibility === "names");
      expect(presence.peers.filter((peer) => !peer.self)).toHaveLength(
        visibility === "names" ? 1 : 0,
      );
      expect(presence.others).toBe(visibility === "private" ? undefined : 1);
    }
  });
});
