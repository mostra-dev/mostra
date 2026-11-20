/**
 * A page inline tells its host its height (`watchHeight`, D175 item 6): as its content changes,
 * and never in a loop with a frame that grows to every height it reports, as a page sized by the
 * viewport would (review finding Fable 7).
 */
import { describe, expect, it } from "vitest";
import { type HeightSources, watchHeight } from "../src/runtime/mcp-app.ts";

/** A frame the host resizes to each height reported, up to `max`, with the page's own height. */
function frame(page: (viewport: number) => number, max = 10_000) {
  let viewport = 150;
  let changed: (() => void) | undefined;
  const reported: number[] = [];
  const sources: HeightSources = {
    height: () => page(viewport),
    viewport: () => viewport,
    observe: (fn) => {
      changed = fn;
    },
    frame: (fn) => fn(),
  };
  const report = (height: number): void => {
    reported.push(height);
    // The host takes it: the frame resizes, and the page lays out again.
    viewport = Math.min(height, max);
    changed?.();
  };
  return { sources, report, reported, relayout: () => changed?.() };
}

describe("a page's height inline (Fable 7)", () => {
  it("reports a page sized by the viewport once, never growing with the frame", () => {
    // `min-height: 100vh` and the bar's 40 px beneath it.
    const host = frame((viewport) => viewport + 40);
    watchHeight(host.report, host.sources);
    host.relayout();
    host.relayout();
    expect(host.reported).toEqual([190]);
  });

  it("reports content as it changes, after the frame took the last height", () => {
    let content = 600;
    const host = frame(() => content);
    watchHeight(host.report, host.sources);
    content = 800;
    host.relayout();
    content = 500;
    host.relayout();
    expect(host.reported).toEqual([600, 800, 500]);
  });

  it("keeps a page taller than a frame the host caps at its height, without asking again", () => {
    const host = frame(() => 1_200, 600);
    watchHeight(host.report, host.sources);
    host.relayout();
    expect(host.reported).toEqual([1_200]);
  });
});
