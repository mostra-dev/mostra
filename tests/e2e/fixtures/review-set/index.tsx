import { Candidate, ReviewSet } from "@mostra/kit/review";
import { defineArtifact } from "@mostra/react";

export const artifact = defineArtifact({ title: "Three sidebars" });

/** A sidebar candidate: the same frame, a different accent and spacing. */
function Sidebar(props: { readonly accent: string; readonly gap: number; readonly name: string }) {
  return (
    <div style={{ background: "#ffffff", padding: 16, height: 600 }}>
      <h3 data-review-id={`sidebar.${props.name}.title`} style={{ margin: 0, font: "600 18px sans-serif" }}>
        Workspace
      </h3>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: props.gap }}>
        <li>Inbox</li>
        <li>Recents</li>
        <li>Pins</li>
      </ul>
      <div
        data-testid={`accent-${props.name}`}
        style={{ background: props.accent, width: 120, height: 40, marginTop: 16 }}
      />
      <p style={{ marginTop: 400 }}>Bottom of {props.name}</p>
    </div>
  );
}

export default function Page() {
  return (
    <main style={{ padding: 24, display: "grid", gap: 32 }}>
      <ReviewSet id="sidebar" layout="compare" choose>
        <Candidate id="dense" label="Dense" style={{ height: 320 }}>
          <Sidebar name="dense" accent="#2340c8" gap={2} />
        </Candidate>
        <Candidate id="airy" label="Airy" style={{ height: 320 }}>
          <Sidebar name="airy" accent="#e63312" gap={2} />
        </Candidate>
        <Candidate id="roomy" label="Roomy" style={{ height: 320 }}>
          <Sidebar name="roomy" accent="#0b7a52" gap={16} />
        </Candidate>
      </ReviewSet>
      <ReviewSet id="tone" layout="focus">
        <Candidate id="warm" label="Warm">
          <p>Warm tone</p>
        </Candidate>
        <Candidate id="cool" label="Cool">
          <p>Cool tone</p>
        </Candidate>
      </ReviewSet>
      <ReviewSet id="icons" layout="gallery">
        <Candidate id="outline" label="Outline">
          <p>Outline icons</p>
        </Candidate>
        <Candidate id="filled" label="Filled">
          <p>Filled icons</p>
        </Candidate>
        <Candidate id="duo" label="Duotone">
          <p>Duotone icons</p>
        </Candidate>
      </ReviewSet>
    </main>
  );
}
