# Libraries: what's preinstalled, and what changed in them

Every artifact can import these without any install; they share one React. Anything else on npm installs on demand ([page.md](page.md#packages)). The kit wraps the charts, tables, diagrams, code, math, maps, 3D and whiteboards in the page's theme: start from [its parts](#the-kits-library-parts), and import a library itself for what a part doesn't cover.

## Contents

- The preinstalled set
- The kit's library parts
- Write this, not that
- UI primitives: Base UI
- Tables: TanStack Table 9
- Charts
- Motion

## The preinstalled set

| Need | Package (version line) | Import |
|---|---|---|
| React | `react`, `react-dom` 19 | `import { useState } from "react"` |
| Routing for `pages/` | `react-router` 8 | `import { Link, useParams } from "react-router"` |
| Styling | `tailwindcss` 4, `cn` | utility classes; `import { cn } from "cn"` to merge class names |
| The kit's parts | shadcn's components on the base, in the page's theme ([design.md](design.md#the-kits-parts)) | `import { Button } from "@/components/ui/button"` |
| UI primitives | `@base-ui/react` 1 (default), `radix-ui` 1 | `import { Dialog } from "@base-ui/react/dialog"` |
| Forms and validation | `react-hook-form` 7, `@hookform/resolvers` 5, `zod` 4 | through `@mostra/react/form` ([answers.md](answers.md#forms-with-react-hook-form)) |
| Icons | `lucide-react` 1 | `import { Check } from "lucide-react"` |
| Charts | `recharts` 3, `echarts` 6, `uplot` 1 | see [Charts](#charts) |
| Tables | `@tanstack/react-table` 9 | see [Tables](#tables-tanstack-table-9) |
| Motion | `motion` 14 | `import { motion, AnimatePresence } from "motion/react"` |
| Diagrams | `mermaid` 12, `@xyflow/react` 13 | |
| Code | `shiki` 4 (display), `codemirror` 6 and `@codemirror/*` (editing) | |
| Math | `katex` | |
| Terminal output | `@xterm/xterm` and its addons | |
| Smaller pieces | `sonner` (toasts), `vaul` (drawers), `cmdk` (command menu), `embla-carousel-react`, `react-day-picker`, `input-otp`, `react-resizable-panels` | |

Maps, 3D and whiteboards (MapLibre with deck.gl, three.js with react-three-fiber and drei, Excalidraw) install on demand when imported, the kit's own parts bringing them at the versions it was built with.

## The kit's library parts

Each part draws one library in the page's theme (its series colours, faces, radius and light or dark), so the theme you name restyles it with the rest of the page. Each takes `className`, and `mostra add mostra-<module>` copies it into `components/mostra/` for editing.

| Import | Parts | Library | Saved as a field |
|---|---|---|---|
| `@mostra/kit/charts` | `BarChart`, `LineChart`, `AreaChart`, `DonutChart` | Recharts | |
| `@mostra/kit/live-chart` | `LiveChart`: thousands of points, many a second, from `source` (a live source, in append mode) or `values` | uPlot | |
| `@mostra/kit/echarts` | `EChart`: any ECharts `option` (heat maps, Sankey, treemaps, candlesticks, graphs) | ECharts | |
| `@mostra/kit/data-table` | `DataTable`: rows sortable by every column, `search`, `pageSize` | TanStack Table | |
| `@mostra/kit/mermaid` | `Mermaid`: a diagram written as text | Mermaid | |
| `@mostra/kit/flow` | `Flow`: nodes and edges on a canvas to pan, `editable` to move them | React Flow | |
| `@mostra/kit/code` | `Code` (highlighted), `CodeEditor` | Shiki, CodeMirror | `CodeEditor`, by `id` |
| `@mostra/kit/math` | `Formula`: TeX, inline or `display` | KaTeX | |
| `@mostra/kit/map` | `MapView`: markers and deck.gl layers on a world outline in the theme, or any `basemap` style URL | MapLibre, deck.gl | |
| `@mostra/kit/scene` | `Scene`: three.js children with light, orbit controls and a floor grid | react-three-fiber, drei | |
| `@mostra/kit/whiteboard` | `Whiteboard` | Excalidraw | `Whiteboard`, by `id` |
| `@mostra/kit/team` | `PresenceAvatars`, `LiveCursors`, `RespondentTracker`, `Attribution` ([teams.md](teams.md#show-the-team-on-the-page)) | the team hooks | |

```tsx
import { BarChart, LineChart } from "@mostra/kit/charts";
import { DataTable } from "@mostra/kit/data-table";
import { LiveChart } from "@mostra/kit/live-chart";

const weeks = [
  { week: "W1", won: 12, lost: 4 },
  { week: "W2", won: 15, lost: 6 },
  { week: "W3", won: 11, lost: 3 },
];
const deals = [
  { customer: "Acme", stage: "Won", amount: 42000 },
  { customer: "Globex", stage: "Open", amount: 18000 },
];
const euros = new Intl.NumberFormat("en", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const trace = Array.from({ length: 600 }, (_, i) => ({ t: i, ms: 40 + Math.sin(i / 20) * 8 }));

function Pipeline() {
  return (
    <div className="grid gap-6">
      <BarChart title="Deals by week" data={weeks} x="week" series={[{ key: "won", label: "Won" }, { key: "lost", label: "Lost" }]} />
      <LineChart title="Won" data={weeks} x="week" series={["won"]} />
      <DataTable
        caption="Open deals"
        data={deals}
        columns={[
          { key: "customer", header: "Customer" },
          { key: "stage", header: "Stage" },
          { key: "amount", header: "Amount", align: "right", cell: (value) => euros.format(Number(value)) },
        ]}
        search
      />
      <LiveChart title="Latency (ms)" values={trace} x="t" series={[{ key: "ms", label: "p50" }]} window={600} />
    </div>
  );
}
```

- A chart names every series in its legend and colours them `var(--chart-1)` onward, in order; a series' `color` overrides that. Give it a `title`, and put the numbers that matter in text beside it too.
- `LiveChart source="latency" window={10000}` reads `useLive("latency", { mode: "append", window })` itself and draws each new point as it arrives, many a second ([long-lived.md](long-lived.md)). Points are objects (`{ t, ms }`, `x="t"`) or arrays (`[t, ms]`, series by index); an `x` in milliseconds since 1970 shows as time.
- `DataTable`'s columns default to every key of the first row; a number column sorts largest first.

```tsx
import { Code, CodeEditor } from "@mostra/kit/code";
import { Flow } from "@mostra/kit/flow";
import { Formula } from "@mostra/kit/math";
import { Mermaid } from "@mostra/kit/mermaid";

function HowItWorks() {
  return (
    <div className="grid gap-6">
      <Mermaid title="Release" chart={"flowchart LR\n  Draft --> Review --> Ship"} />
      <Flow
        title="Services"
        height={240}
        nodes={[
          { id: "web", position: { x: 0, y: 0 }, data: { label: "Web" } },
          { id: "api", position: { x: 200, y: 80 }, data: { label: "API" } },
        ]}
        edges={[{ id: "web-api", source: "web", target: "api" }]}
      />
      <Code lang="ts" code={"const retries = 3;\nexport default retries;"} />
      <CodeEditor id="query" label="Your query" lang="python" initial={"print('hi')"} />
      <p>
        Each step costs <Formula tex="O(n \log n)" />, so the total is
      </p>
      <Formula display tex="\sum_{i=1}^{k} n_i \log n_i" />
    </div>
  );
}
```

- `CodeEditor` saves its text as the field `id`, under its `label`, like any answer; `Code` only shows code.
- `Flow` is read-only unless `editable`; a node's `type` names a component in `nodeTypes`.
- `EChart` takes ECharts' own `option` and wears the theme: `<EChart option={{ xAxis: { type: "category", data: days }, yAxis: {}, series: [{ type: "line", data: values }] }} />`.

```tsx
import { MapView } from "@mostra/kit/map";
import { Scene, useTokens } from "@mostra/kit/scene";
import { Whiteboard } from "@mostra/kit/whiteboard";

function Places() {
  const { chart } = useTokens();
  return (
    <div className="grid gap-6">
      <MapView
        title="Offices"
        center={[8, 50]}
        zoom={3}
        markers={[
          { position: [13.4, 52.52], label: "Berlin" },
          { position: [2.35, 48.86], label: "Paris" },
        ]}
      />
      <Scene title="Part" height={280}>
        <mesh>
          <torusKnotGeometry args={[1, 0.3, 128, 16]} />
          <meshStandardMaterial color={chart[0]} />
        </mesh>
      </Scene>
      <Whiteboard id="layout-sketch" label="Sketch the layout" height={320} />
    </div>
  );
}
```

- `useTokens()` gives the theme's values a canvas or WebGL library takes (each colour resolved, `chart` in series order, the faces), current as the theme or its light or dark changes.
- These three install their libraries the first time a page imports them, which takes a minute; later builds reuse them.
- The map draws on a world outline in the theme, which needs no tile server and works offline and inline in chat hosts; `basemap` takes any MapLibre style URL (one with streets comes with its provider's terms, often a key), and `layers` takes deck.gl layers.
- `Whiteboard` saves the drawing as the field `id`. Without WebGL, the map and the scene say so in words.

## Write this, not that

Several of these had a major release recently, so older habits break the build or silently do nothing:

| Write this | Not that | Why |
|---|---|---|
| `@import "tailwindcss";` at the top of a stylesheet, theme in `@theme` | `tailwind.config.js`, `@tailwind base;` | Tailwind 4 is configured in CSS |
| `shadow-xs`, `rounded-xs`, `blur-xs` | `shadow-sm`, `rounded-sm`, `blur-sm` for the smallest size | Tailwind 4 renamed the scale: `-sm` is now one step larger |
| `outline-hidden` | `outline-none` to hide a focus outline | Tailwind 4 renamed it; `outline-none` now really removes it |
| `ring-3` | `ring` for a 3 px ring | `ring` is 1 px in Tailwind 4 |
| `bg-black/50`, `shrink-0`, `grow`, `text-ellipsis` | `bg-opacity-50`, `flex-shrink-0`, `flex-grow`, `overflow-ellipsis` | Removed in Tailwind 4 |
| `bg-linear-to-r` | `bg-gradient-to-r` | Renamed in Tailwind 4 |
| `bg-(--brand)` | `bg-[--brand]` | CSS variables in arbitrary values use parentheses |
| `border border-border` (or the baseline stylesheet) | a bare `border` expecting light gray | Tailwind 4 borders default to the text color |
| `flex! hover:bg-muted!` | `!flex` | The important mark goes at the end |
| `import { motion } from "motion/react"` | `import { motion } from "framer-motion"` | Framer Motion is now Motion |
| `import { Link } from "react-router"` | `"react-router-dom"` | One package since React Router 7 |
| `z.email()`, `z.url()`, `z.uuid()` | `z.string().email()` | Zod 4 top-level formats |
| `z.string().min(1, { error: "Required" })` or `.min(1, "Required")` | `{ message: "Required" }` | Zod 4 calls it `error`; `message` still works but is deprecated |
| `import * as z from "zod"` | `import { z } from "zod/v3"` | Zod 4 is the default |
| `<Dialog.Trigger render={<Button />}>` | `<Dialog.Trigger asChild>` | Base UI composes with `render`; `asChild` is Radix's |
| `function Input({ ref, ...props })` | `forwardRef(...)` | React 19 passes `ref` as a prop |
| `useTable({ features, columns, data })` | `useReactTable({ getCoreRowModel: getCoreRowModel(), … })` | TanStack Table 9 |
| `import { ReactFlow } from "@xyflow/react"` | `import ReactFlow from "reactflow"` | React Flow is `@xyflow/react` since version 12 |
| `onNodesChange={(changes) => setNodes((nodes) => changes.applyTo(nodes))}` | `applyNodeChanges(changes, nodes)` | React Flow 13 hands the handler a changeset |
| nothing, or `forceColorMode="dark"` | `colorMode="dark"` | React Flow 13 follows the page's light or dark |
| `import "@xyflow/react/style.css"` | `"reactflow/dist/style.css"` | React Flow 13's stylesheet |
| `createHighlighter({ themes, langs })` | `getHighlighter(…)` | Shiki 3 renamed it |
| an `EditorView` from `codemirror` (or the kit's `CodeEditor`) | `import "codemirror/lib/codemirror.css"` | CodeMirror 6 styles itself |
| `import maplibregl from "maplibre-gl"` | `mapbox-gl` | The kit's maps are MapLibre, which needs no access token |
| `import { Canvas } from "@react-three/fiber"` | `"react-three-fiber"`, `"drei"` | The packages are `@react-three/fiber` and `@react-three/drei` |
| `mermaid.run()`, `await mermaid.render(id, text)` | `mermaid.init()`, `mermaid.mermaidAPI.render(…)` | Mermaid 12 deprecates them |
| `import { cn } from "cn"` | `lib/utils.ts` with `clsx` and `tailwind-merge` | shadcn's components import the `cn` package |

Verify flags each of these with its fix (`MOSTRA_LINT_API_CHANGED`), and the other base's idiom too (`MOSTRA_KIT_WRONG_BASE`). `mostra verify <dir> --fix` writes every fix verify offers into your files, lists the files it changed, and verifies again.

## UI primitives: Base UI

Base UI is unstyled and accessible; style it with utilities. Each component is a namespace of parts, imported from its own path:

```tsx
import { Dialog } from "@base-ui/react/dialog";

function PlanDialog() {
  return (
    <Dialog.Root>
      <Dialog.Trigger render={<button type="button" className="rounded-full bg-primary px-4 py-2 text-sm text-primary-foreground" />}>
        Review the plan
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 bg-black/40" />
        <Dialog.Popup className="fixed top-1/2 left-1/2 w-96 -translate-1/2 rounded-lg bg-card p-6">
          <Dialog.Title className="font-medium">The plan</Dialog.Title>
          <Dialog.Description className="mt-2 text-sm text-muted-foreground">Three hires in Q4, two in engineering.</Dialog.Description>
          <Dialog.Close className="mt-4 rounded-md border px-3 py-1.5 text-sm">Close</Dialog.Close>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
```

Others: `accordion`, `alert-dialog`, `checkbox`, `collapsible`, `combobox`, `menu`, `popover`, `radio-group`, `select`, `slider`, `switch`, `tabs`, `toggle`, `tooltip` and more, each at `@base-ui/react/<name>`. The kit's parts are built on these, so most pages import the parts instead. Radix works too (`import { Dialog } from "radix-ui"`, `kit: { base: "radix" }` for the kit's Radix parts); keep one of them per artifact.

## Tables: TanStack Table 9

Version 9 declares the features a table uses, then `useTable`:

```tsx
import { createColumnHelper, createSortedRowModel, FlexRender, rowSortingFeature, sortFns, tableFeatures, useTable } from "@tanstack/react-table";

interface Invoice { id: string; customer: string; amount: number }

const euros = new Intl.NumberFormat("en", { style: "currency", currency: "EUR" });

const features = tableFeatures({ rowSortingFeature, sortedRowModel: createSortedRowModel(), sortFns });
const column = createColumnHelper<typeof features, Invoice>();
const columns = column.columns([
  column.accessor("id", { header: "Invoice" }),
  column.accessor("customer", { header: "Customer" }),
  column.accessor("amount", { header: "Amount", cell: (info) => euros.format(info.getValue()) }),
]);

function Invoices({ data }: { data: Invoice[] }) {
  const table = useTable({ features, columns, data });
  return (
    <table className="w-full text-sm">
      <thead>
        {table.getHeaderGroups().map((group) => (
          <tr key={group.id}>
            {group.headers.map((header) => (
              <th key={header.id} className="text-left font-normal text-muted-foreground">
                <button type="button" onClick={header.column.getToggleSortingHandler()}><FlexRender header={header} /></button>
              </th>
            ))}
          </tr>
        ))}
      </thead>
      <tbody>
        {table.getRowModel().rows.map((row) => (
          <tr key={row.id} className="border-t">
            {row.getAllCells().map((cell) => <td key={cell.id} className="py-2"><FlexRender cell={cell} /></td>)}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

Filtering, pagination and selection are features too (`columnFilteringFeature` with `createFilteredRowModel()`, and so on). Code written for version 8 runs through `useLegacyTable`, but new code uses `useTable`. A plain `<table>` over an array is often enough.

## Charts

The kit's parts above cover most charts. For one they don't:

- **Recharts** for most charts. Wrap in `<ResponsiveContainer width="100%" height="100%">` inside a parent with a fixed height (`h-56`), and color series with the theme's chart colors: `fill="var(--chart-1)"`, `stroke="var(--border)"` for gridlines.
- **uPlot** for thousands of points updating several times a second (a live latency trace from `useLive(key, { mode: "append" })`).
- **ECharts** for chart types Recharts lacks (heat maps, Sankey, treemaps, geographic maps).

A chart reaches the ARIA snapshot (and screen readers) as little more than its axis labels, so give it a heading and, where the numbers matter, the key values in text beside it.

## Motion

```tsx
import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

function Details() {
  const [open, setOpen] = useState(false);
  const reduce = useReducedMotion();
  return (
    <div>
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}>Details</button>
      <AnimatePresence>
        {open && (
          <motion.p initial={{ opacity: 0, y: reduce ? 0 : 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.18, ease: "easeOut" }}>
            Built from Friday's numbers.
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}
```

Motion animates CSS variables too (`animate={{ backgroundColor: "var(--muted)" }}`). Keep durations and easing to [design.md](design.md#motion).
