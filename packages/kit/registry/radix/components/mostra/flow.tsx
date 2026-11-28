"use client";

/**
 * Node graphs on React Flow 13 (`@xyflow/react`) in the page's theme (D26, D48): an agent gives the
 * nodes and edges, and this draws them on a pannable, zoomable canvas whose nodes are the theme's
 * cards, whose edges and handles its rules, whose dots and controls its muted surfaces, in light
 * and dark (React Flow 13 follows the page's `color-scheme`). It fits the graph in view, and stays
 * read-only unless asked to let people move nodes and draw edges. Custom nodes and everything else
 * are React Flow's own, one import away. Takes `className`; `mostra add mostra-flow` copies it.
 */

import {
  Background,
  BackgroundVariant,
  Controls,
  type Edge,
  MiniMap,
  type Node,
  type NodeTypes,
  ReactFlow,
  useEdgesState,
  useNodesState,
} from "@xyflow/react";
import "@xyflow/react/style.css";
import { cn } from "cn";
import type * as React from "react";

export type { Edge, Node } from "@xyflow/react";

/** {@link Flow}'s props. */
export interface FlowProps extends Omit<React.ComponentProps<"figure">, "title"> {
  /** The nodes: `{ id, position: { x, y }, data: { label } }`, or your own `type`. */
  readonly nodes: readonly Node[];
  /** The edges: `{ id, source, target, label?, animated? }`. */
  readonly edges?: readonly Edge[];
  /** What the graph shows, for screen readers and above it. */
  readonly title?: React.ReactNode;
  /** The canvas's height in CSS pixels. Default 420. */
  readonly height?: number;
  /** Let people drag nodes and draw edges (kept in the page, not saved). Default false. */
  readonly editable?: boolean;
  /** Show the zoom controls. Default true. */
  readonly controls?: boolean;
  /** Show a small map of the whole graph. Default false. */
  readonly minimap?: boolean;
  /** Your own node components, by the `type` your nodes name. */
  readonly nodeTypes?: NodeTypes;
  /** Called when a person clicks a node. */
  readonly onNodeClick?: (node: Node) => void;
}

/** React Flow's variables, set from the page's tokens: its nodes, edges, handles and controls. */
const THEMED = {
  "--xy-background-color": "transparent",
  "--xy-background-pattern-dots-color": "var(--border)",
  "--xy-background-pattern-lines-color": "var(--border)",
  "--xy-background-pattern-cross-color": "var(--border)",
  "--xy-node-background-color": "var(--card)",
  "--xy-node-color": "var(--card-foreground)",
  "--xy-node-border": "1px solid var(--input)",
  "--xy-node-border-radius": "var(--card-radius, var(--radius))",
  "--xy-node-group-background-color": "color-mix(in oklab, var(--muted) 60%, transparent)",
  "--xy-node-boxshadow-selected": "0 0 0 2px var(--ring)",
  "--xy-node-boxshadow-hover": "0 0 0 1px var(--ring)",
  "--xy-edge-stroke": "var(--muted-foreground)",
  "--xy-edge-stroke-selected": "var(--primary)",
  "--xy-edge-label-background-color": "var(--background)",
  "--xy-edge-label-color": "var(--foreground)",
  "--xy-connectionline-stroke": "var(--primary)",
  "--xy-handle-background-color": "var(--muted-foreground)",
  "--xy-handle-border-color": "var(--card)",
  "--xy-selection-background-color": "color-mix(in oklab, var(--primary) 12%, transparent)",
  "--xy-selection-border": "1px dashed var(--primary)",
  "--xy-controls-button-background-color": "var(--card)",
  "--xy-controls-button-background-color-hover": "var(--muted)",
  "--xy-controls-button-color": "var(--foreground)",
  "--xy-controls-button-color-hover": "var(--foreground)",
  "--xy-controls-button-border-color": "var(--border)",
  "--xy-controls-box-shadow": "var(--card-shadow)",
  "--xy-minimap-background-color": "var(--card)",
  "--xy-minimap-node-background-color": "var(--muted)",
  "--xy-minimap-node-stroke-color": "var(--input)",
  "--xy-minimap-mask-background-color": "color-mix(in oklab, var(--muted) 70%, transparent)",
} as const;

/**
 * A graph of nodes and edges on a canvas people pan and zoom.
 *
 * ```tsx
 * <Flow title="Pipeline" nodes={[{ id: "a", position: { x: 0, y: 0 }, data: { label: "Fetch" } }, { id: "b", position: { x: 200, y: 0 }, data: { label: "Build" } }]} edges={[{ id: "a-b", source: "a", target: "b" }]} />
 * ```
 */
export function Flow({
  nodes: nodesProp,
  edges: edgesProp = [],
  title,
  height = 420,
  editable = false,
  controls = true,
  minimap = false,
  nodeTypes,
  onNodeClick,
  className,
  style,
  ...props
}: FlowProps): React.JSX.Element {
  const [nodes, , onNodesChange] = useNodesState([...nodesProp]);
  const [edges, , onEdgesChange] = useEdgesState([...edgesProp]);
  const shown = editable ? { nodes, edges } : { nodes: [...nodesProp], edges: [...edgesProp] };
  return (
    <figure
      data-slot="flow"
      className={cn("flex min-w-0 flex-col gap-2 text-card-foreground", className)}
      style={{ ...THEMED, ...style } as React.CSSProperties}
      {...props}
    >
      {title !== undefined && <figcaption className="text-sm font-medium">{title}</figcaption>}
      <div
        style={{ height }}
        className="w-full min-w-0 overflow-hidden rounded-card shadow-card bg-card"
      >
        <ReactFlow
          nodes={shown.nodes}
          edges={shown.edges}
          {...(editable ? { onNodesChange, onEdgesChange } : {})}
          {...(nodeTypes ? { nodeTypes } : {})}
          {...(onNodeClick ? { onNodeClick: (_event, node) => onNodeClick(node) } : {})}
          nodesDraggable={editable}
          nodesConnectable={editable}
          elementsSelectable
          fitView
          {...(typeof title === "string" ? { "aria-label": title } : {})}
        >
          <Background variant={BackgroundVariant.Dots} gap={18} size={1} />
          {controls && <Controls showInteractive={editable} />}
          {minimap && <MiniMap pannable zoomable />}
        </ReactFlow>
      </div>
    </figure>
  );
}
