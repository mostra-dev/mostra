/**
 * Worker-mode frame sessions (D70, D158 item 5): where the shell and the artifact are two sites,
 * no cookie reaches the artifact's frame (VERIFIED_FACTS, cross-site frames). The frame enters
 * through a bootstrap page instead: it exchanges the shell's single-use ticket for a frame
 * session, installs Mostra's service worker at `/`, and enters the version, whose every
 * same-origin request then carries the session in a header. Event streams, polls and WebSockets
 * bypass the worker with single-use tickets, since Firefox stalls on endless responses a worker
 * passes on.
 *
 * This module holds the two documents the browser runs: the bootstrap page and the worker. Both
 * are plain scripts with no imports, served by the gateway from the artifact's origin.
 */
import { FRAME_SESSION_HEADER } from "@mostra/protocol";

/** Where the service worker is served; its registration's scope is `/`. */
export const SERVICE_WORKER_PATH = "/_mostra/sw.js";

/** The IndexedDB the frame session's secret is kept in, per artifact origin and top-level site. */
const DB = "mostra-frame";

/**
 * The service worker (D70): it adds the frame session's header to every same-origin request but
 * its own script, the bootstrap's, and ticketed ones (`?ticket=`: streams, polls and sockets),
 * and keeps the secret in IndexedDB, since a browser stops idle workers and their memory goes.
 * A request a header can't be added to as made (a `no-cors` script or image, a navigation) is
 * sent again as a same-origin request, which carries it.
 */
export const SERVICE_WORKER_SOURCE: string = `// Mostra's frame-session worker (D70). It signs this origin's requests for the artifact's frame.
"use strict";
const HEADER = ${JSON.stringify(FRAME_SESSION_HEADER)};
const DB = ${JSON.stringify(DB)};
const STORE = "session";
let secret;
function store(mode, act) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(STORE);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction(STORE, mode);
      const request = act(tx.objectStore(STORE));
      tx.oncomplete = () => { db.close(); resolve(request.result); };
      tx.onerror = tx.onabort = () => { db.close(); reject(tx.error); };
    };
  });
}
async function current() {
  if (secret === undefined) {
    try { secret = await store("readonly", (s) => s.get("secret")); } catch { secret = undefined; }
  }
  return secret;
}
self.addEventListener("install", () => { self.skipWaiting(); });
self.addEventListener("activate", (event) => { event.waitUntil(self.clients.claim()); });
self.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || data.type !== "mostra/frame-session" || typeof data.secret !== "string") return;
  secret = data.secret;
  const port = event.ports[0];
  event.waitUntil(
    store("readwrite", (s) => s.put(data.secret, "secret")).then(
      () => port && port.postMessage({ ok: true }),
      (error) => port && port.postMessage({ ok: false, message: String(error) }),
    ),
  );
});
self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname === ${JSON.stringify(SERVICE_WORKER_PATH)} || url.pathname === "/_mostra/enter") return;
  if (url.searchParams.has("ticket")) return;
  event.respondWith(signed(request));
});
async function signed(request) {
  const value = await current();
  if (!value) return fetch(request);
  const headers = new Headers(request.headers);
  headers.set(HEADER, value);
  const navigate = request.mode === "navigate";
  // Sent on, a navigation is an ordinary request: the gateway learns it was one from this header.
  if (navigate) headers.set("x-mostra-navigation", "1");
  const init = {
    method: request.method,
    headers,
    mode: navigate || request.mode === "no-cors" ? "same-origin" : request.mode,
    credentials: request.credentials,
    cache: request.cache === "only-if-cached" ? "default" : request.cache,
    redirect: navigate ? "manual" : request.redirect,
    referrerPolicy: request.referrerPolicy,
    integrity: request.integrity,
    keepalive: request.keepalive,
    signal: request.signal,
  };
  if (request.method !== "GET" && request.method !== "HEAD") init.body = await request.arrayBuffer();
  return fetch(new Request(request.url, init));
}
`;

/**
 * The bootstrap page at `/_mostra/enter#t=<ticket>` (D70): it takes the ticket from the fragment
 * (so no server, log or `Referer` sees it), exchanges it at `POST /_mostra/enter` (sending the
 * session it kept, so a frame that re-enters keeps its session and switches version), installs
 * the worker at `/`, hands it the secret and enters the version at `/`. Whatever stops it is
 * reported to the shell as `mostra/frameSession.failed` with `MOSTRA_HYGIENE_FRAME_SESSION`.
 */
