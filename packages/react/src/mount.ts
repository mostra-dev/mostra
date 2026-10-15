/**
 * Mounting an artifact (D57, D111): the generated client entry hands the page to
 * {@link mountArtifact}, or its `pages/` routes to `mountRoutes` from `@mostra/react/router`. The
 * client runtime starts first, so the page renders with the viewer's saved answers rather than
 * flashing its defaults; after a short wait it renders anyway and catches up when the gateway
 * answers.
 */
import { mostraPage } from "@mostra/protocol";
import { type ComponentType, createElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { type ArtifactMode, RuntimeProvider } from "./hooks.ts";
import { type Runtime, startRuntime } from "./runtime/boot.ts";
import { reportReady } from "./shell-bridge.ts";
import { installStorage } from "./storage.ts";

/** How long the first render waits for the viewer's saved answers. */
const FIRST_RENDER_WAIT_MS = 3_000;

/** Starts the runtime, installs `window.storage`, and resolves once the page can render. */
export async function prepareArtifact(): Promise<Runtime> {
  const runtime = await startRuntime();
  installStorage(runtime.store);
  await runtime.store.whenReady(FIRST_RENDER_WAIT_MS);
  return runtime;
}

/** Renders `node` inside the runtime into `#root`, and reports `mostra/ready`. */
export function renderArtifact(runtime: Runtime, node: ReactNode): void {
  const root = document.getElementById("root");
  if (!root) throw new Error("The page has no #root element.");
  createRoot(root).render(
    createElement(
      RuntimeProvider,
      { store: runtime.store, mode: runtime.target as ArtifactMode },
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
