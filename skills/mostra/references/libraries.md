# Libraries: what's preinstalled, and what changed in them

Every artifact can import these without any install; they share one React. Anything else on npm installs on demand ([page.md](page.md#packages)).

## Contents

- The preinstalled set
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
| UI primitives | `@base-ui/react` 1 (default), `radix-ui` 1 | `import { Dialog } from "@base-ui/react/dialog"` |
| Forms and validation | `react-hook-form` 7, `@hookform/resolvers` 5, `zod` 4 | through `@mostra/react/form` ([answers.md](answers.md#forms-with-react-hook-form)) |
| Icons | `lucide-react` 1 | `import { Check } from "lucide-react"` |
| Charts | `recharts` 3, `echarts` 6, `uplot` 1 | see [Charts](#charts) |
| Tables | `@tanstack/react-table` 9 | see [Tables](#tables-tanstack-table-9) |
| Motion | `motion` 14 | `import { motion, AnimatePresence } from "motion/react"` |
| Diagrams | `mermaid` 12, `@xyflow/react` 12 | |
| Code | `shiki` 4 (display), `codemirror` 6 and `@codemirror/*` (editing) | |
| Math | `katex` | |
| Terminal output | `@xterm/xterm` and its addons | |
| Smaller pieces | `sonner` (toasts), `vaul` (drawers), `cmdk` (command menu), `embla-carousel-react`, `react-day-picker`, `input-otp`, `react-resizable-panels` | |

Maps, 3D and whiteboards (MapLibre, deck.gl, react-three-fiber, Excalidraw) install on demand when imported.

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

Others: `accordion`, `alert-dialog`, `checkbox`, `collapsible`, `combobox`, `menu`, `popover`, `radio-group`, `select`, `slider`, `switch`, `tabs`, `toggle`, `tooltip` and more, each at `@base-ui/react/<name>`. Radix works too (`import { Dialog } from "radix-ui"`); keep one of them per artifact.

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
