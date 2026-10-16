/**
 * A `pages/` artifact for the routing suites (D57, AU-09): a layout with links, and a field on
 * one page, so navigation, the history each delivery target uses and the page reported to the
 * shell can all be observed.
 */
import { defineArtifact, useArtifact } from "@mostra/react";
import type { ReactNode } from "react";
import { Link, useLocation } from "react-router";

export const artifact = defineArtifact({ title: "Pages fixture" });

export default function Layout({ children }: { children?: ReactNode }) {
  const location = useLocation();
  const shown = useArtifact();
  return (
    <div style={{ padding: 16 }}>
      <nav style={{ display: "flex", gap: 12 }}>
        <Link to="/" data-testid="to-home">
          Home
        </Link>
        <Link to="/settings" data-testid="to-settings">
          Settings
        </Link>
        <Link to="/reports/42" data-testid="to-report">
          Report 42
        </Link>
      </nav>
      <p>
        <span data-testid="path">{location.pathname}</span> ·{" "}
        <span data-testid="mode">{shown.mode}</span>
      </p>
      {children}
    </div>
  );
}
