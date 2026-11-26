"use client";

/**
 * A live chart for data that changes many times a second (D26, AC-08): uPlot on a canvas, fed by a
 * live source in append mode (`useLive(key, { mode: "append", window })`) or by values the page
 * holds. It keeps its points in column buffers it appends to, so a new point costs the same however
 * many the chart shows, and it draws at most once a frame (the client runtime's live updates
 * arrive once a frame). Its colours are the theme's series colours in their fixed order, its axes
 * and grid the theme's text and rules (D141), and every series is named in its legend, so none is
 * told apart by colour alone. Takes `className`; `mostra add mostra-live-chart` copies it (D68).
 */

import { useTokens } from "@mostra/kit/tokens";
import { useLive } from "@mostra/react";
import { cn } from "cn";
import * as React from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";

/** One series: the field (or, for array points, the position) it reads, and its name. */
export interface LiveChartSeries {
  /** The field of each point this series draws (`"cpu"`), or its index in an array point (`1`). */
  readonly key: string | number;
  /** Its name in the legend; default the key. */
  readonly label?: string;
  /** Its colour; default the theme's series colour for its place. */
  readonly color?: string;
}

/** A point: an object with the x field and each series' field, or `[x, y1, y2, …]`. */
export type LivePoint = Readonly<Record<string, unknown>> | readonly unknown[];

/** {@link LiveChart}'s props. */
export interface LiveChartProps extends Omit<React.ComponentProps<"figure">, "children" | "title"> {
  /** A live source of `live.ts`, or a key `mostra push` writes, read in append mode. */
  readonly source?: string;
  /** The points to draw, oldest first, when the page holds them itself (instead of `source`). */
  readonly values?: readonly LivePoint[];
  /** How many points the chart keeps and shows, newest last. Default 1,000; at most 100,000. */
  readonly window?: number;
  /** The x field of an object point. Default `"t"`; array points take their first element. */
  readonly x?: string;
  /**
   * Whether x is a time in milliseconds since 1970 (`Date.now()`), drawn as clock times. Default:
   * when the first x is past the year 1973 in milliseconds.
   */
  readonly time?: boolean;
  /** The series to draw, by field or index, with their names. */
  readonly series: readonly (string | number | LiveChartSeries)[];
  /** The chart's title, shown above it and naming it for screen readers. */
  readonly title?: React.ReactNode;
  /** The plot's height in CSS pixels. Default 240. */
  readonly height?: number;
  /** Fixed limits of the y axis; default they follow the data. */
  readonly yMin?: number;
  readonly yMax?: number;
  /** How a y value reads on its axis and in the legend. */
  readonly format?: (value: number) => string;
}

const DEFAULT_WINDOW = 1000;
const MAX_WINDOW = 100_000;

/**
 * Columns of the newest `window` points, in buffers twice as long: a point is written once, and
 * the buffers move back once every `window` points, so appending is constant time.
 */
class Columns {
  readonly #window: number;
  #xs: Float64Array;
  #ys: Float64Array[];
  #start = 0;
  #length = 0;

  constructor(window: number, series: number) {
    this.#window = window;
    this.#xs = new Float64Array(window * 2);
    this.#ys = Array.from({ length: series }, () => new Float64Array(window * 2));
  }

  get length(): number {
    return this.#length;
  }

  push(x: number, ys: readonly number[]): void {
    const capacity = this.#xs.length;
    if (this.#start + this.#length === capacity) {
      // Move the newest `window - 1` points back to the start, making room for this one.
      const keep = Math.min(this.#length, this.#window - 1);
      const from = this.#start + this.#length - keep;
      this.#xs.copyWithin(0, from, from + keep);
      for (const column of this.#ys) column.copyWithin(0, from, from + keep);
      this.#start = 0;
      this.#length = keep;
    }
    const at = this.#start + this.#length;
    this.#xs[at] = x;
    this.#ys.forEach((column, index) => {
      column[at] = ys[index] ?? Number.NaN;
    });
    if (this.#length === this.#window) this.#start += 1;
    else this.#length += 1;
  }

  /** The points kept, as uPlot's aligned data: views, never copies. */
  data(): uPlot.AlignedData {
    const end = this.#start + this.#length;
    return [
      this.#xs.subarray(this.#start, end),
      ...this.#ys.map((column) => column.subarray(this.#start, end)),
    ] as uPlot.AlignedData;
  }
}

const toNumber = (value: unknown): number => {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : Date.parse(value);
  }
  return Number.NaN;
};

function seriesOf(series: LiveChartProps["series"]): LiveChartSeries[] {
  return series.map((entry) =>
    typeof entry === "object" ? entry : { key: entry, label: String(entry) },
  );
}

/** A visually hidden element's classes: read by screen readers, never seen. */
const HIDDEN = "sr-only";

/** How often the legend and the summary follow the newest point. */
const TEXT_INTERVAL_MS = 250;

