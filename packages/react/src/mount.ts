"use client";

/**
 * Mounting an artifact (D57, D111): the generated client entry hands the page to
 * {@link mountArtifact}, or its `pages/` routes to `mountRoutes` from `@mostra/react/router`. The
 * client runtime starts first, so the page renders with the viewer's saved answers rather than
 * flashing its defaults; after a short wait it renders anyway and catches up when the gateway
 * answers.
 */
import { mostraPage, VERIFY_REPORT } from "@mostra/protocol";
import { type ComponentType, createElement, type ReactNode } from "react";
import { createRoot, type RootOptions } from "react-dom/client";
import { type ArtifactMode, RuntimeProvider } from "./hooks.ts";
import { type Runtime, startRuntime } from "./runtime/boot.ts";
import { setServerCallback } from "./server-reference.ts";
import { reportReady } from "./shell-bridge.ts";
import { installStorage } from "./storage.ts";

/** How long the first render waits for the viewer's saved answers. */
const FIRST_RENDER_WAIT_MS = 3_000;

/** Starts the runtime, installs `window.storage`, and resolves once the page can render. */
export async function prepareArtifact(): Promise<Runtime> {
  const runtime = await startRuntime();
  installStorage(runtime.store);
  // Server references call through this page's runtime in live mode (D54); elsewhere (a static
  // export, a page opened outside its shell) they keep refusing with `MOSTRA_TARGET_UNAVAILABLE`,
  // naming the function.
  if (runtime.store.mode === "live") {
    setServerCallback((id, args) => runtime.store.server.call(id, args));
  }
  await runtime.store.whenReady(FIRST_RENDER_WAIT_MS);
  return runtime;
}

/**
 * The root's error handlers: in the `verify` target, an error a boundary caught goes to verify's
 * recorder with its `cause` chain (React's default logs it with `console.error`, which verify
 * couldn't tell apart from the page's own logging); everywhere else, React's defaults.
 */
function rootOptions(mode: string): RootOptions | undefined {
  if (mode !== "verify") return undefined;
  const report = (globalThis as unknown as Record<string, unknown>)[VERIFY_REPORT];
  if (typeof report !== "function") return undefined;
  return { onCaughtError: (error: unknown) => (report as (error: unknown) => void)(error) };
}

/** Renders `node` inside the runtime into `#root`, and reports `mostra/ready`. */
export function renderArtifact(runtime: Runtime, node: ReactNode): void {
  const root = document.getElementById("root");
  if (!root) throw new Error("The page has no #root element.");
  createRoot(root, rootOptions(runtime.mode)).render(
    createElement(
      RuntimeProvider,
      { store: runtime.store, mode: runtime.mode as ArtifactMode },
      node,
    ),
  );
  reportReady();
}

/** Tells the shell which page the viewer is on (D57), so comments record it. */
export function reportPage(runtime: Runtime, path: string, title?: string): void {
  runtime.shell?.bridge.notify(mostraPage, {
    path,
    ...(title !== undefined && title !== "" ? { title } : {}),
  });
}

/**
 * Mounts a single-page artifact: the generated entry calls it with the entry's default export.
 * Artifact code doesn't need to.
 */
export async function mountArtifact(options: { readonly page: ComponentType }): Promise<void> {
  const runtime = await prepareArtifact();
  renderArtifact(runtime, createElement(options.page));
  reportPage(runtime, "/", document.title);
}
