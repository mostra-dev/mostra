/// <reference lib="dom" />
/**
 * The verify runner (ARCHITECTURE §1, ROUND-3 §9, D138): one warm headless Chromium that renders
 * capability links the supervisor's sandbox minted, each in a fresh browser context, and reports
 * what the page did. It decides what a page's behavior means for the verdict (D72): definite
 * failures are errors, observations warnings or hints, and faults that follow from verify's own
 * refusal of an action are attributed to it. The supervisor decides everything else.
 */
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import {
  type CompareRequest,
  type CompareResult,
  createDiagnostic,
  type Diagnostic,
  type ProbedField,
  type RenderRequest,
  type RenderResult,
  RpcError,
  VERIFY_PROBE,
} from "@mostra/protocol";
import pixelmatch from "pixelmatch";
import {
  type Browser,
  type BrowserContext,
  chromium,
  type Frame,
  type Page,
} from "playwright-core";
import { PNG } from "pngjs";
import { watchNetwork } from "./network.ts";
import { dedupe, judge, recorded, settle } from "./observe.ts";
import { recorder } from "./recorder.ts";
import { runSmoke } from "./smoke.ts";

const require = createRequire(import.meta.url);

/** How long the runner keeps its browser without work (ROUND-3 §9): 10 minutes. */
export const RUNNER_IDLE_MS: number = 10 * 60 * 1000;

/** The longest a page may take to report `mostra/ready` before it is judged never ready. */
const READY_WAIT_MS = 15_000;

/** Options for {@link createRunner}. */
export interface RunnerOptions {
  /** Called when the runner has been idle for `idleMs`: the process exits then. */
  readonly onIdle?: () => void;
  /** How long without work counts as idle; {@link RUNNER_IDLE_MS} by default. */
  readonly idleMs?: number;
}

/** The runner of one process. */
export interface Runner {
  /** Renders one capability link in a fresh browser context and reports what the page did. */
  render(request: RenderRequest): Promise<RenderResult>;
  /** Compares two screenshots and writes the difference. */
  compare(request: CompareRequest): Promise<CompareResult>;
  /** Closes the browser. */
  close(): Promise<void>;
}

/** Whether a launch failed because the browser isn't installed. */
function browserMissing(error: unknown): boolean {
  return /Executable doesn't exist|browserType\.launch: .*(not found|ENOENT)/i.test(
    String((error as Error)?.message ?? error),
  );
}

/** Creates the runner; its browser starts on the first render. */
export function createRunner(options: RunnerOptions = {}): Runner {
  let browser: Promise<Browser> | undefined;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let busy = 0;
  let axeSource: string | undefined;

  const touch = (): void => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = undefined;
    if (busy > 0 || !options.onIdle) return;
    idleTimer = setTimeout(() => options.onIdle?.(), options.idleMs ?? RUNNER_IDLE_MS);
    idleTimer.unref?.();
  };

  const launch = (): Promise<Browser> => {
    browser ??= chromium.launch({ headless: true }).catch((error: unknown) => {
      browser = undefined;
      if (browserMissing(error)) {
        throw new RpcError(
          createDiagnostic("MOSTRA_ENV_BROWSER_MISSING", {
            message:
              "verify's browser, Playwright's Chromium headless shell, isn't installed for this runtime.",
          }),
        );
      }
      throw error;
    });
    return browser;
  };

  const work = async <T>(task: () => Promise<T>): Promise<T> => {
    busy += 1;
    touch();
    try {
      return await task();
    } finally {
      busy -= 1;
      touch();
    }
  };

  return {
    render: (request) =>
      work(async () => {
        axeSource ??= await readFile(require.resolve("axe-core/axe.min.js"), "utf8");
        return renderPage(await launch(), request, axeSource);
      }),
    compare: (request) => work(() => compareImages(request)),
    async close() {
      if (idleTimer) clearTimeout(idleTimer);
      const open = browser;
      browser = undefined;
      if (open) await (await open.catch(() => undefined))?.close();
    },
  };
}

/** The artifact's frame: the shell's only child frame. */
function artifactFrame(page: Page): Frame | undefined {
  return page.frames().find((frame) => frame.parentFrame() === page.mainFrame());
}

