/**
 * The kit's lint (KT-08, WP-18): each "write this, not that" rule finds the old form, and its fix,
 * applied with `applyFixes`, writes the new one, which the lint then finds nothing in; the other
 * base's idiom is found with its rewrite, and verify turns the type check's TS2322 there into
 * `MOSTRA_KIT_WRONG_BASE`.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { applyFixes, createDiagnostic, type Diagnostic } from "@mostra/protocol";
import { describe, expect, it } from "vitest";
import { wrongBaseOf } from "../../src/verify/index.ts";
import { lintArtifact, tailwind4Class } from "../../src/verify/lint.ts";
import { tempDir } from "../support.ts";

async function lint(file: string, text: string, base: "base" | "radix" = "base") {
  const root = tempDir("lint");
  mkdirSync(join(root, file, ".."), { recursive: true });
  writeFileSync(join(root, file), text);
  return lintArtifact(root, base);
}

/** The text after every fix the lint reports, and what a second lint finds in it. */
async function fixed(file: string, text: string) {
  const first = await lint(file, text);
  const fixes = first.diagnostics
    .map((diagnostic) => diagnostic.fix)
    .filter((fix) => fix !== undefined);
  const after = applyFixes(text, fixes);
  expect(after.skipped).toBe(0);
  const second = await lint(file, after.text);
  return { found: first.diagnostics, text: after.text, again: second.diagnostics };
}

