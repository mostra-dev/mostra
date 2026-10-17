/**
 * The worker's channel thread (D124): owns the connection to the supervisor, so the artifact's
 * main thread can block on a secret (`secret()` is synchronous, INTERFACES §2.4) while the reply
 * still arrives, and so the watchdog's ping is answered from what the main thread last wrote into
 * shared memory, which is how a blocked event loop shows (D62). Every other line passes through to
 * the main thread unchanged.
 */
import { connect, Socket } from "node:net";
import { parentPort, workerData } from "node:worker_threads";
import { encodeLine, LineSplitter, WORKER_METHODS } from "@mostra/protocol";
import { SECRET_SLOT, type SharedState, sharedViews } from "./shared.ts";

interface ThreadData {
  readonly channel: string;
  readonly shared: SharedState;
}

const data = workerData as ThreadData;
const port = parentPort;
if (!port) throw new Error("The channel thread runs only as a worker thread.");
const views = sharedViews(data.shared);

function open(channel: string): Socket {
  if (channel.startsWith("fd:")) {
    const socket = new Socket({ fd: Number(channel.slice(3)), readable: true, writable: true });
    return socket;
  }
  if (channel.startsWith("unix:")) return connect(channel.slice(5));
  throw new Error(`Unknown channel ${channel}.`);
}

const socket = open(data.channel);
const splitter = new LineSplitter();
let nextSecret = 1;
let pendingSecret: string | undefined;

function write(line: string): void {
  socket.write(line);
}

function deliverSecret(status: "ok" | "error", text: string): void {
  const bytes = new TextEncoder().encode(text);
  const length = Math.min(bytes.length, views.secretBytes.length);
  views.secretBytes.set(bytes.subarray(0, length));
  Atomics.store(views.control, SECRET_SLOT.length, length);
  Atomics.store(views.control, SECRET_SLOT.status, status === "ok" ? 0 : 1);
  Atomics.store(views.control, SECRET_SLOT.state, 2);
  Atomics.notify(views.control, SECRET_SLOT.state);
}

function onLine(line: string): void {
  let message: { id?: unknown; method?: unknown; result?: unknown; error?: unknown } | undefined;
  try {
    message = JSON.parse(line) as typeof message;
  } catch {
    message = undefined;
  }
  if (message && message.method === WORKER_METHODS.ping && message.id !== undefined) {
    const now = Date.now();
    const beat = Number(Atomics.load(views.beat, 0));
    const waiting = Atomics.load(views.control, SECRET_SLOT.state) === 1;
    write(
      encodeLine({
        jsonrpc: "2.0",
        id: message.id as string,
        result: {
          blockedMs: waiting ? 0 : Math.max(0, now - beat),
          waitingForSecret: waiting,
          heapUsed: Number(Atomics.load(views.beat, 1)),
        },
      }),
    );
    return;
  }
  if (message && typeof message.id === "string" && message.id === pendingSecret) {
    pendingSecret = undefined;
    if (message.error !== undefined) {
      const error = message.error as {
        data?: { code?: string; message?: string };
        message?: string;
      };
      deliverSecret(
        "error",
        JSON.stringify({
          code: error.data?.code ?? "MOSTRA_SECRET_MISSING",
          message: error.data?.message ?? error.message ?? "The secret could not be read.",
        }),
      );
    } else {
      deliverSecret(
        "ok",
        typeof message.result === "object" && message.result !== null
          ? String((message.result as { value?: unknown }).value ?? "")
          : "",
      );
    }
    return;
  }
  port?.postMessage({ type: "line", line });
}

socket.setEncoding("utf8");
socket.on("data", (chunk: string) => {
  for (const line of splitter.push(chunk)) onLine(line);
});
const closed = (): void => port?.postMessage({ type: "closed" });
socket.on("end", closed);
socket.on("close", closed);
socket.on("error", closed);

port.on("message", (message: { type: string; line?: string; name?: string }) => {
  if (message.type === "line" && message.line !== undefined) write(message.line);
  else if (message.type === "secret" && message.name !== undefined) {
    const id = `secret-${nextSecret++}`;
    pendingSecret = id;
    write(
      encodeLine({
        jsonrpc: "2.0",
        id,
        method: WORKER_METHODS.secret,
        params: { name: message.name },
      }),
    );
  } else if (message.type === "end") {
    socket.end();
  }
});
