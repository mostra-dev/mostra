/**
 * The frame's service worker in worker mode (D70, D158 item 5): where the shell and the artifact
 * are two sites, Mostra's own service worker at `/` signs every request of the frame with its
 * session. An artifact that registered its own worker at `/` would replace it and end the frame's
 * session silently, so the client runtime refuses that registration with a diagnostic the page
 * can see. A worker at a narrower scope is the artifact's own business and registers as usual.
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
 * In a worker-mode frame, refuses an artifact's own service worker at scope `/` with
 * `MOSTRA_HYGIENE_FRAME_SESSION` (rejecting the registration's promise and saying so on the
 * console), instead of letting it replace Mostra's and lose the page its session. Installed once,
 * before artifact code runs; a no-op anywhere else.
 */
export function guardFrameServiceWorker(): void {
  if (guarded || !workerModeFrame()) return;
  guarded = true;
  const container = navigator.serviceWorker;
  const register = container.register.bind(container);
  const guard: typeof container.register = (scriptURL, options) => {
    const script = new URL(String(scriptURL), location.href);
    // A registration's scope defaults to the script's own directory.
    const scope = new URL(options?.scope ?? "./", script);
    if (
      scope.origin === location.origin &&
      scope.pathname === "/" &&
      script.pathname !== MOSTRA_WORKER
    ) {
      const error = new MostraError(
        "MOSTRA_HYGIENE_FRAME_SESSION",
        `This page's frame session runs through Mostra's service worker at "/"; registering ${script.pathname} at that scope would end it. Register it at a narrower scope, such as "/app/".`,
      );
      console.error(`[MOSTRA_HYGIENE_FRAME_SESSION] ${error.message}`);
      return Promise.reject(error);
    }
    return register(scriptURL, options);
  };
  container.register = guard;
}
