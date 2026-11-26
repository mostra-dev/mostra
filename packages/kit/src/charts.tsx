"use client";

/**
 * Charts in the page's theme (D26, D141): bar, line, area and donut charts on Recharts 3, the
 * library shadcn's chart builds on, for the charts most pages show. Series take the theme's series
 * colours in their fixed order (`--chart-1` to `--chart-6`), axes and grid its text and rules, the
 * tooltip its card; every series is named in a legend, so none is told apart by colour alone; and
 * each series' shapes carry `var(--color-<series>)`, so a comment on a bar or a point anchors to
 * its series and datum (WP-20). For anything else, Recharts itself is one import away. Every chart
 * takes `className`, and `mostra add mostra-charts` copies the module (D68).
 */

import { cn } from "cn";
import * as React from "react";
import {
  Area,
  Bar,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  Pie,
  AreaChart as RechartsAreaChart,
  BarChart as RechartsBarChart,
  LineChart as RechartsLineChart,
  PieChart as RechartsPieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

/** One series: the field of each row it draws, and its name. */
export interface ChartSeries {
  /** The field of each row (`"revenue"`). */
  readonly key: string;
  /** Its name in the legend and the tooltip; default the key. */
  readonly label?: string;
  /** Its colour; default the theme's series colour for its place. */
  readonly color?: string;
}

/** A row of a chart's data: the category (or x) field and each series' value. */
export type ChartRow = Readonly<Record<string, unknown>>;

/** What every cartesian chart takes. */
export interface CartesianChartProps extends Omit<React.ComponentProps<"figure">, "title"> {
  /** The rows, in the order the x axis shows them. */
  readonly data: readonly ChartRow[];
  /** The field naming each row on the x axis (`"month"`). */
  readonly x: string;
  /** The series to draw, by field, with their names. */
  readonly series: readonly (string | ChartSeries)[];
  /** The chart's title, shown above it and naming it for screen readers. */
  readonly title?: React.ReactNode;
  /** The plot's height in CSS pixels. Default 260. */
  readonly height?: number;
  /** How a value reads on the y axis and in the tooltip. */
  readonly format?: (value: number) => string;
  /** Stack the series instead of drawing them side by side or over each other. */
  readonly stacked?: boolean;
  /** Show the legend; default when there is more than one series. */
  readonly legend?: boolean;
}

/** The CSS variable a series' colour lives in, from its key: what anchors read (WP-20). */
const variableOf = (key: string): string => `--color-${key.replace(/[^A-Za-z0-9_-]/g, "_")}`;

function seriesOf(series: CartesianChartProps["series"]): Required<ChartSeries>[] {
  return series.map((entry, index) => {
    const one = typeof entry === "string" ? { key: entry } : entry;
    return {
      key: one.key,
      label: one.label ?? one.key,
      color: one.color ?? `var(--chart-${(index % 6) + 1})`,
    };
  });
}

/** The figure every chart sits in: its title, its colours as variables, and its height. */
function Frame({
  title,
  height,
  colors,
  className,
  children,
  style,
  ...props
}: Omit<React.ComponentProps<"figure">, "title"> & {
  readonly title?: React.ReactNode;
  readonly height: number;
  readonly colors: readonly { readonly key: string; readonly color: string }[];
  readonly children: React.ReactElement;
}): React.JSX.Element {
  const titleId = React.useId();
  const variables = Object.fromEntries(colors.map((one) => [variableOf(one.key), one.color]));
  return (
    <figure
      data-slot="chart"
      data-chart={titleId}
      aria-labelledby={title !== undefined ? titleId : undefined}
      className={cn(
        "flex min-w-0 flex-col gap-2 text-xs text-card-foreground",
        "[&_.recharts-cartesian-axis-tick_text]:fill-muted-foreground [&_.recharts-surface]:outline-hidden",
        "[&_.recharts-legend-item-text]:text-foreground!",
        className,
      )}
      style={{ ...variables, ...style } as React.CSSProperties}
      {...props}
    >
      {title !== undefined && (
        <figcaption id={titleId} className="text-sm font-medium">
          {title}
        </figcaption>
      )}
      <div style={{ height }} className="w-full min-w-0">
        <ResponsiveContainer width="100%" height="100%">
          {children}
        </ResponsiveContainer>
      </div>
    </figure>
  );
}

/** The axes, grid, tooltip and legend every cartesian chart shares, in the theme. */
function chrome(
  x: string,
  format: ((value: number) => string) | undefined,
  legend: boolean,
): React.ReactNode[] {
  const tick = { fill: "var(--muted-foreground)", fontSize: 12 };
  const formatValue = (value: unknown): string =>
    typeof value === "number" && format ? format(value) : String(value);
  return [
    <CartesianGrid key="grid" vertical={false} stroke="var(--border)" />,
    <XAxis
      key="x"
      dataKey={x}
      tickLine={false}
      axisLine={{ stroke: "var(--border)" }}
      tick={tick}
      tickMargin={8}
    />,
    <YAxis
      key="y"
      tickLine={false}
      axisLine={false}
      tick={tick}
      width={48}
      tickFormatter={(value: unknown) => formatValue(value)}
    />,
    <Tooltip
      key="tooltip"
      cursor={{ fill: "var(--muted)", stroke: "var(--border)" }}
      formatter={(value: unknown) => formatValue(value)}
      contentStyle={{
        background: "var(--popover, var(--card))",
        color: "var(--popover-foreground, var(--card-foreground))",
        border: "1px solid var(--border)",
        borderRadius: "var(--popover-radius, var(--radius))",
        fontSize: 12,
      }}
      labelStyle={{ color: "var(--muted-foreground)" }}
    />,
    ...(legend
      ? [
          <Legend
            key="legend"
            verticalAlign="bottom"
            iconType="circle"
            iconSize={8}
            wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
          />,
        ]
      : []),
  ];
}

/**
 * Bars by category: one bar per series in each group, or stacked.
 *
 * ```tsx
 * <BarChart data={months} x="month" series={[{ key: "won", label: "Won" }, { key: "lost", label: "Lost" }]} title="Deals" />
 * ```
 */
export function BarChart({
  data,
  x,
  series: seriesProp,
  height = 260,
  format,
  stacked = false,
  legend,
  ...props
}: CartesianChartProps): React.JSX.Element {
  const series = seriesOf(seriesProp);
  return (
    <Frame height={height} colors={series} {...props}>
      <RechartsBarChart data={data as ChartRow[]} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
        {chrome(x, format, legend ?? series.length > 1)}
        {series.map((one, index) => (
          <Bar
            key={one.key}
            dataKey={one.key}
            name={one.label}
            fill={`var(${variableOf(one.key)})`}
            radius={stacked && index < series.length - 1 ? 0 : [3, 3, 0, 0]}
            {...(stacked ? { stackId: "stack" } : {})}
            isAnimationActive={false}
          />
        ))}
      </RechartsBarChart>
    </Frame>
  );
}

/** {@link LineChart}'s props. */
export interface LineChartProps extends CartesianChartProps {
  /** Draw each point as a dot. Default when there are at most 24 rows. */
  readonly dots?: boolean;
}

/**
 * Lines over a sequence: a trend per series.
 *
 * ```tsx
 * <LineChart data={weeks} x="week" series={["signups", "churn"]} format={(n) => n.toLocaleString()} />
 * ```
 */
export function LineChart({
  data,
  x,
  series: seriesProp,
  height = 260,
  format,
  legend,
  dots,
  stacked: _stacked,
  ...props
}: LineChartProps): React.JSX.Element {
  const series = seriesOf(seriesProp);
  const showDots = dots ?? data.length <= 24;
  return (
    <Frame height={height} colors={series} {...props}>
      <RechartsLineChart
        data={data as ChartRow[]}
        margin={{ top: 4, right: 8, left: 0, bottom: 0 }}
      >
        {chrome(x, format, legend ?? series.length > 1)}
        {series.map((one) => (
          <Line
            key={one.key}
            type="monotone"
            dataKey={one.key}
            name={one.label}
            stroke={`var(${variableOf(one.key)})`}
            strokeWidth={2}
            dot={showDots ? { r: 3, fill: `var(${variableOf(one.key)})`, strokeWidth: 0 } : false}
            activeDot={{ r: 4 }}
            isAnimationActive={false}
          />
        ))}
      </RechartsLineChart>
    </Frame>
  );
}

/**
 * Filled areas over a sequence, stacked to show a whole and its parts.
 *
 * ```tsx
 * <AreaChart data={days} x="day" series={["mobile", "desktop"]} stacked />
 * ```
 */
export function AreaChart({
  data,
  x,
  series: seriesProp,
  height = 260,
  format,
  stacked = false,
  legend,
  ...props
}: CartesianChartProps): React.JSX.Element {
  const series = seriesOf(seriesProp);
  return (
    <Frame height={height} colors={series} {...props}>
      <RechartsAreaChart
        data={data as ChartRow[]}
        margin={{ top: 4, right: 8, left: 0, bottom: 0 }}
      >
        {chrome(x, format, legend ?? series.length > 1)}
        {series.map((one) => (
          <Area
            key={one.key}
            type="monotone"
            dataKey={one.key}
            name={one.label}
            stroke={`var(${variableOf(one.key)})`}
            fill={`var(${variableOf(one.key)})`}
            fillOpacity={stacked ? 0.5 : 0.25}
            strokeWidth={2}
            {...(stacked ? { stackId: "stack" } : {})}
            isAnimationActive={false}
          />
        ))}
      </RechartsAreaChart>
    </Frame>
  );
}

/** One slice of a {@link DonutChart}. */
export interface DonutSlice {
  readonly label: string;
  readonly value: number;
  /** Its colour; default the theme's series colour for its place. */
  readonly color?: string;
}

/** {@link DonutChart}'s props. */
export interface DonutChartProps extends Omit<React.ComponentProps<"figure">, "title"> {
  /** The slices, in the order they go round. */
  readonly data: readonly DonutSlice[];
  readonly title?: React.ReactNode;
  /** The chart's height in CSS pixels. Default 240. */
  readonly height?: number;
  /** How a value reads in the tooltip and the legend. */
  readonly format?: (value: number) => string;
  /** What the middle says, such as the total. */
  readonly center?: React.ReactNode;
}

/**
 * Parts of a whole, each slice named in the legend with its value.
 *
 * ```tsx
 * <DonutChart data={[{ label: "Done", value: 42 }, { label: "Open", value: 13 }]} center="55 tasks" />
 * ```
 */
export function DonutChart({
  data,
  height = 240,
  format,
  center,
  ...props
}: DonutChartProps): React.JSX.Element {
  const slices = data.map((slice, index) => ({
    ...slice,
    key: slice.label,
    color: slice.color ?? `var(--chart-${(index % 6) + 1})`,
  }));
  const formatValue = (value: unknown): string =>
    typeof value === "number" && format ? format(value) : String(value);
  return (
    <Frame height={height} colors={slices} {...props}>
      <RechartsPieChart>
        <Tooltip
          formatter={(value: unknown) => formatValue(value)}
          contentStyle={{
            background: "var(--popover, var(--card))",
            color: "var(--popover-foreground, var(--card-foreground))",
            border: "1px solid var(--border)",
            borderRadius: "var(--popover-radius, var(--radius))",
            fontSize: 12,
          }}
        />
        <Legend
          verticalAlign="bottom"
          iconType="circle"
          iconSize={8}
          wrapperStyle={{ fontSize: 12 }}
          formatter={(label: unknown) => {
            const slice = slices.find((one) => one.label === label);
            return `${String(label)}${slice ? ` ${formatValue(slice.value)}` : ""}`;
          }}
        />
        <Pie
          data={slices as unknown as ChartRow[]}
          dataKey="value"
          nameKey="label"
          innerRadius="58%"
          outerRadius="80%"
          paddingAngle={1}
          stroke="var(--card)"
          strokeWidth={2}
          isAnimationActive={false}
        >
          {slices.map((slice) => (
            <Cell key={slice.key} fill={`var(${variableOf(slice.key)})`} />
          ))}
        </Pie>
        {center !== undefined && (
          <text
            x="50%"
            y="45%"
            textAnchor="middle"
            dominantBaseline="middle"
            className="fill-foreground text-sm font-medium"
          >
            {center}
          </text>
        )}
      </RechartsPieChart>
    </Frame>
  );
}
