"use client";

/**
 * ECharts 6 in the page's theme (D26): for the charts Recharts lacks (heat maps, Sankey, treemaps,
 * candlesticks, graphs, calendars, very large data sets), an agent writes an ECharts option and
 * this draws it with a theme made from the page's tokens: the series colours in their fixed
 * order, the text, rules, tooltip and fonts of the theme, redrawn in place when the theme or its
 * light or dark changes (`setTheme`). It resizes with its container and describes itself for
 * screen readers (ECharts' `aria`). Takes `className`; `mostra add mostra-echarts` copies it (D68).
 */

import { type Tokens, useTokens } from "@mostra/kit/tokens";
import { cn } from "cn";
import * as echarts from "echarts";
import * as React from "react";

/** {@link EChart}'s props. */
export interface EChartProps extends Omit<React.ComponentProps<"figure">, "title"> {
  /** The chart, as ECharts' own option object (series, axes, visual maps, everything). */
  readonly option: echarts.EChartsOption;
  /** The chart's title, shown above it and naming it for screen readers. */
  readonly title?: React.ReactNode;
  /** The chart's height in CSS pixels. Default 320. */
  readonly height?: number;
  /** Draw on a canvas (default, for large data) or as SVG (crisp text, small data). */
  readonly renderer?: "canvas" | "svg";
  /** Called once with the chart, for events (`chart.on("click", …)`) and actions. */
  readonly onReady?: (chart: echarts.EChartsType) => void;
}

/** An ECharts theme from the page's tokens. */
export function echartsTheme(tokens: Tokens): Record<string, unknown> {
  const text = { color: tokens.mutedForeground, fontFamily: tokens.fontSans };
  const axis = {
    axisLine: { lineStyle: { color: tokens.border } },
    axisTick: { lineStyle: { color: tokens.border } },
    axisLabel: { color: tokens.mutedForeground, fontFamily: tokens.fontSans },
    splitLine: { lineStyle: { color: tokens.border } },
    splitArea: { areaStyle: { color: [tokens.card, tokens.muted] } },
    nameTextStyle: text,
  };
  return {
    color: [...tokens.chart],
    backgroundColor: "transparent",
    textStyle: { color: tokens.foreground, fontFamily: tokens.fontSans },
    title: {
      textStyle: { color: tokens.foreground, fontFamily: tokens.fontSans },
      subtextStyle: text,
    },
    legend: { textStyle: { color: tokens.foreground, fontFamily: tokens.fontSans } },
    tooltip: {
      backgroundColor: tokens.card,
      borderColor: tokens.border,
      textStyle: { color: tokens.cardForeground, fontFamily: tokens.fontSans },
    },
    categoryAxis: axis,
    valueAxis: axis,
    logAxis: axis,
    timeAxis: axis,
    visualMap: { textStyle: text, inRange: { color: [tokens.muted, tokens.chart[0]] } },
    dataZoom: {
      textStyle: text,
      borderColor: tokens.border,
      fillerColor: tokens.accent,
      handleStyle: { color: tokens.card, borderColor: tokens.input },
    },
    graph: { lineStyle: { color: tokens.border }, label: { color: tokens.foreground } },
    sankey: { lineStyle: { color: "source", opacity: 0.3 }, label: { color: tokens.foreground } },
    treemap: { label: { color: tokens.primaryForeground } },
    markLine: { lineStyle: { color: tokens.mutedForeground } },
  };
}

/** The option with its description for screen readers on and, unless it asks, no animation. */
const withDefaults = (option: echarts.EChartsOption): echarts.EChartsOption =>
  ({ aria: { enabled: true }, animation: false, ...option }) as echarts.EChartsOption;

/**
 * An ECharts chart in the page's theme.
 *
 * ```tsx
 * <EChart title="Load by hour" option={{ xAxis: { type: "category", data: hours }, yAxis: { type: "category", data: days }, visualMap: { min: 0, max: 10 }, series: [{ type: "heatmap", data: cells }] }} />
 * ```
 */
export function EChart({
  option,
  title,
  height = 320,
  renderer = "canvas",
  onReady,
  className,
  ...props
}: EChartProps): React.JSX.Element {
  const tokens = useTokens();
  const host = React.useRef<HTMLDivElement>(null);
  const chart = React.useRef<echarts.EChartsType | null>(null);
  const latest = React.useRef({ onReady, option, tokens });
  React.useLayoutEffect(() => {
    latest.current = { onReady, option, tokens };
  });
  const titleId = React.useId();

  // The chart itself, for the renderer it was made with, in the theme and with the option of now.
  React.useLayoutEffect(() => {
    const element = host.current;
    if (!element) return;
    const created = echarts.init(element, echartsTheme(latest.current.tokens) as never, {
      renderer,
    });
    created.setOption(withDefaults(latest.current.option), { notMerge: true });
    chart.current = created;
    const resize = new ResizeObserver(() => created.resize());
    resize.observe(element);
    latest.current.onReady?.(created);
    return () => {
      resize.disconnect();
      created.dispose();
      if (chart.current === created) chart.current = null;
    };
  }, [renderer]);

  // The theme, set again in place when the page's changes.
  React.useLayoutEffect(() => {
    chart.current?.setTheme(echartsTheme(tokens) as never);
  }, [tokens]);

  // The option, merged as ECharts merges it, with its description for screen readers on.
  React.useLayoutEffect(() => {
    chart.current?.setOption(withDefaults(option), { notMerge: true });
  }, [option]);

  return (
    <figure
      data-slot="echart"
      aria-labelledby={title !== undefined ? titleId : undefined}
      className={cn("flex min-w-0 flex-col gap-2 text-card-foreground", className)}
      {...props}
    >
      {title !== undefined && (
        <figcaption id={titleId} className="text-sm font-medium">
          {title}
        </figcaption>
      )}
      <div ref={host} style={{ height }} className="w-full min-w-0" />
    </figure>
  );
}
