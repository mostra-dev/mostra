"use client";

/**
 * Mermaid 12 diagrams in the page's theme (D26, D48): an agent writes the diagram as text
 * (flowcharts, sequences, states, entity relations, Gantt charts, mind maps, timelines) and this
 * draws it with Mermaid's `base` theme set from the page's tokens, so its boxes, lines and text are
 * the theme's, and draws it again when the theme or its light or dark changes. A diagram Mermaid
 * can't read shows its error in place and on the console, so `verify` reports it. Takes
 * `className`; `mostra add mostra-mermaid` copies it (D68).
 */

import { type Tokens, useTokens } from "@mostra/kit/tokens";
import { cn } from "cn";
import mermaid from "mermaid";
import * as React from "react";

/** {@link Mermaid}'s props. */
export interface MermaidProps extends Omit<React.ComponentProps<"figure">, "children" | "title"> {
  /** The diagram, in Mermaid's own text (`flowchart LR\n  A --> B`). */
  readonly chart: string;
  /** What the diagram shows, for screen readers and above it. */
  readonly title?: React.ReactNode;
}

/** Mermaid's theme variables from the page's tokens (its `base` theme reads them). */
export function mermaidThemeVariables(tokens: Tokens): Record<string, string | boolean> {
  return {
    darkMode: tokens.appearance === "dark",
    background: tokens.background,
    fontFamily: tokens.fontSans,
    fontSize: "14px",
    primaryColor: tokens.card,
    primaryTextColor: tokens.cardForeground,
    primaryBorderColor: tokens.input,
    secondaryColor: tokens.muted,
    secondaryTextColor: tokens.foreground,
    secondaryBorderColor: tokens.border,
    tertiaryColor: tokens.accent,
    tertiaryTextColor: tokens.accentForeground,
    tertiaryBorderColor: tokens.border,
    lineColor: tokens.mutedForeground,
    textColor: tokens.foreground,
    mainBkg: tokens.card,
    nodeBorder: tokens.input,
    clusterBkg: tokens.muted,
    clusterBorder: tokens.border,
    edgeLabelBackground: tokens.background,
    noteBkgColor: tokens.muted,
    noteTextColor: tokens.foreground,
    noteBorderColor: tokens.border,
    actorBkg: tokens.card,
    actorBorder: tokens.input,
    actorTextColor: tokens.cardForeground,
    signalColor: tokens.mutedForeground,
    signalTextColor: tokens.foreground,
    labelBoxBkgColor: tokens.muted,
    labelBoxBorderColor: tokens.border,
    labelTextColor: tokens.foreground,
    errorBkgColor: tokens.destructive,
    errorTextColor: tokens.primaryForeground,
    // Pie slices, Gantt sections, journeys and mind map branches take the series colours in order.
    ...Object.fromEntries(tokens.chart.map((color, index) => [`pie${index + 1}`, color])),
    ...Object.fromEntries(tokens.chart.map((color, index) => [`cScale${index}`, color])),
    git0: tokens.chart[0],
    git1: tokens.chart[1],
    git2: tokens.chart[2],
    git3: tokens.chart[3],
  };
}

let sequence = 0;

/**
 * A diagram written as Mermaid text, drawn in the page's theme.
 *
 * ```tsx
 * <Mermaid title="How a submission travels" chart={`sequenceDiagram\n  Viewer->>Shell: Submit\n  Shell->>Host: deliver`} />
 * ```
 */
export function Mermaid({ chart, title, className, ...props }: MermaidProps): React.JSX.Element {
  const tokens = useTokens();
  const host = React.useRef<HTMLDivElement>(null);
  const [error, setError] = React.useState<string | undefined>(undefined);
  const titleId = React.useId();

  React.useEffect(() => {
    const element = host.current;
    if (!element) return;
    let current = true;
    sequence += 1;
    const id = `mostra-mermaid-${sequence}`;
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: "base",
      themeVariables: mermaidThemeVariables(tokens),
      fontFamily: tokens.fontSans,
    });
    mermaid.render(id, chart).then(
      ({ svg, bindFunctions }) => {
        if (!current) return;
        element.innerHTML = svg;
        bindFunctions?.(element);
        setError(undefined);
      },
      (failure: unknown) => {
        if (!current) return;
        const message = failure instanceof Error ? failure.message : String(failure);
        element.innerHTML = "";
        setError(message);
        console.error(`Mermaid couldn't draw the diagram: ${message}`);
        // Mermaid leaves its error drawing in the document: it isn't part of the page.
        document.getElementById(`d${id}`)?.remove();
      },
    );
    return () => {
      current = false;
    };
  }, [chart, tokens]);

  return (
    <figure
      data-slot="mermaid"
      aria-labelledby={title !== undefined ? titleId : undefined}
      className={cn("flex min-w-0 flex-col gap-2 text-card-foreground", className)}
      {...props}
    >
      {title !== undefined && (
        <figcaption id={titleId} className="text-sm font-medium">
          {title}
        </figcaption>
      )}
      <div
        ref={host}
        className="min-w-0 overflow-x-auto [&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full"
      />
      {error !== undefined && (
        <p role="alert" className="text-sm text-destructive">
          The diagram couldn't be drawn: {error}
        </p>
      )}
    </figure>
  );
}