/** The summary screen readers read: how many points, and the newest. */
function summaryOf(
  newest: LivePoint | undefined,
  count: number,
  chart: {
    readonly x: string;
    readonly timeAxis: boolean;
    readonly series: readonly LiveChartSeries[];
    readonly format: ((value: number) => string) | undefined;
  },
): string {
  if (newest === undefined) return "No data yet.";
  const array = Array.isArray(newest);
  const xValue = xOf(newest, chart.x);
  const at = chart.timeAxis ? new Date(xValue).toLocaleTimeString() : String(xValue);
  const values = chart.series.map((entry) => {
    const value = toNumber(
      array
        ? newest[typeof entry.key === "number" ? entry.key : Number(entry.key)]
        : (newest as Record<string, unknown>)[String(entry.key)],
    );
    return `${entry.label ?? entry.key} ${chart.format ? chart.format(value) : value}`;
  });
  return `${count} points, the newest at ${at}: ${values.join(", ")}.`;
}

/** A point's x, as a number. */
const xOf = (point: LivePoint, x: string): number =>
  toNumber(Array.isArray(point) ? point[0] : (point as Record<string, unknown>)[x]);

/**
 * A chart of points that keep arriving: a live source in append mode, or points the page holds.
 *
 * ```tsx
 * <LiveChart source="latency" x="t" series={[{ key: "p50", label: "p50" }, { key: "p99", label: "p99" }]} window={10000} title="Latency (ms)" />
 * ```
 */
export function LiveChart({ source, values, ...props }: LiveChartProps): React.JSX.Element {
  return source !== undefined ? (
    <SourceChart source={source} {...props} />
  ) : (
    <PointsChart points={values ?? EMPTY} {...props} />
  );
}

const EMPTY: readonly LivePoint[] = [];

const windowOf = (window: number | undefined): number =>
  Math.max(1, Math.min(MAX_WINDOW, Math.floor(window ?? DEFAULT_WINDOW)));

/** A chart of a live source's values, read in append mode. */
function SourceChart({
  source,
  ...props
}: Omit<LiveChartProps, "values"> & { readonly source: string }): React.JSX.Element {
  const { data } = useLive(source, { mode: "append", window: windowOf(props.window) });
  return <PointsChart points={(data as readonly LivePoint[] | undefined) ?? EMPTY} {...props} />;
}

