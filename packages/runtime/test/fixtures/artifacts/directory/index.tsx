// AU-02: a directory artifact. The entry holds the manifest; with pages/, its default export is the
// layout around every page.
import type { ReactNode } from "react";
import { defineArtifact } from "@mostra/react";
import "./styles.css";

export const artifact = defineArtifact({
  title: "Team dashboard",
  description: "Open work and weekly reports.",
  family: "dashboard",
  links: [{ rel: "follows", artifact: "art_01JB8Z3QF6S7W3N8D5K2C4V9XG" }],
  submission: { policy: "none" },
});

export default function Layout({ children }: { children?: ReactNode }) {
  return (
    <div className="dashboard">
      <header data-testid="layout">{artifact.title}</header>
      {children}
    </div>
  );
}
