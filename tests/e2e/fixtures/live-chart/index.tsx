// AC-08 (WP-19): the kit's live chart over a source that keeps 10,000 points and adds 60 a second.
import { LiveChart } from "@mostra/kit/live-chart";
import { defineArtifact } from "@mostra/react";

export const artifact = defineArtifact({ title: "Live trace", verify: { smoke: false } });

export default function Trace() {
  return (
    <main style={{ padding: 24 }}>
      <LiveChart
        source="trace"
        window={10000}
        x="t"
        series={[{ key: "v", label: "Signal" }]}
        title="Trace"
        data-testid="trace"
      />
    </main>
  );
}