/** Every rule: the old form, and the new one its fix writes. */
const RULES: readonly {
  readonly rule: string;
  readonly file: string;
  readonly before: string;
  readonly after: string;
}[] = [
  {
    rule: "Motion",
    file: "index.tsx",
    before: `import { motion } from "framer-motion";\nexport const A = () => <motion.div />;\n`,
    after: `import { motion } from "motion/react";\nexport const A = () => <motion.div />;\n`,
  },
  {
    rule: "React Router",
    file: "index.tsx",
    before: `import { Link } from 'react-router-dom';\nexport const A = () => <Link to="/">Home</Link>;\n`,
    after: `import { Link } from 'react-router';\nexport const A = () => <Link to="/">Home</Link>;\n`,
  },
  {
    rule: "React Flow",
    file: "index.tsx",
    before: `import Flow, { Background } from "reactflow";\nimport "reactflow/dist/style.css";\nexport const A = () => <Flow nodes={[]}><Background /></Flow>;\n`,
    // React Flow 13's stylesheet path (M110: the kit is on 13).
    after: `import { ReactFlow as Flow, Background } from "@xyflow/react";\nimport "@xyflow/react/style.css";\nexport const A = () => <Flow nodes={[]}><Background /></Flow>;\n`,
  },
  {
    rule: "React Flow 13",
    file: "flow.tsx",
    before: `import { useState } from "react";\nimport { ReactFlow, applyNodeChanges, applyEdgeChanges, type Node, type Edge } from "@xyflow/react";\nexport function F() {\n  const [nodes, setNodes] = useState<Node[]>([]);\n  const [edges, setEdges] = useState<Edge[]>([]);\n  return (\n    <ReactFlow\n      nodes={nodes}\n      edges={edges}\n      colorMode="dark"\n      onNodesChange={(changes) => setNodes((nds) => applyNodeChanges(changes, nds))}\n      onEdgesChange={(changes) => setEdges((eds) => applyEdgeChanges(changes, eds))}\n    />\n  );\n}\nexport const G = () => <ReactFlow nodes={[]} colorMode="system" />;\n`,
    after: `import { useState } from "react";\nimport { ReactFlow, type Node, type Edge } from "@xyflow/react";\nexport function F() {\n  const [nodes, setNodes] = useState<Node[]>([]);\n  const [edges, setEdges] = useState<Edge[]>([]);\n  return (\n    <ReactFlow\n      nodes={nodes}\n      edges={edges}\n      forceColorMode="dark"\n      onNodesChange={(changes) => setNodes((nds) => changes.applyTo(nds))}\n      onEdgesChange={(changes) => setEdges((eds) => changes.applyTo(eds))}\n    />\n  );\n}\nexport const G = () => <ReactFlow nodes={[]} />;\n`,
  },
  {
    rule: "Shiki",
    file: "code.ts",
    before: `import { getHighlighter } from "shiki";\nexport const h = await getHighlighter({ themes: ["nord"], langs: ["ts"] });\n`,
    after: `import { createHighlighter as getHighlighter } from "shiki";\nexport const h = await getHighlighter({ themes: ["nord"], langs: ["ts"] });\n`,
  },
  {
    rule: "CodeMirror 6",
    file: "editor.ts",
    before: `import { EditorView, basicSetup } from "codemirror";\nimport "codemirror/lib/codemirror.css";\nexport const v = new EditorView({ extensions: [basicSetup] });\n`,
    after: `import { EditorView, basicSetup } from "codemirror";\n\nexport const v = new EditorView({ extensions: [basicSetup] });\n`,
  },
  {
    rule: "MapLibre",
    file: "map.tsx",
    // The access token goes with the move: MapLibre has none to set (Opus review of WP-19, 7).
    before: `import mapboxgl from "mapbox-gl";\nimport "mapbox-gl/dist/mapbox-gl.css";\nimport Map from "react-map-gl";\nmapboxgl.accessToken = "pk.example";\nexport const m = [mapboxgl, Map];\nexport const M = () => <Map mapboxAccessToken="pk.example" initialViewState={{ zoom: 2 }} />;\n`,
    after: `import mapboxgl from "maplibre-gl";\nimport "maplibre-gl/dist/maplibre-gl.css";\nimport Map from "react-map-gl/maplibre";\nexport const m = [mapboxgl, Map];\nexport const M = () => <Map initialViewState={{ zoom: 2 }} />;\n`,
  },
  {
    rule: "react-three-fiber",
    file: "scene.tsx",
    before: `import { Canvas } from "react-three-fiber";\nimport { OrbitControls } from "drei";\nexport const S = () => <Canvas><OrbitControls /></Canvas>;\n`,
    after: `import { Canvas } from "@react-three/fiber";\nimport { OrbitControls } from "@react-three/drei";\nexport const S = () => <Canvas><OrbitControls /></Canvas>;\n`,
  },
  {
    rule: "TanStack Table 9",
    file: "table.tsx",
    before: `import { flexRender, getCoreRowModel, useReactTable } from "@tanstack/react-table";\nexport const t = [flexRender, getCoreRowModel, useReactTable];\n`,
    after: `import { flexRender } from "@tanstack/react-table";\nimport { getCoreRowModel, useLegacyTable as useReactTable } from "@tanstack/react-table/legacy";\nexport const t = [flexRender, getCoreRowModel, useReactTable];\n`,
  },
  {
    rule: "Zod 4",
    file: "schema.ts",
    before: `import * as z from "zod";\nexport const s = z.object({ mail: z.string().email(), at: z.string().datetime({ offset: true }) });\n`,
    after: `import * as z from "zod";\nexport const s = z.object({ mail: z.email(), at: z.iso.datetime({ offset: true }) });\n`,
  },
  {
    rule: "Mermaid 12",
    file: "diagram.ts",
    before: `import mermaid from "mermaid";\nawait mermaid.init();\nexport const out = mermaid.mermaidAPI.render("d", "graph TD; A-->B");\n`,
    after: `import mermaid from "mermaid";\nawait mermaid.run();\nexport const out = mermaid.render("d", "graph TD; A-->B");\n`,
  },
  {
    rule: "Tailwind CSS 4 classes",
    file: "index.tsx",
    before: `import { cn } from "cn";\nexport const A = ({ on }: { on: boolean }) => (\n  <div className="flex-shrink-0 md:flex-grow bg-gradient-to-r bg-[--brand]">\n    <p className={cn("overflow-ellipsis", on && "hover:!flex-grow-0")} />\n  </div>\n);\n`,
    after: `import { cn } from "cn";\nexport const A = ({ on }: { on: boolean }) => (\n  <div className="shrink-0 md:grow bg-linear-to-r bg-(--brand)">\n    <p className={cn("text-ellipsis", on && "hover:!grow-0")} />\n  </div>\n);\n`,
  },
  {
    rule: "Tailwind CSS 4 directives",
    file: "styles.css",
    before: `@tailwind base;\n@tailwind components;\n@tailwind utilities;\n\n.card { color: red; }\n`,
    after: `@import "tailwindcss";\n\n\n\n.card { color: red; }\n`,
  },
  {
    rule: "cn",
    file: "lib/utils.ts",
    before: `import { clsx, type ClassValue } from "clsx"\nimport { twMerge } from "tailwind-merge"\n\nexport function cn(...inputs: ClassValue[]) {\n  return twMerge(clsx(inputs))\n}\n`,
    after: `export { cn } from "cn";\n`,
  },
];

