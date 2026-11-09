/**
 * RM-08's load test (D165 item 13): anonymous answers on one hosted link, with its owner offline.
 *
 *   node scripts/load-anonymous.ts run --link <hosted link> [--minutes 30] [--rate 1]
 *     [--burst 10] [--burst-seconds 10] [--burst-every 300] [--out <file.json>]
 *   node scripts/load-anonymous.ts verify --home <owner home> --artifact <art_…> --accepted <file.json>
 *
 * `run` sends a fresh browser (an anonymous viewer of its own) to the link at `--rate` a second,
 * and every `--burst-every` seconds at `--burst` a second for `--burst-seconds`. Each one opens the
 * page as the hosted shell does (its session in a header, the frame in worker mode), writes its
 * answer and presses the shell's Submit. It times the Submit alone (the acceptance), and on a 429
 * waits the `Retry-After` it was told and submits the same draft again, counting it. It writes every
 * accepted submission ID, in the order they were accepted, and the latencies' percentiles.
 *
 * `verify` connects to the owner's instance once it is back and reads its log: every accepted
 * submission must be there exactly once, imported from the server in the server's order.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createConnection } from "node:net";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { MutationId } from "@mostra/protocol";
import { Browser, openLink } from "../test/browser-client.ts";

const REVISION = "2026-10-15";
const CHOICES = ["monday", "tuesday", "wednesday"];

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    link: { type: "string" },
    minutes: { type: "string", default: "30" },
    rate: { type: "string", default: "1" },
    burst: { type: "string", default: "10" },
    "burst-seconds": { type: "string", default: "10" },
    "burst-every": { type: "string", default: "300" },
    out: { type: "string", default: "load-anonymous.json" },
    home: { type: "string" },
    artifact: { type: "string" },
    accepted: { type: "string" },
  },
});

interface Visit {
  readonly n: number;
  readonly startedAt: number;
  status?: number;
  submissionId?: string;
  acceptMs?: number;
  totalMs?: number;
  limited: number;
  retryAfterS: number[];
  error?: string;
}

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return Number.NaN;
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)] as number;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** One anonymous visitor: opens the link, answers, submits; again after each 429's wait. */
async function visit(link: string, visit: Visit): Promise<void> {
  const browser = new Browser();
  try {
    const opened = await openLink(browser, link);
    const fields = await browser.fetchJson(opened.frameOrigin, `/_mostra/v/${REVISION}/fields`, {
      body: {
        mutationId: MutationId.create(),
        scope: "viewer",
        baseRevision: "0",
        viewId: opened.viewId,
        ops: [{ id: "answer", value: CHOICES[visit.n % CHOICES.length] }],
      },
      csrf: opened.frameCsrf,
    });
    if (fields.status !== 200)
      throw new Error(`fields ${fields.status} ${fields.body.slice(0, 200)}`);
    const revision = fields.json<{ revision: string }>().revision;
    for (;;) {
      const started = performance.now();
      const submitted = await browser.fetchJson(
        opened.link.shell,
        `/a/${opened.link.artifactId}/_mostra/v/${REVISION}/submit`,
        { body: { viewId: opened.viewId, expectedRevision: revision }, csrf: opened.shellCsrf },
      );
      const took = performance.now() - started;
      visit.status = submitted.status;
      if (submitted.status === 429) {
        // "Try again shortly": the draft is kept, so the same submit goes again after the wait.
        const wait = Number(submitted.header("retry-after") ?? "1");
        visit.limited += 1;
        visit.retryAfterS.push(wait);
        await sleep(wait * 1000);
        continue;
      }
      if (submitted.status !== 200) {
        throw new Error(`submit ${submitted.status} ${submitted.body.slice(0, 200)}`);
      }
      visit.acceptMs = took;
      visit.submissionId = submitted.json<{ id: string }>().id;
      break;
    }
  } catch (error) {
    visit.error = (error as Error).message;
  } finally {
    visit.totalMs = Date.now() - visit.startedAt;
  }
}

