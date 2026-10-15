/// <reference lib="dom" />
/**
 * The interaction ledger in Chromium, Firefox and WebKit through the real gateway (WP-06): a page
 * in its frame saves its draft over the browser protocol, hears its events on an `EventSource`,
 * submits, and gets the typed conflict on a second submit (IN-01, IN-05, IN-07); an agent and the
 * page write one artifact field from the same revision and both see the conflict (LL-01); a link
 * without the scopes is refused by the real handlers' routes (D96). Each test acts as its own
 * viewer (D104), so the engines never share a draft.
 */
import { expect, type Frame, type Page, test } from "@playwright/test";
import { Client, readRun } from "../support/mostra.ts";

const run = readRun();
const V = "2026-10-15";

/** Opens a link in the shell; returns the frame and the view the shell's ticket recorded. */
async function openView(page: Page, url: string): Promise<{ frame: Frame; viewId: string }> {
  const ticket = page.waitForResponse((response) => response.url().endsWith("/_mostra/ticket"));
  await page.goto(url);
  const { viewId } = (await (await ticket).json()) as { viewId: string };
  await expect(page.locator("html")).toHaveAttribute("data-shell", "ready", { timeout: 15_000 });
  const frame = page.frames().find((candidate) => candidate !== page.mainFrame());
  if (!frame) throw new Error("the shell has no frame");
  return { frame, viewId };
}

/** A same-origin POST from the frame's page, with its session's CSRF token. */
function post(
  frame: Frame,
  path: string,
  body: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  return frame.evaluate(
    async ({ path, body }) => {
      const session = (await (await fetch("/_mostra/session")).json()) as { csrf: string };
      const response = await fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json", "x-mostra-csrf": session.csrf },
        body: JSON.stringify(body),
      });
      return { status: response.status, body: (await response.json()) as Record<string, unknown> };
    },
    { path, body },
  );
}

const mutationId = (): string =>
  `mut_0${Array.from({ length: 25 }, () => "0123456789ABCDEFGHJKMNPQRSTVWXYZ"[Math.floor(Math.random() * 32)]).join("")}`;

