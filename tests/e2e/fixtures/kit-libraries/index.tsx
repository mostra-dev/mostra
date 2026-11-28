import { AreaChart, BarChart, DonutChart, LineChart } from "@mostra/kit/charts";
import { Code, CodeEditor } from "@mostra/kit/code";
import { DataTable } from "@mostra/kit/data-table";
import { EChart } from "@mostra/kit/echarts";
import { Flow } from "@mostra/kit/flow";
import { Page, Section } from "@mostra/kit/layout";
import { LiveChart } from "@mostra/kit/live-chart";
import { Formula } from "@mostra/kit/math";
import { Mermaid } from "@mostra/kit/mermaid";
import { defineArtifact } from "@mostra/react";

export const artifact = defineArtifact({
  title: "The kit's libraries",
  kit: { theme: "studio" },
});

const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun"].map((month, index) => ({
  month,
  won: 12 + index * 3,
  lost: 9 - index,
}));
const trace = Array.from({ length: 400 }, (_, t) => ({ t, v: 20 + Math.sin(t / 18) * 8 }));
const deals = [
  { customer: "Acme", stage: "Won", amount: 42000 },
  { customer: "Globex", stage: "Open", amount: 18000 },
  { customer: "Initech", stage: "Lost", amount: 7000 },
  { customer: "Umbrella", stage: "Won", amount: 31000 },
];
const cells = Array.from({ length: 7 * 12 }, (_, index) => [
  index % 12,
  Math.floor(index / 12),
  (index * 7) % 10,
]);

export default function Libraries() {
  return (
    <Page title="The kit's libraries" width="wide">
      <Section title="Charts">
        <BarChart
          title="Deals by month"
          data={months}
          x="month"
          series={[
            { key: "won", label: "Won" },
            { key: "lost", label: "Lost" },
          ]}
        />
        <LineChart title="Trend" data={months} x="month" series={["won", "lost"]} />
        <AreaChart title="Together" data={months} x="month" series={["won", "lost"]} stacked />
        <DonutChart
          title="Pipeline"
          data={[
            { label: "Won", value: 42 },
            { label: "Open", value: 13 },
          ]}
          center="55"
        />
        <LiveChart title="Signal" values={trace} x="t" series={[{ key: "v", label: "Signal" }]} />
        <EChart
          title="Activity"
          option={{
            xAxis: { type: "category", data: [...Array(12).keys()].map(String) },
            yAxis: { type: "category", data: ["M", "T", "W", "T", "F", "S", "S"] },
            visualMap: { min: 0, max: 10, show: false },
            series: [{ type: "heatmap", data: cells }],
          }}
        />
      </Section>
      <Section title="Tables and diagrams">
        <DataTable caption="Deals" data={deals} search />
        <Mermaid
          title="Release"
          chart={"flowchart LR\n  A[Draft] --> B{Review}\n  B -->|approved| C[Publish]"}
        />
        <Flow
          title="Pipeline"
          height={260}
          nodes={[
            { id: "fetch", position: { x: 0, y: 0 }, data: { label: "Fetch" } },
            { id: "build", position: { x: 220, y: 80 }, data: { label: "Build" } },
          ]}
          edges={[{ id: "fetch-build", source: "fetch", target: "build" }]}
        />
      </Section>
      <Section title="Code and math">
        <Code
          lang="ts"
          title="retry.ts"
          code={'export const retries = 3; // tries\nconst name = "mostra";'}
        />
        <CodeEditor id="snippet" label="Your snippet" lang="python" initial="print('hi')" />
        <p>
          The rate is <Formula tex="r = \frac{\Delta y}{\Delta x}" />.
        </p>
        <Formula display tex="\int_0^1 x^2 \, dx = \frac{1}{3}" />
      </Section>
    </Page>
  );
}
