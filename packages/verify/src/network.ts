/**
 * What a verify render's page does on the network (D137 item 3): requests in flight (for the
 * quiescence wait), failed requests for resources the artifact's frame loaded, the sandbox's
 * refusals of actions that didn't opt into `dryRun()`, and the field writes the page made.
 *
 * A failed request counts when the artifact's frame loaded it: its document, scripts, styles,
 * images, fonts and fetches. Requests the browser makes on its own (`/favicon.ico`) and Mostra's
 * protocol (`/_mostra/…`, whose answers the client runtime handles) don't. Chrome's own
 * "Failed to load resource" console line is never counted: the request's finding stands for it.
 */
import { createDiagnostic, type Diagnostic } from "@mostra/protocol";
import type { Frame, Page, Request, Response } from "playwright-core";

/** The network of one render. */
export interface NetworkWatch {
  /** Requests in flight, the page's event stream aside. */
  inflight(): number;
  /** Server functions the sandbox refused since mark `from` (see {@link NetworkWatch.mark}). */
  skippedSince(from: number): string[];
  /** A mark for {@link NetworkWatch.skippedSince} and {@link NetworkWatch.writesSince}. */
  mark(): number;
  /** Field ops the gateway applied since a mark. */
  writesSince(from: number): number;
  /** Requests to Mostra's own protocol (fields, calls, runs, signals, submits) since a mark. */
  protocolSince(from: number): number;
  /** The failed-request findings so far. */
  findings(): Diagnostic[];
}

/** Whether a request is the page's event stream, which stays open. */
const isStream = (url: URL): boolean => /\/_mostra\/v\/[^/]+\/events(\/poll)?$/.test(url.pathname);

/** Watches a page's network; `frame` finds the artifact's frame. */
export function watchNetwork(
  page: Page,
  frame: () => Frame | undefined,
  viewport: string,
): NetworkWatch {
  const open = new Set<Request>();
  /** Events in order: skips, writes and protocol requests, each at its position. */
  const log: (
    | { kind: "skip"; fn: string }
    | { kind: "write"; ops: number }
    | { kind: "protocol" }
  )[] = [];
  const failures = new Map<string, Diagnostic>();
  /** Protocol answers still being read: they count as in flight until their body is in. */
  let reading = 0;

  const fromArtifact = (request: Request): boolean => {
    try {
      const own = frame();
      return own !== undefined && request.frame() === own;
    } catch {
      return false; // A service worker's request has no frame.
    }
  };

  const counted = (url: URL, artifactOrigin: string | undefined): boolean => {
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    if (url.origin === artifactOrigin && url.pathname.startsWith("/_mostra/")) return false;
    return url.pathname !== "/favicon.ico";
  };

  const fail = (request: Request, why: string): void => {
    if (!fromArtifact(request)) return;
    const url = new URL(request.url());
    let artifactOrigin: string | undefined;
    try {
      artifactOrigin = new URL(frame()?.url() ?? "").origin;
    } catch {
      artifactOrigin = undefined;
    }
    if (!counted(url, artifactOrigin)) return;
    const own = url.origin === artifactOrigin;
    const shown = own ? url.pathname : `${url.origin}${url.pathname}`;
    const key = `${request.method()} ${shown} ${why}`;
    const known = failures.get(key);
    if (known) {
      failures.set(key, { ...known, count: (known.count ?? 1) + 1 });
      return;
    }
    failures.set(
      key,
      createDiagnostic(own ? "MOSTRA_NETWORK_REQUEST_FAILED" : "MOSTRA_NETWORK_EXTERNAL_FAILED", {
        message: `${request.resourceType()} ${request.method()} ${shown} ${why}.`,
        location: { viewport },
      }),
    );
  };

  page.on("request", (request) => {
    if (!isStream(new URL(request.url()))) open.add(request);
  });
  const done = (request: Request): void => {
    open.delete(request);
  };
  page.on("requestfinished", done);
  page.on("requestfailed", (request) => {
    done(request);
    const text = request.failure()?.errorText ?? "failed";
    // A request the page itself cancelled (an aborted fetch, a navigation away) didn't fail.
    if (/ERR_ABORTED|NS_BINDING_ABORTED|cancelled/i.test(text)) return;
    fail(request, `failed (${text})`);
  });
  page.on("response", (response: Response) => {
    const request = response.request();
    const url = new URL(request.url());
    const status = response.status();
    if (url.pathname.includes("/_mostra/v/")) {
      reading += 1;
      void onProtocol(request, url, response).finally(() => {
        reading -= 1;
      });
      return;
    }
    if (status >= 400) fail(request, `answered ${status}`);
  });

  const onProtocol = async (request: Request, url: URL, response: Response): Promise<void> => {
    if (request.method() !== "POST" || isStream(url)) return;
    const route = /\/_mostra\/v\/[^/]+\/(fields|call\/.+|runs|signal|submit)$/.exec(
      url.pathname,
    )?.[1];
    if (!route) return;
    log.push({ kind: "protocol" });
    if (route === "fields" && response.ok()) {
      const body = (await response.json().catch(() => ({}))) as { applied?: unknown[] };
      log.push({ kind: "write", ops: Array.isArray(body.applied) ? body.applied.length : 1 });
      return;
    }
    if (response.status() !== 409 || !(route === "runs" || route.startsWith("call/"))) return;
    const body = (await response.json().catch(() => ({}))) as { code?: unknown };
    if (body.code !== "MOSTRA_VERIFY_ACTION_SKIPPED") return;
    const fn = route.startsWith("call/")
      ? decodeURIComponent(route.slice("call/".length))
      : String((request.postDataJSON() as { fnId?: unknown } | null)?.fnId ?? "an action");
    log.push({ kind: "skip", fn });
  };

  return {
    inflight: () => open.size + reading,
    mark: () => log.length,
    skippedSince: (from) => [
      ...new Set(log.slice(from).flatMap((entry) => (entry.kind === "skip" ? [entry.fn] : []))),
    ],
    writesSince: (from) =>
      log.slice(from).reduce((sum, entry) => sum + (entry.kind === "write" ? entry.ops : 0), 0),
    protocolSince: (from) => log.slice(from).filter((entry) => entry.kind !== "write").length,
    findings: () => [...failures.values()],
  };
}
