/// <reference lib="dom" />
/**
 * The anchor providers every page has (WP-20; ARCHITECTURE §8, D172 item 2): a kit chart's series
 * and datum, a slide and its step, a timeline's time. Each follows `@mostra/contract-anchor-provider`
 * (WP-25 packages the chart's as a first-party plugin). An author's own data attributes win:
 * `data-review-datum` and `data-review-series` name a datum of any chart, `data-slide-index` and
 * `data-slide-step` a slide, `data-timeline-time` a time.
 */
import type { PageAnchorProvider } from "./anchors.ts";

/** A chart's series key from a Recharts shape's colour, `var(--color-<key>)` (shadcn's charts). */
function seriesOf(element: Element): string | undefined {
  const own = element.closest("[data-review-series]")?.getAttribute("data-review-series");
  if (own) return own;
  for (const attribute of ["fill", "stroke"]) {
    const value = element.getAttribute(attribute) ?? "";
    const match = /var\(--color-([A-Za-z0-9_-]+)\)/.exec(value);
    if (match) return match[1];
  }
  return undefined;
}

/** The category ticks along a chart's x axis: their labels and centres. */
function ticks(chart: Element): { label: string; x: number }[] {
  return [...chart.querySelectorAll(".recharts-xAxis .recharts-cartesian-axis-tick")].map(
    (tick) => {
      const box = tick.getBoundingClientRect();
      return { label: (tick.textContent ?? "").trim(), x: box.left + box.width / 2 };
    },
  );
}

/** The tick nearest to a horizontal position. */
function nearest(
  list: readonly { label: string; x: number }[],
  x: number,
): { label: string; index: number } | undefined {
  let best: { label: string; index: number } | undefined;
  let distance = Number.POSITIVE_INFINITY;
  list.forEach((tick, index) => {
    const d = Math.abs(tick.x - x);
    if (d < distance) {
      distance = d;
      best = { label: tick.label, index };
    }
  });
  return best;
}

const CHART = "[data-chart], [data-slot='chart'], .recharts-wrapper";

/** A kit chart's datum: its series and category (Recharts through the kit's chart part). */
export const chartDatum: PageAnchorProvider = {
  id: "chart-datum",
  kind: "chart-datum",
  matches: ({ target }) => target.closest(CHART) !== null,
  serialize: ({ target, point }) => {
    const chart = target.closest(CHART);
    if (!chart) return undefined;
    const own = target.closest("[data-review-datum]")?.getAttribute("data-review-datum");
    const series = seriesOf(target);
    const at =
      point ??
      (() => {
        const box = target.getBoundingClientRect();
        return { x: box.left + box.width / 2, y: box.top };
      })();
    const tick = own ? { label: own, index: -1 } : nearest(ticks(chart), at.x);
    if (!tick && !series) return undefined;
    const label = [series, tick?.label].filter(Boolean).join(", ");
    return {
      anchor: {
        ...(series !== undefined ? { series } : {}),
        ...(tick ? { datum: tick.label, index: tick.index } : {}),
      },
      ...(label !== "" ? { label } : {}),
    };
  },
  resolve: ({ anchor, root }) => {
    const datum = typeof anchor["datum"] === "string" ? anchor["datum"] : undefined;
    const series = typeof anchor["series"] === "string" ? anchor["series"] : undefined;
    for (const chart of root.querySelectorAll(CHART)) {
      const own = datum ? chart.querySelector(`[data-review-datum="${CSS.escape(datum)}"]`) : null;
      if (own) return { element: own };
      const list = ticks(chart);
      const index = datum ? list.findIndex((tick) => tick.label === datum) : -1;
      if (index < 0) continue;
      const shapes = [
        ...chart.querySelectorAll(".recharts-rectangle, .recharts-dot, .recharts-sector"),
      ].filter((shape) => series === undefined || seriesOf(shape) === series);
      const x = list[index]?.x ?? 0;
      const shape = shapes
        .map((element) => ({ element, box: element.getBoundingClientRect() }))
        .sort(
          (a, b) =>
            Math.abs(a.box.left + a.box.width / 2 - x) - Math.abs(b.box.left + b.box.width / 2 - x),
        )[0];
      if (shape) return { element: shape.element };
    }
    return undefined;
  },
};

/** A slide and its step (decks, WP-21): `data-slide-index`, `data-slide-step`. */
export const slideStep: PageAnchorProvider = {
  id: "slide",
  kind: "slide",
  matches: ({ target }) => target.closest("[data-slide-index]") !== null,
  serialize: ({ target }) => {
    const slide = target.closest("[data-slide-index]");
    if (!slide) return undefined;
    const index = Number(slide.getAttribute("data-slide-index")) || 0;
    const step = Number(slide.getAttribute("data-slide-step")) || 0;
    return {
      anchor: { index, step },
      label: `Slide ${index + 1}${step > 0 ? `, step ${step}` : ""}`,
    };
  },
  resolve: ({ anchor, root }) => {
    const element = root.querySelector(`[data-slide-index="${Number(anchor["index"]) || 0}"]`);
    return element ? { element } : undefined;
  },
};

/** A time on a timeline (motion and video, WP-21): `data-timeline-time`, in seconds. */
export const timelineTime: PageAnchorProvider = {
  id: "timeline",
  kind: "timeline",
  matches: ({ target }) => target.closest("[data-timeline-time]") !== null,
  serialize: ({ target }) => {
    const timeline = target.closest("[data-timeline-time]");
    if (!timeline) return undefined;
    const time = Math.max(0, Number(timeline.getAttribute("data-timeline-time")) || 0);
    const id = timeline.getAttribute("data-timeline") ?? undefined;
    return { anchor: { time, ...(id ? { timeline: id } : {}) }, label: `At ${time.toFixed(1)} s` };
  },
  resolve: ({ anchor, root }) => {
    const id = typeof anchor["timeline"] === "string" ? anchor["timeline"] : undefined;
    const element = root.querySelector(
      id ? `[data-timeline="${CSS.escape(id)}"]` : "[data-timeline-time]",
    );
    return element ? { element } : undefined;
  },
};

/** The built-in providers, finest first. */
export const BUILT_IN_PROVIDERS: readonly PageAnchorProvider[] = [
  chartDatum,
  slideStep,
  timelineTime,
];
