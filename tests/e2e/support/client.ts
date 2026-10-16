/**
 * Helpers for the client runtime's suites (WP-07): each test publishes its own copy of a fixture
 * artifact, so engines running at once never share a draft, a version or a submission, opens it
 * in the real shell as its own viewer, and reaches the artifact's frame.
 */
import { cpSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type FrameLocator, type Page, type TestInfo } from "@playwright/test";
import type { Client } from "./mostra.ts";

/** The e2e suites' own fixture artifacts. */
export const E2E_FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");

/** An artifact a test published for itself. */
export interface OwnArtifact {
  readonly artifactId: string;
  /** The copy's source directory, to edit and publish again. */
  readonly dir: string;
}

let copies = 0;

/** Copies a fixture to a directory of the test's own and publishes it. */
export async function publishOwn(
  client: Client,
  home: string,
  info: TestInfo,
  options: { readonly fixture?: string; readonly policy?: unknown } = {},
): Promise<OwnArtifact> {
  const fixture = options.fixture ?? "client";
  const name = `${fixture}-${info.project.name}-${process.pid}-${Date.now()}-${copies++}`;
  const dir = join(dirname(home), "sources", name);
  cpSync(join(E2E_FIXTURES, fixture), dir, { recursive: true });
  const receipt = await client.call<{ artifactId: string }>("artifact/publish", {
    source: { path: dir },
    ...(options.policy !== undefined ? { policy: options.policy } : {}),
  });
  return { artifactId: receipt.artifactId, dir };
}

/** Edits the copy's entry and publishes it again: a new version. */
export async function republish(
  client: Client,
  own: OwnArtifact,
  edit: (text: string) => string,
): Promise<{ version: number }> {
  const entry = join(own.dir, "index.tsx");
  const before = readFileSync(entry, "utf8");
  const after = edit(before);
  if (after === before) throw new Error("the edit changed nothing");
  writeFileSync(entry, after);
  return client.call("artifact/publish", { source: { path: own.dir } });
}

/** A link for the artifact acting as a viewer of this test's own. */
export async function linkFor(
  client: Client,
  artifactId: string,
  viewer: string,
  options: { readonly scopes?: readonly string[] } = {},
): Promise<string> {
  const link = await client.call<{ url: string }>("view/url", {
    artifact: { artifactId },
    viewer: { ref: viewer, name: viewer },
    ...(options.scopes ? { scopes: options.scopes } : {}),
  });
  return link.url;
}

/** Opens a link in the shell and waits until the page rendered; returns the frame. */
export async function openInShell(page: Page, url: string): Promise<FrameLocator> {
  await page.goto(url);
  await expect(page.locator("html")).toHaveAttribute("data-shell", "ready", { timeout: 20_000 });
  return page.frameLocator("iframe.mostra-frame");
}

/** Waits until the shell says every answer is saved. */
export async function saved(page: Page): Promise<void> {
  await expect(page.locator("[data-mostra-save]")).toHaveAttribute("data-mostra-save", "saved", {
    timeout: 10_000,
  });
}

/** The artifact's results as the host protocol gives them. */
export function results(client: Client, artifactId: string): Promise<Record<string, unknown>> {
  return client.call("results/get", { artifact: { artifactId } });
}

/** A unique viewer name for a test. */
export function viewerName(info: TestInfo, suffix = ""): string {
  return `${info.project.name}-${info.title.slice(0, 24)}-${Date.now()}${suffix}`.replace(
    /\s+/g,
    "-",
  );
}