/** What the frame shows: whether any element has a visible box of nonzero area (D138 item 3). */
function showsSomething(): boolean {
  const visible = (element: Element): boolean => {
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    const style = getComputedStyle(element);
    return style.visibility !== "hidden" && style.display !== "none" && Number(style.opacity) > 0;
  };
  for (const element of document.querySelectorAll("img, svg, canvas, video")) {
    if (visible(element)) return true;
  }
  if (!document.body) return false;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (!node.textContent?.trim() || !node.parentElement || !visible(node.parentElement)) continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    const rect = range.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) return true;
  }
  return false;
}

/** Whether a PNG is one uniform color. */
export function uniform(png: Buffer): boolean {
  const image = PNG.sync.read(png);
  const { data } = image;
  for (let offset = 4; offset < data.length; offset += 4) {
    if (
      data[offset] !== data[0] ||
      data[offset + 1] !== data[1] ||
      data[offset + 2] !== data[2] ||
      data[offset + 3] !== data[3]
    )
      return false;
  }
  return true;
}

/** Renders one capability link and reports what the page did. */
async function renderPage(
  browser: Browser,
  request: RenderRequest,
  axeSource: string,
): Promise<RenderResult> {
  const started = Date.now();
  const timings: Record<string, number> = {};
  const findings: Diagnostic[] = [];
  const viewport = request.viewport.name;
  const location = { viewport };
  let timedOut = false;
  const left = (): number => request.deadline - Date.now();
  const context: BrowserContext = await browser.newContext({
    viewport: { width: request.viewport.width, height: request.viewport.height },
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
  });
  try {
    // The same instant for every render of a run (D138 item 4): `Date` is fixed, timers run.
    await context.clock.setFixedTime(request.clockMs);
    await context.addInitScript(recorder);
    const page = await context.newPage();
    // A popup (window.open, target=_blank) is closed at once: verify follows no link out.
    context.on("page", (other) => {
      if (other !== page) void other.close().catch(() => undefined);
    });
    const network = watchNetwork(page, () => artifactFrame(page), viewport);

    await page.goto(request.url, { waitUntil: "commit", timeout: Math.max(1000, left()) });
    let ready = false;
    try {
      await page.waitForFunction(
        () => {
          const state = document.documentElement.dataset["shell"];
          return state === "ready" || state === "error";
        },
        undefined,
        { timeout: Math.max(1, Math.min(READY_WAIT_MS, left())) },
      );
      ready = (await page.evaluate(() => document.documentElement.dataset["shell"])) === "ready";
    } catch {
      ready = false;
      timedOut = left() <= 0;
    }
    timings["ready"] = Date.now() - started;
    const frame = artifactFrame(page);
    if (!ready || !frame) {
      const shellError = await page
        .evaluate(() => document.documentElement.dataset["shellError"] ?? "")
        .catch(() => "");
      findings.push(
        createDiagnostic("MOSTRA_RUNTIME_NOT_READY", {
          message: `The page didn't report it was ready${shellError ? ` (the shell reported ${shellError})` : ""}.`,
          location,
        }),
      );
      if (frame)
        findings.push(
          ...judge(await recorded(frame), { kind: "load" }, network.skippedSince(0), viewport),
        );
      findings.push(...network.findings());
      return { ready: false, findings: dedupe(findings), timedOut, timingsMs: timings };
    }

    await frame.evaluate(() => document.fonts.ready.then(() => true)).catch(() => false);
    await settle(frame, network, request.deadline);
    timings["settled"] = Date.now() - started;

    let screenshot: RenderResult["screenshot"];
    let shot: Buffer | undefined;
    if (request.collect.screenshot) {
      const path = join(request.outDir, `${request.name}.png`);
      shot = await page.screenshot({ path, animations: "disabled", caret: "hide" });
      screenshot = { path, width: request.viewport.width, height: request.viewport.height };
      timings["screenshot"] = Date.now() - started;
    }
    // Blank only when nothing has a visible box and the picture is one color (D138 item 3).
    const shows = await frame.evaluate(showsSomething).catch(() => true);
    if (!shows && shot && uniform(shot)) {
      findings.push(
        createDiagnostic("MOSTRA_RUNTIME_BLANK", {
          message:
            "The page reported ready but shows nothing: no visible text, image, SVG, canvas or video, and its screenshot is one color.",
          location,
        }),
      );
    }

    let aria: RenderResult["aria"];
    if (request.collect.aria) {
      const text = await frame
        .locator("body")
        .ariaSnapshot({ timeout: Math.max(1000, Math.min(10_000, left())) })
        .catch(() => "");
      const path = join(request.outDir, `${request.name}.aria.yml`);
      await writeFile(path, text);
      aria = { path, text };
      timings["aria"] = Date.now() - started;
    }

    let fields: readonly ProbedField[] | undefined;
    if (request.collect.fields) {
      fields = await frame
        .evaluate(
          (name) =>
            ((globalThis as unknown as Record<string, { fields?: () => unknown } | undefined>)[
              name
            ]?.fields?.() ?? []) as ProbedField[],
          VERIFY_PROBE,
        )
        .catch(() => []);
    }

    if (request.collect.axe && left() > 0) {
      findings.push(...(await runAxe(frame, axeSource, viewport)));
      timings["axe"] = Date.now() - started;
    }

    // Faults while loading, judged before the smoke test adds its own.
    const loadEntries = await recorded(frame);
    findings.push(...judge(loadEntries, { kind: "load" }, network.skippedSince(0), viewport));

    let smoke: RenderResult["smoke"];
    if (request.collect.smoke && left() > 0) {
      const outcome = await runSmoke({
        page,
        frame,
        network,
        viewport,
        from: loadEntries.length,
        maxInteractions: request.collect.smoke.maxInteractions,
        deadline: Math.min(request.deadline, Date.now() + request.collect.smoke.maxMs),
      });
      findings.push(...outcome.findings);
      smoke = {
        interactions: outcome.interactions,
        stateChanges: outcome.stateChanges,
        skipped: network.skippedSince(0),
        budget: outcome.budget,
      };
      timings["smoke"] = Date.now() - started;
    }
    findings.push(...network.findings());
    if (left() <= 0) timedOut = true;
    return {
      ready: true,
      findings: dedupe(findings),
      ...(screenshot ? { screenshot } : {}),
      ...(aria ? { aria } : {}),
      ...(fields ? { fields } : {}),
      ...(smoke ? { smoke } : {}),
      timedOut,
      timingsMs: timings,
    };
  } finally {
    await context.close().catch(() => undefined);
  }
}