function PointsChart({
  points,
  window: windowProp,
  x = "t",
  time,
  series: seriesProp,
  title,
  height = 240,
  yMin,
  yMax,
  format,
  className,
  ...props
}: Omit<LiveChartProps, "values" | "source"> & {
  readonly points: readonly LivePoint[];
}): React.JSX.Element {
  const window = windowOf(windowProp);
  const tokens = useTokens();
  // Series written inline are a new array each render: they count as changed only by content.
  const seriesKey = JSON.stringify(seriesOf(seriesProp));
  const series = React.useMemo(() => JSON.parse(seriesKey) as LiveChartSeries[], [seriesKey]);
  const host = React.useRef<HTMLDivElement>(null);
  const plot = React.useRef<uPlot | null>(null);
  const columns = React.useRef<{ columns: Columns; last: unknown; key: string } | null>(null);
  const titleId = React.useId();
  const formatRef = React.useRef(format);
  React.useLayoutEffect(() => {
    formatRef.current = format;
  });
  // A time axis when asked, else when the first x reads as milliseconds since 1970 past 1973.
  const first = points[0];
  const firstX =
    first === undefined
      ? undefined
      : toNumber(Array.isArray(first) ? first[0] : (first as Record<string, unknown>)[x]);
  const timeAxis = time ?? (firstX !== undefined && firstX > 1e11);

  /** Appends what arrived since the last render, or starts over when the points were replaced. */
  const absorb = React.useCallback(
    (list: readonly LivePoint[]): void => {
      const key = `${seriesKey}|${x}|${window}|${timeAxis}`;
      let state = columns.current;
      let from = 0;
      if (state === null || state.key !== key) {
        state = { columns: new Columns(window, series.length), last: undefined, key };
        columns.current = state;
      } else if (state.last !== undefined) {
        // Points are kept by reference, so the last one taken marks where the new ones begin.
        const at = list.lastIndexOf(state.last as LivePoint);
        if (at === -1) {
          state = { columns: new Columns(window, series.length), last: undefined, key };
          columns.current = state;
        } else from = at + 1;
      }
      for (let index = from; index < list.length; index++) {
        const point = list[index] as LivePoint;
        const array = Array.isArray(point);
        const xValue = toNumber(array ? point[0] : (point as Record<string, unknown>)[x]);
        const ys = series.map((entry) =>
          toNumber(
            array
              ? point[typeof entry.key === "number" ? entry.key : Number(entry.key)]
              : (point as Record<string, unknown>)[String(entry.key)],
          ),
        );
        state.columns.push(timeAxis ? xValue / 1000 : xValue, ys);
      }
      if (list.length > 0) state.last = list[list.length - 1];
    },
    [seriesKey, series, x, window, timeAxis],
  );

  // The plot itself, made again when its series, its size or the theme change.
  React.useLayoutEffect(() => {
    const element = host.current;
    if (!element) return;
    const axis: uPlot.Axis = {
      stroke: tokens.mutedForeground,
      font: `11px ${tokens.fontSans}`,
      grid: { stroke: tokens.border, width: 1 },
      ticks: { stroke: tokens.border, width: 1 },
    };
    const options: uPlot.Options = {
      width: Math.max(1, element.clientWidth),
      height,
      pxAlign: 0,
      scales: {
        x: { time: timeAxis },
        y:
          yMin !== undefined || yMax !== undefined
            ? { range: [yMin ?? null, yMax ?? null] as never }
            : {},
      },
      axes: [
        axis,
        {
          ...axis,
          values: (_self, ticks) =>
            ticks.map((tick) => (formatRef.current ? formatRef.current(tick) : String(tick))),
        },
      ],
      cursor: { points: { size: 6 } },
      legend: { live: true },
      series: [
        { label: timeAxis ? "Time" : x },
        ...series.map((entry, index) => ({
          label: entry.label ?? String(entry.key),
          stroke: entry.color ?? (tokens.chart[index % 6] as string),
          width: 1.5,
          points: { show: false },
          value: (_self: uPlot, value: number | null) =>
            value === null || Number.isNaN(value)
              ? "–"
              : formatRef.current
                ? formatRef.current(value)
                : String(Math.round(value * 100) / 100),
        })),
      ],
    };
    const created = new uPlot(
      options,
      columns.current?.columns.data() ?? [[], ...series.map(() => [])],
      element,
    );
    plot.current = created;
    const resize = new ResizeObserver(() => {
      created.setSize({ width: Math.max(1, element.clientWidth), height });
    });
    resize.observe(element);
    return () => {
      resize.disconnect();
      created.destroy();
      if (plot.current === created) plot.current = null;
    };
  }, [tokens, series, height, yMin, yMax, timeAxis, x]);

  // Text that follows the points (the legend's newest values, the summary screen readers read)
  // changes a few times a second, not on every frame: people read it no faster, and laying text out
  // again 60 times a second costs a browser drawing in software most of its frame.
  const summaryRef = React.useRef<HTMLParagraphElement>(null);
  const textAt = React.useRef(Number.NEGATIVE_INFINITY);
  const drawn = React.useRef(0);

  // Each render with new points appends them and draws once, before the frame is painted.
  React.useLayoutEffect(() => {
    absorb(points);
    const state = columns.current;
    const current = plot.current;
    if (!current || !state) return;
    current.setData(state.columns.data(), true);
    drawn.current += 1;
    const newest = points.at(-1);
    // What the chart drew, for whoever measures it (a test, a host): the draws so far and the x
    // of the newest point, on the plot's own element, which no style reads.
    host.current?.setAttribute(
      "data-drawn",
      `${drawn.current} ${newest === undefined ? "" : String(xOf(newest, x))}`,
    );
    const now = performance.now();
    if (now - textAt.current < TEXT_INTERVAL_MS) return;
    textAt.current = now;
    // Without a pointer over the plot, the legend names the newest values.
    if (current.cursor.left === undefined || current.cursor.left < 0) {
      current.setLegend({ idx: Math.max(0, state.columns.length - 1) });
    }
    if (summaryRef.current) {
      summaryRef.current.textContent = summaryOf(newest, state.columns.length, {
        x,
        timeAxis,
        series,
        format: formatRef.current,
      });
    }
  }, [points, absorb, x, timeAxis, series]);

  return (
    <figure
      data-slot="live-chart"
      aria-labelledby={title !== undefined ? titleId : undefined}
      className={cn(
        "flex min-w-0 flex-col gap-2 text-card-foreground",
        "[&_.u-legend]:text-xs [&_.u-legend]:text-muted-foreground [&_.u-legend_.u-series>*]:px-1",
        "[&_.u-legend_th]:font-normal [&_.u-legend_.u-value]:tabular-nums [&_.u-legend_.u-value]:text-foreground",
        "[&_.u-select]:bg-(--accent)/50",
        className,
      )}
      {...props}
    >
      {title !== undefined && (
        <figcaption id={titleId} className="text-sm font-medium">
          {title}
        </figcaption>
      )}
      <div ref={host} style={{ minHeight: height }} aria-hidden="true" />
      {/* Written in place a few times a second (above), not by React on every frame. */}
      <p ref={summaryRef} className={HIDDEN} data-slot="live-chart-summary">
        No data yet.
      </p>
    </figure>
  );
}
