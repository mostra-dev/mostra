/**
 * The frame's service worker in worker mode (D70, D158 item 5): where the shell and the artifact
 * are two sites, Mostra's own service worker at `/` signs every request of the frame with its
 * session. An artifact's own worker can't run there: its script is fetched without the session
 * (a browser adds nothing to that request), and a page it controlled would send requests no
 * worker signs, so the page would lose its session. The client runtime refuses such a
 * registration with a diagnostic the page can see, rather than letting it fail obscurely or end
 * the session. On a tailnet, Funnel or local link (cookie mode) the artifact registers its own
 * workers as usual.
 */
import { MostraError } from "./errors.ts";

/** Mostra's worker, which the gateway serves on every worker-mode artifact origin. */
const MOSTRA_WORKER = "/_mostra/sw.js";

/** Whether this page runs under Mostra's worker-mode service worker. */
export function workerModeFrame(): boolean {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return false;
  const controller = navigator.serviceWorker.controller;
  if (!controller) return false;
  try {
    return new URL(controller.scriptURL).pathname === MOSTRA_WORKER;
  } catch {
    return false;
  }
}

let guarded = false;

/**
 * In a worker-mode frame, refuses an artifact's own service worker with
 * `MOSTRA_HYGIENE_FRAME_SESSION` (rejecting the registration's promise and saying so on the
 * console), instead of letting it fail without its session or end the page's. Installed once,
 * before artifact code runs; a no-op anywhere else.
 */
export function guardFrameServiceWorker(): void {
  if (guarded || !workerModeFrame()) return;
  guarded = true;
  const container = navigator.serviceWorker;
  const register = container.register.bind(container);
  const guard: typeof container.register = (scriptURL, options) => {
    const script = new URL(String(scriptURL), location.href);
    if (script.origin === location.origin && script.pathname === MOSTRA_WORKER) {
      return register(scriptURL, options);
    }
    const scope = new URL(options?.scope ?? "./", script);
    const error = new MostraError(
      "MOSTRA_HYGIENE_FRAME_SESSION",
      `This page opened through a link whose frame runs on Mostra's own service worker (a public Cloudflare link), so ${script.pathname} can't be registered here (scope ${scope.pathname}): it would run without the page's session. On a tailnet, Funnel or local link the page registers its own service workers.`,
    );
    console.error(`[MOSTRA_HYGIENE_FRAME_SESSION] ${error.message}`);
    return Promise.reject(error);
  };
  container.register = guard;
}
