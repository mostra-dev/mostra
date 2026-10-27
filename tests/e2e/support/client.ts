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
  try {
    await expect(page.locator("html")).toHaveAttribute("data-shell", "ready", { timeout: 20_000 });
  } catch (error) {
    // The page says it is ready from an animation frame, which a browser runs only for a document
    // it renders: say what each document's visibility was and whether a frame ran (#39).
    throw new Error(`${(error as Error).message}\n${await rendering(page)}`, { cause: error });
  }
  return page.frameLocator("iframe.mostra-frame");
}

/** Each document of `page`: its visibility, focus, and whether an animation frame runs in 2 s. */
async function rendering(page: Page): Promise<string> {
  const lines: string[] = [];
  for (const frame of page.frames()) {
    const seen = await frame
      .evaluate(() =>
        new Promise<string>((done) => {
          const timer = setTimeout(() => done("no animation frame within 2 s"), 2000);
          requestAnimationFrame(() => {
            clearTimeout(timer);
            done("an animation frame ran");
          });
        }).then(
          (frameRan) =>
            `visibility ${document.visibilityState}, focus ${document.hasFocus()}, ${frameRan}`,
        ),
      )
      .catch((error: unknown) => `unreadable: ${(error as Error).message.split("\n")[0]}`);
    const kind = frame === page.mainFrame() ? "shell" : "frame";
    lines.push(`  ${kind} ${frame.url().split("#")[0]}: ${seen}`);
  }
  return `What the browser renders (#39):\n${lines.join("\n")}`;
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

/**
 * What the page and its frame saw while a test typed (#46, #85): every focus change, input event
 * and value with the time, whether each document had the focus, and what either page threw. In
 * WebKit a `fill` has twice left a field empty while the page reported "Saved", the second time
 * with the next field's text where it belonged; `typed` fails at the field with this record, so an
 * occurrence says whether the frame lost the focus or the input never came.
 */
export async function watchTyping(
  page: Page,
  frame: FrameLocator,
): Promise<{ typed(testId: string, value: string): Promise<void> }> {
  const thrown: string[] = [];
  page.on("pageerror", (error) => thrown.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") thrown.push(message.text());
  });
  const watch = (where: string): void => {
    const seen: string[] = [];
    (globalThis as unknown as { __typing: string[] }).__typing = seen;
    // Absolute times: the shell's and the frame's documents count from different origins.
    const at = (): string => (performance.timeOrigin + performance.now()).toFixed(1);
    const note = (what: string): void => {
      seen.push(`${at()} ${where} ${what} (focus: ${document.hasFocus()})`);
    };
    for (const type of ["focusin", "focusout", "beforeinput", "input", "change"]) {
      document.addEventListener(
        type,
        (event) => {
          const target = event.target as HTMLInputElement;
          note(`${type} ${target.dataset?.["testid"] ?? target.tagName} "${target.value ?? ""}"`);
        },
        true,
      );
    }
    for (const type of ["focus", "blur"]) {
      window.addEventListener(type, (event) => {
        if (event.target === window) note(`window ${type}`);
      });
    }
  };
  const inFrame = await (await frame.locator("body").elementHandle())?.ownerFrame();
  if (!inFrame) throw new Error("The artifact's frame has no document to watch.");
  await page.evaluate(watch, "shell");
  await inFrame.evaluate(watch, "frame");
  const record = async (): Promise<string> => {
    const read = (): string[] => (globalThis as unknown as { __typing?: string[] }).__typing ?? [];
    const lines = [
      ...(await page.evaluate(read).catch(() => [])),
      ...(await inFrame.evaluate(read).catch(() => [])),
    ];
    return lines.sort((a, b) => Number.parseFloat(a) - Number.parseFloat(b)).join("\n");
  };
  return {
    async typed(testId, value) {
      try {
        await expect(frame.getByTestId(testId)).toHaveValue(value);
      } catch (error) {
        throw new Error(
          `${(error as Error).message}\npage errors: ${thrown.join(" | ")}\ntyping:\n${await record()}`,
        );
      }
    },
  };
}