async function run(): Promise<void> {
  const link = values.link;
  if (!link) throw new Error("run needs --link <hosted link>");
  const minutes = Number(values.minutes);
  const rate = Number(values.rate);
  const burst = Number(values.burst);
  const burstSeconds = Number(values["burst-seconds"]);
  const burstEvery = Number(values["burst-every"]);
  const visits: Visit[] = [];
  const pending: Promise<void>[] = [];
  const begin = Date.now();
  const end = begin + minutes * 60_000;
  let n = 0;
  let next = begin;
  let lastReport = begin;
  while (Date.now() < end) {
    const elapsedS = (Date.now() - begin) / 1000;
    // A burst at the start of each period (the first one a period in, after the steady rate).
    const inBurst = elapsedS >= burstEvery && elapsedS % burstEvery < burstSeconds;
    const perSecond = inBurst ? burst : rate;
    const record: Visit = { n, startedAt: Date.now(), limited: 0, retryAfterS: [] };
    visits.push(record);
    pending.push(visit(link, record));
    n += 1;
    next += 1000 / perSecond;
    if (Date.now() - lastReport > 60_000) {
      lastReport = Date.now();
      const done = visits.filter((v) => v.submissionId !== undefined).length;
      console.error(`load: ${Math.round(elapsedS)} s, ${n} sent, ${done} accepted`);
    }
    await sleep(Math.max(0, next - Date.now()));
  }
  await Promise.all(pending);
  const accepted = visits.filter((v) => v.submissionId !== undefined);
  const latencies = accepted.map((v) => v.acceptMs as number).sort((a, b) => a - b);
  const summary = {
    link: link.replace(/#.*$/, "#t=…"),
    minutes,
    rate,
    burst: { perSecond: burst, seconds: burstSeconds, every: burstEvery },
    sent: visits.length,
    accepted: accepted.length,
    failed: visits.filter((v) => v.error !== undefined).map((v) => ({ n: v.n, error: v.error })),
    limited: {
      visits: visits.filter((v) => v.limited > 0).length,
      answers429: visits.reduce((sum, v) => sum + v.limited, 0),
    },
    acceptMs: {
      p50: percentile(latencies, 50),
      p95: percentile(latencies, 95),
      p99: percentile(latencies, 99),
      max: latencies.at(-1),
    },
    submissionIds: accepted
      .sort((a, b) => a.startedAt + (a.totalMs ?? 0) - (b.startedAt + (b.totalMs ?? 0)))
      .map((v) => v.submissionId),
  };
  writeFileSync(values.out as string, `${JSON.stringify(summary, null, 2)}\n`);
  const { submissionIds: _ids, ...shown } = summary;
  console.log(JSON.stringify(shown, null, 2));
}

/** The owner's instance, over its control socket. */
async function ownerCall(
  socket: string,
  calls: (call: (method: string, params?: unknown) => Promise<unknown>) => Promise<void>,
): Promise<void> {
  const connection = createConnection(socket);
  await new Promise((resolve, reject) => {
    connection.once("connect", resolve);
    connection.once("error", reject);
  });
  let buffer = "";
  let id = 0;
  const waiting = new Map<
    number,
    (message: { result?: unknown; error?: { message: string } }) => void
  >();
  connection.setEncoding("utf8");
  connection.on("data", (chunk: string) => {
    buffer += chunk;
    let at = buffer.indexOf("\n");
    while (at >= 0) {
      const line = buffer.slice(0, at);
      buffer = buffer.slice(at + 1);
      const message = JSON.parse(line) as {
        id?: number;
        result?: unknown;
        error?: { message: string };
      };
      if (message.id !== undefined) waiting.get(message.id)?.(message);
      at = buffer.indexOf("\n");
    }
  });
  const call = (method: string, params?: unknown): Promise<unknown> =>
    new Promise((resolve, reject) => {
      id += 1;
      waiting.set(id, (message) =>
        message.error
          ? reject(new Error(`${method}: ${message.error.message}`))
          : resolve(message.result),
      );
      connection.write(
        `${JSON.stringify({ jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) })}\n`,
      );
    });
  await call("mostra/initialize", {
    client: { name: "load-verify", version: "0" },
    revisions: ["2026-10-10"],
    capabilities: {},
    ports: [],
  });
  try {
    await calls(call);
  } finally {
    connection.end();
  }
}

async function verify(): Promise<void> {
  const home = values.home;
  const artifact = values.artifact;
  const acceptedFile = values.accepted;
  if (!home || !artifact || !acceptedFile)
    throw new Error("verify needs --home, --artifact and --accepted");
  const expected = (JSON.parse(readFileSync(acceptedFile, "utf8")) as { submissionIds: string[] })
    .submissionIds;
  const instance = JSON.parse(readFileSync(join(home, "instance.json"), "utf8")) as {
    socket: string;
  };
  const seen: { submissionId: string; hostedCursor: number }[] = [];
  await ownerCall(instance.socket, async (call) => {
    let after: string | undefined;
    for (;;) {
      const page = (await call("events/read", {
        filter: { artifacts: [artifact], types: ["submission.created"] },
        ...(after !== undefined ? { after } : {}),
        limit: 100,
      })) as { events: { payload: { submissionId: string } }[]; cursor: string };
      for (const event of page.events) {
        // Each imported submission's origin records its hosted cursor, the order it was made in.
        const results = (await call("results/get", {
          artifact: { artifactId: artifact },
          submission: event.payload.submissionId,
          format: "json",
        })) as { submission: { origin?: { cursor: string } } };
        seen.push({
          submissionId: event.payload.submissionId,
          hostedCursor: Number(results.submission.origin?.cursor ?? Number.NaN),
        });
      }
      if (page.events.length === 0) break;
      after = page.cursor;
    }
  });
  const ids = seen.map((event) => event.submissionId);
  const missing = expected.filter((submissionId) => !ids.includes(submissionId));
  const repeated = ids.filter((submissionId, index) => ids.indexOf(submissionId) !== index);
  // In order: the owner's local log keeps the hosted home's order of the submissions (D105).
  const hostedOrder = seen.map((event) => event.hostedCursor);
  const inOrder = hostedOrder.every(
    (cursor, index) => index === 0 || cursor > (hostedOrder[index - 1] as number),
  );
  const result = {
    expected: expected.length,
    imported: ids.length,
    missing: missing.length,
    repeated: repeated.length,
    inOrder,
  };
  console.log(JSON.stringify(result, null, 2));
  if (missing.length > 0 || repeated.length > 0 || !inOrder) process.exit(1);
}

const command = positionals[0];
if (command === "run") await run();
else if (command === "verify") await verify();
else {
  console.error(
    "usage: load-anonymous.ts run --link <url> … | verify --home <dir> --artifact <id> --accepted <file>",
  );
  process.exit(2);
}
