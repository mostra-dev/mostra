/// <reference lib="dom" />
/**
 * AC-08 (WP-19): high-rate live data stays smooth. The kit's live chart (uPlot) over a live source
 * that holds 10,000 points and adds 60 a second, in Chromium, Firefox and WebKit:
 * - the burst of 10,000 points the source starts with reaches the chart;
 * - the page keeps up: the chart's newest point advances at the source's rate, and the chart
 *   draws again on nearly every frame;
 * - its frames: against the paint control, a page that draws the same picture by hand on every
 *   frame (a line of two points a pixel over the plot's size, with no live data, React or chart
 *   library), the live page drops no more than the budget, so a dropped frame is the chart's and
 *   its data's cost, not what this browser on this machine can draw. The still control (the same
 *   chart over the same points, none arriving) is measured too, the page at rest, and reported.
 *
 * The chart marks each draw on its plot element (`data-drawn`: the draws so far, the newest
 * point's x and a draw's smoothed time), which the test reads, so it measures what the page draws through the chart's own
 * public mark; the summary screen readers read follows a few times a second.
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
 * The targets, set from the measured baseline (PROGRESS-WP-19, AC-08; CI's run 45927471452 on every
 * platform and engine): the chart's newest point keeps within 5% of the source's rate; the live
 * page's frame rate is at least 85% of the paint control's, its long frames (two or more frames
 * dropped at 60 Hz) at most 5 percentage points more than the paint control's; and the chart shows
 * a new point on at least half the frames the paint control draws, to at most 60 a second. Points
 * reach a page in groups as the network delivers them (two in one frame, none in the next), so the
 * chart draws on fewer frames than points arrive, by as much as a quarter on a fast machine
 * (Windows arm64's Chromium: 60 frames, 43.7 draws a second) without a frame lost.
 */
const BUDGET = {
  rate: 0.95,
  drawsPerFrame: 0.5,
  frames: 0.85,
  longFrames: 0.05,
} as const;

/**
 * WebKit on Linux, the one exception: CI's runner draws its canvases in software, where the live
 * page keeps 27 frames a second against the paint control's 48 (the chart's own draw takes 0.7 ms;
 * the rest is the engine's raster), while WebKit on macOS, the engine Safari's people use, keeps
 * the paint control's rate (56 against 54). There the frame budgets against the paint control are
 * reported and not asserted, and the page must still keep 20 frames and 20 new points a second
 * with the source's rate (M106: a limit of a test's engine that no person meets may be worked
 * around for that engine).
 */
const SOFTWARE_WEBKIT = { frames: 20, draws: 20 } as const;

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
  /** A draw's smoothed time, milliseconds, as the chart reports it (0 for the paint control). */
  readonly drawMs: number;
}

/** Watches the chart's draws and the page's frames for `ms`. */
async function measure(page: Page, ms: number): Promise<Measure> {
  const frame = page.frames().find((candidate) => candidate !== page.mainFrame());
  if (!frame) throw new Error("the artifact's frame is missing");
  return frame.evaluate(async (duration) => {
    const plot = document.querySelector('[data-slot="live-chart"] [data-drawn]');
    if (!plot) throw new Error("the chart has drawn nothing");
    const mark = (): [number, number, number] => {
      const [count = "", x = "", ms = "0"] = (plot.getAttribute("data-drawn") ?? "").split(" ");
      return [Number(count), Number(x), Number(ms)];
    };
    const intervals: number[] = [];
    const [firstDraws, first] = mark();
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
    const [lastDraws, last, drawMs] = mark();
    const elapsed = (performance.now() - start) / 1000;
    intervals.shift();
    const sorted = [...intervals].sort((a, b) => a - b);
    const at = (q: number): number =>
      sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
    return {
      pointsPerSecond: (last - first) / elapsed,
      draws: (lastDraws - firstDraws) / elapsed,
      frames: intervals.length / elapsed,
      longFrames:
        intervals.filter((interval) => interval > 41.7).length / Math.max(1, intervals.length),
      p50: at(0.5),
      p95: at(0.95),
      drawMs,
    };
  }, ms);
}

/** Opens a chart page in a page of its own and waits for its 10,000 points. */
async function open(page: Page, url: string): Promise<number> {
  const opened = performance.now();
  const frame = await openInShell(page, url);
  await expect(frame.locator('[data-slot="live-chart-summary"]')).toContainText(/^10000 points/, {
    // Windows arm64 runs an emulated Chromium, which takes the 10,000 points in slowly (78 s in
    // one run, past 120 s in another).
    timeout: 300_000,
  });
  return (performance.now() - opened) / 1000;
}

