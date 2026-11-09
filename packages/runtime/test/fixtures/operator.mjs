/**
 * A fixture operator module (HO-09, INTERFACES §18.6): every operator port, each one driven by the
 * test through a small control server on loopback (`MOSTRA_TEST_OPERATOR_PORT`), and recording
 * every call it receives so a test reads them back. Its first behaviour comes from
 * `MOSTRA_TEST_OPERATOR_STATE` (JSON), so it holds across a server restart.
 *
 * Behaviours, each per port:
 * - `limits`: per operation, `"allow"`, `"hang"` (never answers) or `{ code, message, retryAfterMs? }`.
 * - `events`, `metering`: `"ok"`, `"fail"` (throws) or `"hang"`.
 * - `routing`: per host, a routing answer; `linkHost`: a host or null.
 * - `policy`: a link policy for every link.
 * - `accounts`: per subject, `{ account, status }`, `{ step: { url } }` or `{ refused: { message } }`.
 * - `credentials`: per bearer, `{ account, scope }`.
 * - `pushed`: `"quarantine"` to quarantine every pushed version.
 *
 * The control server takes `POST /state` (merged into the behaviours), `GET /calls` and
 * `POST /handle { method, args }`, which calls the server handle and answers its result.
 */
import { createServer } from "node:http";

const state = {
  limits: {},
  events: "ok",
  metering: "ok",
  routing: {},
  linkHost: null,
  policy: {},
  accounts: {},
  credentials: {},
  pushed: undefined,
  ...JSON.parse(process.env.MOSTRA_TEST_OPERATOR_STATE ?? "{}"),
};
const calls = [];
const record = (port, payload) => calls.push({ port, at: Date.now(), payload });
const never = () => new Promise(() => {});

async function behave(kind) {
  if (kind === "hang") return never();
  if (kind === "fail") throw new Error("the fixture operator refuses for now");
}

export default function operator(server) {
  const control = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = chunks.length > 0 ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
    const answer = (status, value) => {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(value ?? null));
    };
    try {
      if (request.method === "POST" && request.url === "/state") {
        Object.assign(state, body);
        return answer(200, state);
      }
      if (request.method === "GET" && request.url === "/calls") return answer(200, calls);
      if (request.method === "POST" && request.url === "/handle") {
        const result = await server[body.method](...body.args);
        return answer(200, { result: result ?? null });
      }
      answer(404, { error: "unknown" });
    } catch (error) {
      answer(500, { error: error.message, code: error.diagnostic?.code });
    }
  });
  control.listen(Number(process.env.MOSTRA_TEST_OPERATOR_PORT), "127.0.0.1");
  control.unref();

  return {
    limits: {
      async check(query) {
        record("limits", query);
        const rule = state.limits[query.operation] ?? "allow";
        if (rule === "hang") return never();
        if (rule === "allow") return { allowed: true };
        return { allowed: false, ...rule };
      },
    },
    metering: {
      async record(batch) {
        record("metering.attempt", batch);
        await behave(state.metering);
        record("metering", batch);
      },
    },
    accounts: {
      async resolve(identity) {
        record("accounts.resolve", identity);
        return state.accounts[identity.subject] ?? { account: `op:${identity.subject}`, status: "active" };
      },
      async authenticate(bearer, context) {
        record("accounts.authenticate", { resource: context.resource });
        return state.credentials[bearer] ?? null;
      },
    },
    abuse: {
      async report(report) {
        record("abuse.report", report);
      },
      async pushed(version) {
        const first = version.files[0];
        const bytes = first === undefined ? 0 : (await version.read(first)).length;
        record("abuse.pushed", { ...version, read: undefined, firstFileBytes: bytes });
        return state.pushed === "quarantine" ? { quarantine: { reason: "fixture review" } } : undefined;
      },
    },
    policy: {
      async link(query) {
        record("policy.link", query);
        return state.policy;
      },
    },
    routing: {
      async resolve(host) {
        record("routing.resolve", { host });
        return state.routing[host] ?? null;
      },
      async linkHost(query) {
        record("routing.linkHost", query);
        return state.linkHost;
      },
    },
    events: {
      async deliver(event) {
        record("events.attempt", { eventId: event.eventId, kind: event.kind });
        await behave(state.events);
        record("events", event);
      },
    },
  };
}