interface AxeResult {
  readonly violations: readonly {
    readonly id: string;
    readonly impact?: string | null;
    readonly help: string;
    readonly nodes: readonly { readonly target: readonly unknown[] }[];
  }[];
}

/**
 * axe-core's violations in the frame (axe's `incomplete` results aren't reported): critical and
 * serious are warnings, moderate and minor hints (D138 item 3). Injected unmodified.
 */
async function runAxe(frame: Frame, source: string, viewport: string): Promise<Diagnostic[]> {
  try {
    await frame.evaluate(source);
    const result = (await frame.evaluate(() =>
      (
        globalThis as unknown as {
          axe: { run(context: unknown, options: unknown): Promise<unknown> };
        }
      ).axe.run(document, { resultTypes: ["violations"] }),
    )) as AxeResult;
    return result.violations.map((violation) => {
      const targets = violation.nodes.slice(0, 3).map((node) => node.target.map(String).join(" "));
      const serious = violation.impact === "critical" || violation.impact === "serious";
      return createDiagnostic(serious ? "MOSTRA_A11Y_SERIOUS" : "MOSTRA_A11Y_MINOR", {
        message: `axe ${violation.id} (${violation.impact ?? "unrated"}): ${violation.help}. Found at ${targets.join(", ")}${violation.nodes.length > 3 ? " and more" : ""}.`,
        location: { viewport, ...(targets[0] ? { selector: targets[0] } : {}) },
        count: Math.max(1, violation.nodes.length),
      });
    });
  } catch {
    return [];
  }
}

/** Compares two screenshots with pixelmatch's perceptual threshold and writes the difference. */
export async function compareImages(request: CompareRequest): Promise<CompareResult> {
  const a = PNG.sync.read(await readFile(request.a));
  const b = PNG.sync.read(await readFile(request.b));
  if (a.width !== b.width || a.height !== b.height) return { ratio: 1, sizeChanged: true };
  const diff = new PNG({ width: a.width, height: a.height });
  const changed = pixelmatch(a.data, b.data, diff.data, a.width, a.height, { threshold: 0.1 });
  await writeFile(request.diff, PNG.sync.write(diff));
  return { ratio: changed / (a.width * a.height), sizeChanged: false };
}