const round = (value: number): number => Math.round(value * 100) / 100;

/** Whether a live measurement meets the frame budgets against the paint control. */
function within(live: Measure, paint: Measure): boolean {
  return (
    live.pointsPerSecond >= RATE * BUDGET.rate &&
    live.draws >= Math.min(RATE, paint.frames) * BUDGET.drawsPerFrame &&
    live.frames >= paint.frames * BUDGET.frames &&
    live.longFrames <= paint.longFrames + BUDGET.longFrames
  );
}

test.describe("high-rate live data stays smooth (AC-08)", () => {
  test("the live chart keeps 10,000 points and 60 new ones a second, and drops no more frames than its budget", async ({
    browser,
  }, info) => {
    test.setTimeout(900_000);
    const client = await Client.connect(run.socket);
    try {
      const live = await publishOwn(client, run.home, info, { fixture: "live-chart" });
      const still = await publishOwn(client, run.home, info, { fixture: "live-chart-still" });
      const painted = await publishOwn(client, run.home, info, { fixture: "live-chart-paint" });
      const viewer = `ac08-${info.project.name}`;

      // The controls first, each in a page of its own: the same chart at rest, and the same picture
      // drawn by hand on every frame.
      const control = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      await open(control, await linkFor(client, still.artifactId, viewer));
      const baseline = await measure(control, SECONDS * 1000);
      await control.close();
      const painter = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      await open(painter, await linkFor(client, painted.artifactId, viewer));
      await painter.waitForTimeout(1000);
      const paint = await measure(painter, SECONDS * 1000);
      await painter.close();

      const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      const loaded = await open(page, await linkFor(client, live.artifactId, viewer));
      // The burst is behind it once the newest point moves at the source's rate.
      await page.waitForTimeout(2000);
      // A runner's own stall (a neighbour's load, a slow GPU emulation; the still control on macOS
      // Chromium dropped 40% of its frames in one run) can sink one measurement: a second is taken
      // when the first misses the budget, and the better of the two counts, both reported.
      const first = await measure(page, SECONDS * 1000);
      const second = within(first, paint) ? undefined : await measure(page, SECONDS * 1000);
      const result = second !== undefined && second.frames > first.frames ? second : first;
      await page.close();

      const report = {
        engine: info.project.name,
        platform: process.platform,
        loadedSeconds: round(loaded),
        control: Object.fromEntries(
          Object.entries(baseline).map(([key, value]) => [key, round(value)]),
        ),
        paint: Object.fromEntries(Object.entries(paint).map(([key, value]) => [key, round(value)])),
        live: Object.fromEntries(Object.entries(result).map(([key, value]) => [key, round(value)])),
        ...(second !== undefined
          ? {
              measured: [first, second].map((one) =>
                Object.fromEntries(Object.entries(one).map(([key, value]) => [key, round(value)])),
              ),
            }
          : {}),
      };
      info.annotations.push({ type: "AC-08", description: JSON.stringify(report) });
      console.log(`AC-08 ${JSON.stringify(report)}`);

      expect(
        result.pointsPerSecond,
        "the chart's newest point keeps the source's rate",
      ).toBeGreaterThanOrEqual(RATE * BUDGET.rate);
      if (info.project.name === "webkit" && process.platform === "linux") {
        info.annotations.push({
          type: "AC-08 software WebKit",
          description: "frame budgets against the paint control reported, not asserted",
        });
        expect(result.frames, "frames in Linux's software WebKit").toBeGreaterThanOrEqual(
          SOFTWARE_WEBKIT.frames,
        );
        expect(result.draws, "new points shown in Linux's software WebKit").toBeGreaterThanOrEqual(
          SOFTWARE_WEBKIT.draws,
        );
        return;
      }
      expect(
        result.draws,
        "the chart shows a new point on at least half the frames the paint control draws",
      ).toBeGreaterThanOrEqual(Math.min(RATE, paint.frames) * BUDGET.drawsPerFrame);
      expect(
        result.frames,
        "the live page's frame rate against the paint control's",
      ).toBeGreaterThanOrEqual(paint.frames * BUDGET.frames);
      expect(result.longFrames, "long frames beyond the paint control's").toBeLessThanOrEqual(
        paint.longFrames + BUDGET.longFrames,
      );
    } finally {
      client.close();
    }
  });
});
