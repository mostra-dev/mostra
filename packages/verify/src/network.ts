/**
 * What a verify render's page does on the network (D138 item 3): requests in flight (for the
 * quiescence wait), failed requests for resources the artifact's frame loaded, the sandbox's
 * refusals of actions that didn't opt into `dryRun()`, and the field writes the page made.
 *
 * A failed request counts when the artifact's frame loaded it, the frame the page ends in: its
 * document, scripts, styles, images, fonts and fetches. Requests the browser makes on its own (`/favicon.ico`) and Mostra's
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
  /**
   * Requests the artifact's frame made since a mark, its event stream aside: Mostra's protocol
   * (fields, calls, runs, signals, submits) and the page's own fetches alike, each an effect.
   */
  requestsSince(from: number): number;
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
    | { kind: "request" }
  )[] = [];
  // Failed requests by the frame that made them: only the artifact's frame of the end counts. The
  // shell loads a frame again when its load failed and it never greeted (D157 item 1); what the
  // frame it replaced failed to load isn't the artifact's.
  const failures = new Map<Frame, Map<string, Diagnostic>>();
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
    const of = request.frame();
    let seen = failures.get(of);
    if (!seen) {
      seen = new Map();
      failures.set(of, seen);
    }
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
    const known = seen.get(key);
    if (known) {
      seen.set(key, { ...known, count: (known.count ?? 1) + 1 });
      return;
    }
    seen.set(
      key,
      createDiagnostic(own ? "MOSTRA_NETWORK_REQUEST_FAILED" : "MOSTRA_NETWORK_EXTERNAL_FAILED", {
        message: `${request.resourceType()} ${request.method()} ${shown} ${why}.`,
        location: { viewport },
      }),
    );
  };

  page.on("request", (request) => {
    const url = new URL(request.url());
    if (isStream(url)) return;
    open.add(request);
    // Any request the page's own code makes is something a control did (GPT review finding 4).
    if (fromArtifact(request) && !url.pathname.startsWith("/_mostra/"))
      log.push({ kind: "request" });
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
    requestsSince: (from) => log.slice(from).filter((entry) => entry.kind !== "write").length,
    findings: () => {
      const own = frame();
      return own === undefined ? [] : [...(failures.get(own)?.values() ?? [])];
    },
  };
}
