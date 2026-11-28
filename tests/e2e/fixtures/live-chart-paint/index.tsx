// AC-08 (WP-19): the paint control for the live chart's frame rate. The same picture the live chart
// draws, a line of two points a pixel across a plot of its size, redrawn by hand on every animation
// frame, with no live data, React render or chart library: what this browser on this machine can
// draw a frame, so a frame the live page drops beyond this one's is the chart's and its data's cost.
import { defineArtifact } from "@mostra/react";
import { useEffect, useRef } from "react";

export const artifact = defineArtifact({ title: "Painted trace", verify: { smoke: false } });

export default function Painted() {
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const element = canvas.current;
    const mark = host.current;
    const context = element?.getContext("2d");
    if (!element || !mark || !context) return;
    let frame = 0;
    let handle = 0;
    const draw = (): void => {
      const width = element.clientWidth;
      const height = 240;
      if (element.width !== width) element.width = width;
      if (element.height !== height) element.height = height;
      context.clearRect(0, 0, width, height);
      context.strokeStyle = "#888";
      context.lineWidth = 1;
      for (let y = 40; y < height; y += 40) {
        context.beginPath();
        context.moveTo(0, y);
        context.lineTo(width, y);
        context.stroke();
      }
      context.strokeStyle = "#2563eb";
      context.lineWidth = 1.5;
      context.beginPath();
      const points = width * 2;
      for (let n = 0; n < points; n++) {
        const t = n + frame;
        const y = height / 2 + Math.sin(t / 40) * 60 + (t % 7) * 3;
        if (n === 0) context.moveTo(n / 2, y);
        else context.lineTo(n / 2, y);
      }
      context.stroke();
      frame += 1;
      mark.setAttribute("data-drawn", `${frame} ${frame}`);
      handle = requestAnimationFrame(draw);
    };
    handle = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(handle);
  }, []);
  return (
    <main style={{ padding: 24 }}>
      <figure data-slot="live-chart">
        <figcaption>Trace</figcaption>
        <div ref={host} data-drawn="0 0">
          <canvas ref={canvas} style={{ width: "100%", height: 240, display: "block" }} />
        </div>
        <p data-slot="live-chart-summary">10000 points, drawn by hand.</p>
      </figure>
    </main>
  );
}
