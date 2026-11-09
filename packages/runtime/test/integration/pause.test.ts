/**
 * Pausing a hosted artifact (RM-09, D165 item 14), through `artifact/pause` on the owner (what
 * `mostra pause` and `resume` call) and the operator's server handle: views keep working and the
 * shell is told it's paused; submissions answer 423 `MOSTRA_SUBMIT_PAUSED` and relayed actions 423
 * `MOSTRA_ACTION_PAUSED`, each before anything is recorded and with the draft kept; links stay
 * valid; resuming restores everything; and the owner can't lift an operator's pause.
 */
import { cpSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { MutationId } from "@mostra/protocol";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ActionPage } from "../action-page.ts";
import { Browser, type Opened, openLink } from "../browser-client.ts";
import { GatewayHome, ok } from "../gateway-home.ts";
import { control } from "../operator-support.ts";
import {
  freePort,
  ownerEnv,
  ownerSignIn,
  type RunningServer,
  startServer,
  stopServer,
  testConfig,
} from "../server-support.ts";
import { tempDir } from "../support.ts";

const REVISION = "2026-10-15";
const OPERATOR = fileURLToPath(new URL("../fixtures/operator.mjs", import.meta.url));
const FIXTURES = new URL("../fixtures/artifacts/", import.meta.url);

/** The `actions` fixture with a field beside a relayed action anyone with the link may run. */
function pausable(): string {
  const dir = join(tempDir("pause-artifact"), "pausable");
  cpSync(new URL("actions", FIXTURES), dir, { recursive: true });
  writeFileSync(
    join(dir, "index.tsx"),
    `import { defineArtifact, useField } from "@mostra/react";
import { echo } from "./actions";

export const artifact = defineArtifact({
  title: "Pausable",
  submission: { policy: "once", scope: "per-viewer" },
  hosted: { actions: "link" },
});

export default function Page() {
  const [note, setNote] = useField<string>("note", { defaultValue: "" });
  return (
    <main>
      <input aria-label="Note" value={note} onChange={(event) => setNote(event.target.value)} />
      <button type="button" onClick={() => void echo(note)}>Echo</button>
    </main>
  );
}
`,
  );
  return dir;
}