describe("write this, not that (KT-08)", () => {
  it("React Flow 13: keeps the helpers' import while a use the fix can't rewrite remains, and says so (Opus review of WP-19, finding 7)", async () => {
    const before = `import { applyNodeChanges, ReactFlow } from "@xyflow/react";\nconst apply = applyNodeChanges;\nexport const F = ({ set }: { set: (f: unknown) => void }) => <ReactFlow onNodesChange={(c) => set((n: never[]) => applyNodeChanges(c, n))} />;\nexport { apply };\n`;
    const result = await fixed("flow.tsx", before);
    // The call is rewritten; the import stays, since \`apply\` still names the helper.
    expect(result.text).toContain(`import { applyNodeChanges, ReactFlow } from "@xyflow/react";`);
    expect(result.text).toContain("c.applyTo(n)");
    const note = result.found.find((d) => d.message.includes("is gone"));
    expect(note?.fix).toBeUndefined();
    expect(note?.message).toMatch(/left to change by hand/);
  });

  for (const { rule, file, before, after } of RULES) {
    it(`${rule}: the fix writes the new form, and the lint then finds nothing`, async () => {
      const result = await fixed(file, before);
      expect(result.found.length).toBeGreaterThan(0);
      expect(result.found.every((d) => d.code === "MOSTRA_LINT_API_CHANGED")).toBe(true);
      expect(result.found.every((d) => d.severity === "warning" && d.location !== undefined)).toBe(
        true,
      );
      expect(result.text).toBe(after);
      expect(result.again).toEqual([]);
    });
  }

  it("leaves what is already current, and what it can't prove, alone", async () => {
    const quiet = await lint(
      "index.tsx",
      `import { motion } from "motion/react";
import * as z from "zod";
import { createColumnHelper, useTable } from "@tanstack/react-table";
import { ReactFlow } from "@xyflow/react";
import "@xyflow/react/style.css";
import { createHighlighter } from "shiki";
import maplibregl from "maplibre-gl";
import { Canvas } from "@react-three/fiber";
const string = { email: () => 1 };
const applyNodeChanges = (a: unknown, b: unknown) => [a, b];
export const f = [ReactFlow, createHighlighter, maplibregl, Canvas, applyNodeChanges(1, 2)];
export const B = () => <ReactFlow nodes={[]} forceColorMode="dark" />;
export const s = [z.email(), z.string().min(1).email(), string.email(), useTable, createColumnHelper];
export const A = () => <div className="shrink-0 grow bg-linear-to-r bg-(--brand) shadow-sm">The flex-grow is fine in prose</div>;
`,
    );
    expect(quiet.diagnostics).toEqual([]);
  });

  it("rewrites a class with its variants and keeps the rest", () => {
    expect(tailwind4Class("sm:hover:flex-grow")).toBe("sm:hover:grow");
    expect(tailwind4Class("[&>svg]:flex-shrink-0")).toBe("[&>svg]:shrink-0");
    expect(tailwind4Class("text-[--brand]")).toBe("text-(--brand)");
    expect(tailwind4Class("bg-gradient-to-br")).toBe("bg-linear-to-br");
    expect(tailwind4Class("shrink-0")).toBeUndefined();
    expect(tailwind4Class("bg-[#fff]")).toBeUndefined();
  });

  it("finds the first and the last class of a template's text, and fixes each in place (Opus review 10)", async () => {
    const before =
      "export const A = ({ x }: { x: string }) => (\n  <div className={`flex-shrink-0 p-2 ${x} bg-gradient-to-r`} />\n);\n";
    const result = await fixed("index.tsx", before);
    expect(result.found.map((d) => d.message)).toEqual([
      expect.stringContaining("`flex-shrink-0`"),
      expect.stringContaining("`bg-gradient-to-r`"),
    ]);
    expect(result.text).toBe(
      "export const A = ({ x }: { x: string }) => (\n  <div className={`shrink-0 p-2 ${x} bg-linear-to-r`} />\n);\n",
    );
    expect(result.again).toEqual([]);
  });

  it("deletes Tailwind 3's directives from a layer of the theme stack, which imports nothing (Opus review 7)", async () => {
    const root = tempDir("lint-layer-directives");
    const text = "@tailwind base;\n@tailwind utilities;\n.brand { color: red; }\n";
    writeFileSync(join(root, "brand.css"), text);
    const found = (await lintArtifact(root, "base", ["brand.css"])).diagnostics;
    expect(found.map((d) => d.code)).toEqual([
      "MOSTRA_LINT_API_CHANGED",
      "MOSTRA_LINT_API_CHANGED",
    ]);
    const after = applyFixes(
      text,
      found.flatMap((d) => (d.fix !== undefined ? [d.fix] : [])),
    );
    expect(after.text).not.toContain("tailwindcss");
    expect(after.text).toBe("\n\n.brand { color: red; }\n");
  });
});