test.describe("a page's draft, events and submission", () => {
  test("saves, hears its own change on an EventSource, submits once, and gets the typed conflict on a second submit", async ({
    page,
    browserName,
  }, info) => {
    const client = await Client.connect(run.socket);
    try {
      const ref = `${browserName}-${info.title}-${Date.now()}`;
      const link = await client.call<{ url: string }>("view/url", {
        artifact: { artifactId: run.receipts.survey.artifactId },
        viewer: { ref, name: browserName },
      });
      const { frame, viewId } = await openView(page, link.url);
      // An EventSource on the page's own origin: first the snapshot, then its events (D22).
      await frame.evaluate(
        ({ V, viewId }) => {
          const seen: unknown[] = [];
          (window as unknown as { seen: unknown[] }).seen = seen;
          const source = new EventSource(`/_mostra/v/${V}/events?view=${viewId}`);
          source.addEventListener("snapshot", (event) =>
            seen.push({ snapshot: JSON.parse((event as MessageEvent).data) }),
          );
          source.addEventListener("mostra", (event) =>
            seen.push(JSON.parse((event as MessageEvent).data)),
          );
        },
        { V, viewId },
      );
      await expect
        .poll(() => frame.evaluate(() => (window as unknown as { seen: unknown[] }).seen.length))
        .toBe(1);
      const saved = await post(frame, `/_mostra/v/${V}/fields`, {
        mutationId: mutationId(),
        scope: "viewer",
        baseRevision: "0",
        viewId,
        ops: [{ id: "density", value: "spacious", label: "Density" }],
      });
      expect(saved).toEqual({
        status: 200,
        body: { revision: "1", applied: ["density"], conflicts: [] },
      });
      await expect
        .poll(() =>
          frame.evaluate(() =>
            (window as unknown as { seen: { type?: string }[] }).seen.map(
              (entry) => entry.type ?? "snapshot",
            ),
          ),
        )
        .toEqual(["snapshot", "draft.changed"]);
      const submitted = await post(frame, `/_mostra/v/${V}/submit`, {
        viewId,
        expectedRevision: "1",
        channel: "artifact",
      });
      expect(submitted.status).toBe(200);
      expect(submitted.body).toMatchObject({
        viewId,
        version: 1,
        channel: "artifact",
        staleView: false,
      });
      const again = await post(frame, `/_mostra/v/${V}/fields`, {
        mutationId: mutationId(),
        scope: "viewer",
        baseRevision: "1",
        viewId,
        ops: [{ id: "density", value: "compact" }],
      });
      expect(again.status).toBe(409);
      expect(again.body).toMatchObject({
        code: "MOSTRA_SUBMIT_ALREADY",
        submission: { id: submitted.body["id"] },
      });
      const results = await client.call<{
        answers: unknown;
        submission: { viewer: { ref: string } };
      }>("results/get", {
        artifact: { artifactId: run.receipts.survey.artifactId },
        submission: submitted.body["id"],
      });
      expect(results.answers).toEqual({ density: "spacious" });
      expect(results.submission.viewer.ref).toBe(ref);
    } finally {
      client.close();
    }
  });

  test("an agent and the page writing one artifact field from the same revision both see the conflict (LL-01)", async ({
    page,
    browserName,
  }, info) => {
    const client = await Client.connect(run.socket);
    try {
      const link = await client.call<{ url: string }>("view/url", {
        artifact: { artifactId: run.receipts.survey.artifactId },
        viewer: { ref: `${browserName}-${info.title}-${Date.now()}` },
      });
      const { frame, viewId } = await openView(page, link.url);
      const field = `tasks.${browserName}`;
      const mutation = (value: unknown, baseRevision: string) => ({
        mutationId: mutationId(),
        scope: "artifact",
        baseRevision,
        viewId,
        ops: [{ id: field, value }],
      });
      const start = await client.call<{ revision: string }>("state/patch", {
        artifact: { artifactId: run.receipts.survey.artifactId },
        mutationId: mutationId(),
        ops: [{ id: field, value: ["draft"] }],
      });
      // The agent writes first from `start`; the page, also from `start`, conflicts.
      await client.call("state/patch", {
        artifact: { artifactId: run.receipts.survey.artifactId },
        mutationId: mutationId(),
        baseRevision: start.revision,
        ops: [{ id: field, value: ["agent"] }],
      });
      const pageWrite = await post(
        frame,
        `/_mostra/v/${V}/fields`,
        mutation(["page"], start.revision),
      );
      expect(pageWrite.status).toBe(200);
      expect(pageWrite.body["conflicts"]).toEqual([
        expect.objectContaining({
          id: field,
          value: ["agent"],
          updatedBy: expect.objectContaining({ kind: "agent" }),
        }),
      ]);
      // The page keeps its value on the current revision; the agent's stale write conflicts in turn.
      const state = await client.call<{ revision: string }>("state/get", {
        artifact: { artifactId: run.receipts.survey.artifactId },
      });
      const kept = await post(frame, `/_mostra/v/${V}/fields`, mutation(["page"], state.revision));
      expect(kept.body["conflicts"]).toEqual([]);
      const agentAgain = await client.call<{
        conflicts: { id: string; updatedBy: { kind: string } }[];
      }>("state/patch", {
        artifact: { artifactId: run.receipts.survey.artifactId },
        mutationId: mutationId(),
        baseRevision: state.revision,
        ops: [{ id: field, value: ["agent again"] }],
      });
      expect(agentAgain.conflicts).toEqual([
        expect.objectContaining({
          id: field,
          updatedBy: expect.objectContaining({ kind: "viewer" }),
        }),
      ]);
    } finally {
      client.close();
    }
  });

  test("a view-only link is refused by the draft, submit and signal routes with well-formed requests (D96)", async ({
    page,
  }) => {
    const client = await Client.connect(run.socket);
    try {
      const link = await client.call<{ url: string }>("view/url", {
        artifact: { artifactId: run.receipts.survey.artifactId },
        scopes: ["view"],
      });
      const { frame, viewId } = await openView(page, link.url);
      const answers = [
        await post(frame, `/_mostra/v/${V}/fields`, {
          mutationId: mutationId(),
          scope: "viewer",
          baseRevision: "0",
          viewId,
          ops: [{ id: "a", value: 1 }],
        }),
        await post(frame, `/_mostra/v/${V}/submit`, {
          viewId,
          expectedRevision: "0",
          channel: "artifact",
        }),
        await post(frame, `/_mostra/v/${V}/signal`, { viewId, name: "ping" }),
      ];
      expect(answers.map((answer) => `${answer.status} ${answer.body["code"]}`)).toEqual([
        "403 MOSTRA_HYGIENE_SCOPE_DENIED",
        "403 MOSTRA_HYGIENE_SCOPE_DENIED",
        "403 MOSTRA_HYGIENE_SCOPE_DENIED",
      ]);
    } finally {
      client.close();
    }
  });
});
