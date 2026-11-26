/// <reference lib="dom" />
/**
 * AC-08 (WP-19): high-rate live data stays smooth. The kit's live chart (uPlot) over a live source
 * that holds 10,000 points and adds 60 a second, in Chromium, Firefox and WebKit:
 * - the burst of 10,000 points the source starts with reaches the chart;
 * - the page keeps up: the chart's newest point advances at the source's rate, and the chart
 *   draws again on nearly every frame;
 * - its frames: against the same chart over the same points with none arriving (the control, in
 *   the same browser), the live page drops no more than the budget, so a dropped frame is the
 *   live data's cost and not the machine's.
 *
 * The chart's own summary for screen readers ("10000 points, the newest at 12345: …") is what the
 * test reads, so it measures what the page shows, through no hook of its own.
 */
import { expect, type Page, test } from "@playwright/test";
import { linkFor, openInShell, publishOwn } from "../support/client.ts";
import { Client, readRun } from "../support/mostra.ts";

const run = readRun();

/** The source's rate, points a second (`fixtures/live-chart/live.ts`). */
const RATE = 60;
/** How long each measurement runs. */
const SECONDS = 10;

/**
 * The targets, set from the measured baseline (PROGRESS-WP-19, AC-08): the chart's newest point
 * keeps within 5% of the source's rate; it draws on at least 85% of the frames the control draws
 * (each frame has a new point to show at 60 a second); and the live page's frame rate is at least
 * 85% of the control's, its long frames (two or more frames dropped at 60 Hz) at most 5 percentage
 * points more than the control's.
 */
const BUDGET = {
  rate: 0.95,
  drawsPerFrame: 0.85,
  frames: 0.85,
  longFrames: 0.05,
} as const;

interface Measure {
  /** The chart's newest point's advance, points a second. */
  readonly pointsPerSecond: number;
  /** How often the chart showed a new newest point, a second. */
  readonly draws: number;
  /** Animation frames a second. */
  readonly frames: number;
  /** The share of frames longer than 2.5 frames at 60 Hz (41.7 ms). */
  readonly longFrames: number;
  readonly p50: number;
  readonly p95: number;
}

/** Watches the chart's summary and the page's frames for `ms`. */
async function measure(page: Page, ms: number): Promise<Measure> {
  const frame = page.frames().find((candidate) => candidate !== page.mainFrame());
  if (!frame) throw new Error("the artifact's frame is missing");
  return frame.evaluate(async (duration) => {
    const summary = document.querySelector('[data-slot="live-chart-summary"]');
    if (!summary) throw new Error("the chart has no summary");
    const newest = (): number =>
      Number(/the newest at (\d+)/.exec(summary.textContent ?? "")?.[1] ?? Number.NaN);
    let draws = 0;
    const observer = new MutationObserver(() => {
      draws += 1;
    });
    observer.observe(summary, { childList: true, characterData: true, subtree: true });
    const intervals: number[] = [];
    const first = newest();
    const start = performance.now();
    await new Promise<void>((done) => {
      let last = start;
      const tick = (now: number): void => {
        intervals.push(now - last);
        last = now;
        if (now - start < duration) requestAnimationFrame(tick);
        else done();
      };
      requestAnimationFrame(tick);
    });
    observer.disconnect();
    const elapsed = (performance.now() - start) / 1000;
    intervals.shift();
    const sorted = [...intervals].sort((a, b) => a - b);
    const at = (q: number): number =>
      sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
    return {
      pointsPerSecond: (newest() - first) / elapsed,
      draws: draws / elapsed,
      frames: intervals.length / elapsed,
      longFrames:
        intervals.filter((interval) => interval > 41.7).length / Math.max(1, intervals.length),
      p50: at(0.5),
      p95: at(0.95),
    };
  }, ms);
}

/** Opens a chart page in a page of its own and waits for its 10,000 points. */
async function open(page: Page, url: string): Promise<number> {
  const opened = performance.now();
  const frame = await openInShell(page, url);
  await expect(frame.locator('[data-slot="live-chart-summary"]')).toContainText(/^10000 points/, {
    timeout: 60_000,
  });
  return (performance.now() - opened) / 1000;
}

const round = (value: number): number => Math.round(value * 100) / 100;

test.describe("high-rate live data stays smooth (AC-08)", () => {
  test("the live chart keeps 10,000 points and 60 new ones a second, and drops no more frames than its budget", async ({
    browser,
  }, info) => {
    test.setTimeout(180_000);
    const client = await Client.connect(run.socket);
    try {
      const live = await publishOwn(client, run.home, info, { fixture: "live-chart" });
      const still = await publishOwn(client, run.home, info, { fixture: "live-chart-still" });
      const viewer = `ac08-${info.project.name}`;

      // The control first: the same chart, the same points, none arriving.
      const control = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      await open(control, await linkFor(client, still.artifactId, viewer));
      const baseline = await measure(control, SECONDS * 1000);
      await control.close();

      const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      const loaded = await open(page, await linkFor(client, live.artifactId, viewer));
      // The burst is behind it once the newest point moves at the source's rate.
      await page.waitForTimeout(2000);
      const result = await measure(page, SECONDS * 1000);
      await page.close();

      const report = {
        engine: info.project.name,
        platform: process.platform,
        loadedSeconds: round(loaded),
        control: Object.fromEntries(
          Object.entries(baseline).map(([key, value]) => [key, round(value)]),
        ),
        live: Object.fromEntries(Object.entries(result).map(([key, value]) => [key, round(value)])),
      };
      info.annotations.push({ type: "AC-08", description: JSON.stringify(report) });
      console.log(`AC-08 ${JSON.stringify(report)}`);

      expect(
        result.pointsPerSecond,
        "the chart's newest point keeps the source's rate",
      ).toBeGreaterThanOrEqual(RATE * BUDGET.rate);
      expect(
        result.draws,
        "the chart draws a new point on nearly every frame the control draws",
      ).toBeGreaterThanOrEqual(Math.min(RATE, baseline.frames) * BUDGET.drawsPerFrame);
      expect(
        result.frames,
        "the live page's frame rate against the control's",
      ).toBeGreaterThanOrEqual(baseline.frames * BUDGET.frames);
      expect(result.longFrames, "long frames beyond the control's").toBeLessThanOrEqual(
        baseline.longFrames + BUDGET.longFrames,
      );
    } finally {
      client.close();
    }
  });
});