describe("Tailwind CSS that Tailwind never reads (MOSTRA_KIT_CSS_UNPROCESSED)", () => {
  const brand =
    "/* Our brand. */\n@theme {\n  --color-brand: oklch(0.5 0.2 30);\n}\n.cta { @apply bg-brand; }\n";

  it("names a stylesheet with Tailwind's directives that neither imports Tailwind nor is a layer", async () => {
    const found = await lint("brand.css", brand);
    expect(found.diagnostics.map((d) => [d.code, d.severity, d.location])).toEqual([
      ["MOSTRA_KIT_CSS_UNPROCESSED", "warning", { file: "brand.css", line: 2, column: 1 }],
    ]);
  });

  it("leaves a layer of the theme stack, one that imports Tailwind, and plain CSS alone", async () => {
    const root = tempDir("lint-layers");
    writeFileSync(join(root, "brand.css"), brand);
    expect((await lintArtifact(root, "base", ["brand.css"])).diagnostics).toEqual([]);
    expect((await lint("own.css", `@import "tailwindcss";\n${brand}`)).diagnostics).toEqual([]);
    expect(
      (await lint("plain.css", ".a { color: red; } /* @apply in a comment */\n")).diagnostics,
    ).toEqual([]);
  });
});

describe("the other base's idiom (KT-08, MOSTRA_KIT_WRONG_BASE)", () => {
  const typeError = (file: string, line: number, column: number, attribute: string): Diagnostic =>
    createDiagnostic("MOSTRA_TYPE_ERROR", {
      message: `TS2322: Type '{ children: Element; ${attribute}: true; }' is not assignable to type 'IntrinsicAttributes & Props<unknown>'. Property '${attribute}' does not exist on type 'IntrinsicAttributes & Props<unknown>'.`,
      location: { file, line, column },
    });

  it("finds asChild on a Base UI part, and the type check's TS2322 there becomes the diagnostic with the render rewrite", async () => {
    const text = `import { Button } from "@/components/ui/button";
import { DialogTrigger } from "@/components/ui/dialog";
export const A = () => (
  <DialogTrigger asChild className="w-fit">
    <Button variant="outline">Open the plan</Button>
  </DialogTrigger>
);
`;
    const found = await lint("index.tsx", text, "base");
    expect(found.wrongBase).toEqual([
      expect.objectContaining({ file: "index.tsx", line: 4, column: 18, attribute: "asChild" }),
    ]);
    const diagnostic = wrongBaseOf(
      typeError("index.tsx", 4, 18, "asChild"),
      found.wrongBase,
      "base",
    );
    expect(diagnostic.code).toBe("MOSTRA_KIT_WRONG_BASE");
    expect(diagnostic.severity).toBe("error");
    expect(diagnostic.message).toContain("`asChild` is Radix's way");
    const rewritten = applyFixes(text, [diagnostic.fix as NonNullable<Diagnostic["fix"]>]);
    expect(rewritten.text).toContain(
      `<DialogTrigger className="w-fit" render={<Button variant="outline" />}>Open the plan</DialogTrigger>`,
    );
    expect((await lint("index.tsx", rewritten.text, "base")).wrongBase).toEqual([]);
  });

  it("finds a render element on a Radix part, with the asChild rewrite", async () => {
    const text = `import { Button } from "@/components/ui/button";
import { DialogTrigger } from "@/components/ui/dialog";
export const A = () => <DialogTrigger render={<Button variant="outline" />}>Open</DialogTrigger>;
`;
    const found = await lint("index.tsx", text, "radix");
    expect(found.wrongBase).toHaveLength(1);
    const diagnostic = wrongBaseOf(
      typeError("index.tsx", 3, 39, "render"),
      found.wrongBase,
      "radix",
    );
    expect(diagnostic.code).toBe("MOSTRA_KIT_WRONG_BASE");
    const rewritten = applyFixes(text, [diagnostic.fix as NonNullable<Diagnostic["fix"]>]);
    expect(rewritten.text).toContain(
      `<DialogTrigger asChild><Button variant="outline">Open</Button></DialogTrigger>`,
    );
  });

  it("leaves the base's own idiom, a type error elsewhere and parts it doesn't know alone", async () => {
    const own = await lint(
      "index.tsx",
      `import { DialogTrigger } from "@/components/ui/dialog";
import { Slot } from "./slot";
export const A = () => <><DialogTrigger render={<button />}>Open</DialogTrigger><Slot asChild><a /></Slot></>;
`,
      "base",
    );
    expect(own.wrongBase).toEqual([]);
    const other = typeError("index.tsx", 9, 1, "asChild");
    expect(wrongBaseOf(other, own.wrongBase, "base")).toBe(other);
  });
});
