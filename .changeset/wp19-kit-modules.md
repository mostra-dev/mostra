---
"@mostra/kit": minor
"@mostra/runtime": minor
"@mostra/verify": patch
---

The kit wraps every library of its default set, each a module that reads the page's theme and takes `className`: `@mostra/kit/charts` (bar, line, area and donut charts on Recharts), `/echarts`, `/data-table` (TanStack Table 9), `/mermaid`, `/flow` (React Flow 13), `/code` (Shiki, and a CodeMirror editor that saves as a field), `/math` (KaTeX), and, installed on demand at the kit's pins, `/map` (MapLibre and deck.gl on a world outline that needs no tile server), `/scene` (react-three-fiber) and `/whiteboard` (Excalidraw, saved as a field). `@mostra/kit/team` shows who is here, their cursors, who has answered and who changed a shared field, from the team hooks. A questionnaire inside a `Page` titles itself as a section, and a lone button in a `Page` keeps its own width (#242). Verify reads the editor's and the whiteboard's fields, type-checks a kit module's on-demand libraries against the installed ones, and leaves an input inside `data-mostra-transient` (a table's search) unjudged.
