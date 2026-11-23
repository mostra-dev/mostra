import { defineArtifact, useField } from "@mostra/react";
import { useEffect, useRef } from "react";
import { Bar, BarChart, CartesianGrid, XAxis } from "recharts";
import { ChartContainer } from "@/components/ui/chart";

export const artifact = defineArtifact({ title: "Review everything" });

const data = [
  { month: "January", desktop: 186 },
  { month: "February", desktop: 305 },
  { month: "March", desktop: 237 },
];

function Canvas() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const context = ref.current?.getContext("2d");
    if (!context) return;
    context.fillStyle = "#2340c8";
    context.fillRect(20, 20, 120, 60);
    context.fillStyle = "#e63312";
    context.beginPath();
    context.arc(220, 50, 30, 0, Math.PI * 2);
    context.fill();
  }, []);
  return <canvas ref={ref} width={300} height={100} data-testid="canvas" />;
}

export default function Page() {
  const [note, setNote] = useField("note", "");
  return (
    <main style={{ padding: 24, display: "grid", gap: 24 }}>
      <h1 data-review-id="header.title">Sidebar redesign</h1>
      <p data-testid="paragraph">Larger hit targets and quieter section labels.</p>
      <input aria-label="Note" value={note} onChange={(event) => setNote(event.target.value)} />
      <Canvas />
      <ChartContainer data-testid="chart" config={{ desktop: { label: "Desktop", color: "#2340c8" } }} className="h-48 w-96">
        <BarChart data={data}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="month" />
          <Bar dataKey="desktop" fill="var(--color-desktop)" />
        </BarChart>
      </ChartContainer>
      <iframe data-testid="served" title="Served" src="/embed.html" width={320} height={120} />
      {/* A page of the version the artifact can't read itself (its own origin, sandboxed): only the
          review agent the version's pages carry answers for it. */}
      <iframe
        data-testid="served-sandboxed"
        title="Served, sandboxed"
        sandbox="allow-scripts"
        src="/embed.html"
        width={320}
        height={120}
      />
      <iframe
        data-testid="opaque"
        title="Opaque"
        sandbox="allow-scripts"
        srcDoc="<body style='margin:0;background:#f5b700'><p style='font:16px sans-serif'>Opaque page</p></body>"
        width={320}
        height={120}
      />
    </main>
  );
}