export const BOOTSTRAP_PAGE: string = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="referrer" content="no-referrer">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Mostra</title>
<style>body{font-family:system-ui,sans-serif;margin:0;min-height:100vh;display:flex;justify-content:center;align-items:center;padding:2rem;text-align:center;color-scheme:light dark;opacity:.8}</style>
</head>
<body>
<script>
(async () => {
  "use strict";
  const HEADER = ${JSON.stringify(FRAME_SESSION_HEADER)};
  let shell = "*";
  const fail = (reason, message) => {
    document.body.textContent = message;
    parent.postMessage(
      { jsonrpc: "2.0", method: "mostra/frameSession.failed",
        params: { code: "MOSTRA_HYGIENE_FRAME_SESSION", reason, message } },
      shell,
    );
  };
  const kept = () => new Promise((resolve) => {
    try {
      const open = indexedDB.open(${JSON.stringify(DB)}, 1);
      open.onupgradeneeded = () => open.result.createObjectStore("session");
      open.onerror = () => resolve(undefined);
      open.onsuccess = () => {
        const db = open.result;
        try {
          const read = db.transaction("session", "readonly").objectStore("session").get("secret");
          read.onsuccess = () => { db.close(); resolve(typeof read.result === "string" ? read.result : undefined); };
          read.onerror = () => { db.close(); resolve(undefined); };
        } catch { db.close(); resolve(undefined); }
      };
    } catch { resolve(undefined); }
  });
  const ticket = new URLSearchParams(location.hash.slice(1)).get("t");
  history.replaceState(null, "", location.pathname);
  if (!ticket) return fail("refused", "This frame was opened without a ticket.");
  if (!("serviceWorker" in navigator) || typeof indexedDB === "undefined") {
    return fail("unsupported", "This browser offers the artifact's frame no service worker here, which this link needs.");
  }
  let answer;
  try {
    const previous = await kept();
    const response = await fetch("/_mostra/enter", {
      method: "POST",
      credentials: "omit",
      cache: "no-store",
      headers: { "content-type": "application/json", ...(previous ? { [HEADER]: previous } : {}) },
      body: JSON.stringify({ ticket }),
    });
    answer = await response.json().catch(() => ({}));
    if (!response.ok) return fail("refused", answer.message || "The frame's entry was refused.");
  } catch (error) {
    return fail("refused", "The frame couldn't reach Mostra: " + error);
  }
  shell = answer.shellOrigin;
  try {
    const found = await navigator.serviceWorker.getRegistration("/");
    const script = found && (found.active || found.waiting || found.installing);
    if (script && new URL(script.scriptURL).pathname !== ${JSON.stringify(SERVICE_WORKER_PATH)}) {
      console.warn("Mostra replaced another service worker at / on this origin: a worker-mode frame needs its own there (MOSTRA_HYGIENE_FRAME_SESSION).");
    }
    const registration = await navigator.serviceWorker.register(${JSON.stringify(SERVICE_WORKER_PATH)}, { scope: "/", updateViaCache: "none" });
    const worker = registration.installing || registration.waiting || registration.active;
    if (!worker) throw new Error("no worker");
    if (worker.state !== "activated") {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("the worker didn't activate in 20 s")), 20000);
        worker.addEventListener("statechange", () => {
          if (worker.state === "activated") { clearTimeout(timer); resolve(); }
          if (worker.state === "redundant") { clearTimeout(timer); reject(new Error("the worker was replaced")); }
        });
      });
    }
    const stored = await new Promise((resolve) => {
      const channel = new MessageChannel();
      const timer = setTimeout(() => resolve({ ok: false, message: "no answer" }), 10000);
      channel.port1.onmessage = (event) => { clearTimeout(timer); resolve(event.data); };
      worker.postMessage({ type: "mostra/frame-session", secret: answer.session }, [channel.port2]);
    });
    if (!stored || !stored.ok) throw new Error(stored && stored.message);
  } catch (error) {
    return fail("blocked", "This browser didn't let the artifact's frame install the service worker this link needs (" + error + ").");
  }
  location.replace("/");
})();
</script>
</body>
</html>
`;