describe("pausing a hosted artifact (RM-09)", () => {
  let port: number;
  let server: RunningServer;
  let operator: ReturnType<typeof control>;
  const owner = new GatewayHome();
  let artifactId: string;
  let link: string;
  let routeId: string;

  beforeAll(async () => {
    port = await freePort();
    const controlPort = await freePort();
    server = await startServer({
      data: tempDir("pause-data"),
      port,
      config: testConfig(port, { operator: OPERATOR }),
      env: { MOSTRA_TEST_OPERATOR_PORT: String(controlPort) },
    });
    expect(server.status.status, server.stderr()).toBe("started");
    operator = control(controlPort);
    await owner.start({ env: ownerEnv(port) });
    await ownerSignIn(owner.client, port, "Ada");
    const receipt = ok<{ artifactId: string }>(
      await owner.client.call("artifact/publish", { source: { path: pausable() } }, 120_000),
    );
    artifactId = receipt.artifactId;
    link = ok<{ url: string }>(
      await owner.client.call("share/start", { artifact: { artifactId }, via: "remote" }),
    ).url;
    routeId = (
      /\/a\/(rte_[0-9A-Z]{26})/.exec(new URL(link).pathname) as RegExpExecArray
    )[1] as string;
  }, 240_000);

  afterAll(async () => {
    await owner.stop();
    await stopServer(server);
  });

  /** A person on the hosted link with a note written: their page, its view and its draft. */
  const visitor = async (note: string) => {
    const browser = new Browser();
    const opened = await openLink(browser, link);
    const written = await browser.fetchJson(opened.frameOrigin, `/_mostra/v/${REVISION}/fields`, {
      body: {
        mutationId: MutationId.create(),
        scope: "viewer",
        baseRevision: "0",
        viewId: opened.viewId,
        ops: [{ id: "note", value: note }],
      },
      csrf: opened.frameCsrf,
    });
    expect(written.status, written.body).toBe(200);
    return { browser, opened, revision: written.json<{ revision: string }>().revision };
  };
  const submit = (who: { browser: Browser; opened: Opened; revision: string }) =>
    who.browser.fetchJson(
      who.opened.link.shell,
      `/a/${who.opened.link.artifactId}/_mostra/v/${REVISION}/submit`,
      {
        body: { viewId: who.opened.viewId, expectedRevision: who.revision },
        csrf: who.opened.shellCsrf,
      },
    );
  const ticket = (who: { browser: Browser; opened: Opened }) =>
    who.browser.fetchJson(
      who.opened.link.shell,
      `/a/${who.opened.link.artifactId}/_mostra/ticket`,
      {
        body: {},
        csrf: who.opened.shellCsrf,
      },
    );
  const draft = async (who: { browser: Browser; opened: Opened }) =>
    (
      await who.browser.fetchJson(
        who.opened.frameOrigin,
        `/_mostra/v/${REVISION}/events/poll?view=${who.opened.viewId}&wait=0`,
      )
    ).json<{ snapshot?: { draft?: { fields?: Record<string, { value: unknown }> } } }>().snapshot
      ?.draft?.fields?.["note"]?.value;
  const submissions = async (): Promise<number> =>
    ok<{ events: unknown[] }>(
      await owner.client.call("events/read", {
        filter: { artifacts: [artifactId], types: ["submission.created"] },
      }),
    ).events.length;

  it("refuses answers and actions while the owner pauses it, keeps views, drafts and links, and resumes", async () => {
    const before = await visitor("written before the pause");
    // The owner pauses it (`mostra pause <artifact> --reason …`): forwarded to the server.
    const paused = ok<{ paused: boolean; by?: string }>(
      await owner.client.call("artifact/pause", {
        artifact: { artifactId },
        paused: true,
        reason: "Closed until Monday",
      }),
    );
    expect(paused).toEqual({ paused: true, by: "owner" });

    // Views keep working, and the shell is told why it shows the page paused.
    const viewing = await visitor("written while paused");
    const shown = await ticket(viewing);
    expect(shown.status, shown.body).toBe(200);
    expect(shown.json<{ paused?: { by: string; reason?: string } }>().paused).toEqual({
      by: "owner",
      reason: "Closed until Monday",
    });

    // Submissions: 423, nothing recorded, the draft kept.
    const refused = await submit(before);
    expect(refused.status, refused.body).toBe(423);
    expect(refused.json<{ code: string }>().code).toBe("MOSTRA_SUBMIT_PAUSED");
    expect(await draft(before)).toBe("written before the pause");
    expect(await draft(viewing)).toBe("written while paused");

    // A relayed action: 423 before anything is recorded or relayed.
    const page = new ActionPage(viewing.browser, viewing.opened);
    const run = await page.run("actions.ts#echo", ["hi"]);
    expect(run.status, run.body).toBe(423);
    expect(run.json<{ code: string }>().code).toBe("MOSTRA_ACTION_PAUSED");
    const call = await page.call("actions.ts#echo", ["hi"]);
    expect(call.status, call.body).toBe(423);
    const runs = await page.attach({ keyed: [] });
    expect(runs.json<{ runs: unknown[] }>().runs).toEqual([]);

    // Resuming restores everything, through the same links and drafts.
    expect(
      ok<{ paused: boolean }>(
        await owner.client.call("artifact/pause", { artifact: { artifactId }, paused: false }),
      ).paused,
    ).toBe(false);
    const accepted = await submit(before);
    expect(accepted.status, accepted.body).toBe(200);
    const echoed = await page.call("actions.ts#echo", ["hi"]);
    expect(echoed.status, echoed.body).toBe(200);
    const resumedTicket = (await ticket(viewing)).json<{ paused?: unknown }>();
    expect(resumedTicket.paused).toBeUndefined();
    await expect.poll(submissions, { timeout: 30_000 }).toBe(1);
  }, 180_000);

  it("keeps an operator's pause on, whatever the owner asks, until the operator lifts it", async () => {
    const who = await visitor("written under the operator's pause");
    expect((await operator.handle("pause", routeId, "Under review")).status).toBe(200);
    const shown = (await ticket(who)).json<{ paused?: { by: string } }>();
    expect(shown.paused?.by).toBe("operator");
    // The owner can't lift it, from the CLI's method or otherwise.
    const lifted = await owner.client.call("artifact/pause", {
      artifact: { artifactId },
      paused: false,
    });
    expect(
      (lifted as { error?: { data?: { code?: string } } }).error?.data?.code,
      JSON.stringify(lifted),
    ).toBe("MOSTRA_REMOTE_PAUSED_BY_OPERATOR");
    const refused = await submit(who);
    expect(refused.status).toBe(423);
    // The operator lifts it; the draft was kept and goes through.
    expect((await operator.handle("resume", routeId)).status).toBe(200);
    const accepted = await submit(who);
    expect(accepted.status, accepted.body).toBe(200);
  }, 120_000);
});
