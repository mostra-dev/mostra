// AC-08 (WP-19): the control for the live chart's frame rate, the same chart over the same 10,000
// points, none arriving, so a frame the live page drops beyond this one's is the live data's cost.
import { LiveChart } from "@mostra/kit/live-chart";
import { defineArtifact } from "@mostra/react";

export const artifact = defineArtifact({ title: "Still trace", verify: { smoke: false } });

const points = Array.from({ length: 10000 }, (_, n) => ({ t: n, v: Math.sin(n / 40) * 40 + 50 + (n % 7) }));

export default function Trace() {
  return (
    <main style={{ padding: 24 }}>
      <LiveChart values={points} window={10000} x="t" series={[{ key: "v", label: "Signal" }]} title="Trace" />
    </main>
  );
}
