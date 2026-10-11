/**
 * The builder's static scan (INTERFACES §11, D54 to D57): `"use server"` exports with their
 * `dryRun()` opt-ins, the contract on what such a module may export, live sources and routes.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { serverClientStubPlugin, serverStub } from "../../src/builder/child/plugins.ts";
import { scanArtifact } from "../../src/builder/child/scan.ts";
import { tempDir } from "../support.ts";

function artifact(files: Record<string, string>): string {
  const root = tempDir("scan");
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

describe('"use server" modules (D54, D55)', () => {
  it("lists every async export, and which ones opt into verify through dryRun()", async () => {
    const scan = await scanArtifact(
      artifact({
        "actions.ts": `"use server";
import { dryRun, progress } from "@mostra/server";
import * as server from "@mostra/server";
async function guard() { return dryRun(); }
async function deeper() { return guard(); }
export async function direct() { if (dryRun()) return 0; return 1; }
export async function viaHelper() { if (await deeper()) return 0; return 1; }
export const viaNamespace = async () => (server.dryRun() ? 0 : 1);
export const plain = async () => { progress({ message: "dryRun" }); return 1; };
async function named() { return 2; }
export { named as renamed };
export default async function () { return 3; }
export type Result = number;
export interface Shape { a: number }
`,
        "lib/other.tsx": `'use server'\nexport async function save(data: FormData) { return data; }\n`,
        "client.tsx": "export const notServer = 'use server';\n",
      }),
    );
    expect(scan.diagnostics).toEqual([]);
    expect([...scan.serverModules.keys()]).toEqual(["actions.ts", "lib/other.tsx"]);
    expect(scan.serverModules.get("actions.ts")).toEqual(
      [
        ["direct", true],
        ["viaHelper", true],
        ["viaNamespace", true],
        ["plain", false],
        ["renamed", false],
        ["default", false],
      ].map(([name, dryRun]) => ({
        id: `actions.ts#${name}`,
        module: "actions.ts",
        export: name,
        dryRun,
      })),
    );
  });

  it("never treats a mention of dryRun that isn't a call as an opt-in", async () => {
    const scan = await scanArtifact(
      artifact({
        "actions.ts": `"use server";
import { dryRun } from "@mostra/server";
export async function sneaky() { const flag = dryRun; return { dryRun: flag }; }
`,
      }),
    );
    expect(scan.serverModules.get("actions.ts")?.[0]?.dryRun).toBe(false);
  });

  it("reports exports that aren't async functions, with their location", async () => {
    const scan = await scanArtifact(
      artifact({
        "actions.ts": `"use server";
export const limit = 10;
export function sync() { return 1; }
export class Thing {}
export * from "./other";
export { x } from "./other";
export async function fine() { return 1; }
`,
      }),
    );
    expect(scan.diagnostics.map((diagnostic) => [diagnostic.code, diagnostic.location])).toEqual([
      ["MOSTRA_ACTION_EXPORT_INVALID", { file: "actions.ts", line: 5, column: 1 }],
      ["MOSTRA_ACTION_EXPORT_INVALID", { file: "actions.ts", line: 6, column: 1 }],
      ["MOSTRA_ACTION_EXPORT_INVALID", { file: "actions.ts", line: 2, column: 14 }],
      ["MOSTRA_ACTION_EXPORT_INVALID", { file: "actions.ts", line: 3, column: 8 }],
      ["MOSTRA_ACTION_EXPORT_INVALID", { file: "actions.ts", line: 4, column: 8 }],
    ]);
    expect(scan.serverModules.get("actions.ts")?.map((entry) => entry.export)).toEqual(["fine"]);
  });

  it("sees through erased TypeScript wrappers and overloads (review finding 8)", async () => {
    const scan = await scanArtifact(
      artifact({
        "actions.ts": `"use server";
import { dryRun } from "@mostra/server";
export const typed = (async () => (dryRun() ? 0 : 1)) satisfies () => Promise<number>;
export const asserted = (async () => 1) as () => Promise<number>;
const held = async (n: number) => n;
export const nonNull = held!;
export async function overloaded(a: string): Promise<string>;
export async function overloaded(a: number): Promise<number>;
export async function overloaded(a: string | number) { return a; }
export declare const ambient: number;
`,
      }),
    );
    expect(scan.diagnostics).toEqual([]);
    expect(
      scan.serverModules.get("actions.ts")?.map((entry) => [entry.export, entry.dryRun]),
    ).toEqual([
      ["typed", true],
      ["asserted", false],
      ["nonNull", false],
      ["overloaded", false],
    ]);
  });

  it("reports enums and namespaces, which are values at run time (review finding 10)", async () => {
    const scan = await scanArtifact(
      artifact({
        "actions.ts": `"use server";
export enum Mode { A, B }
export namespace Tools { export const x = 1; }
export async function fine() { return 1; }
`,
      }),
    );
    expect(scan.diagnostics.map((diagnostic) => diagnostic.location)).toEqual([
      { file: "actions.ts", line: 2, column: 8 },
      { file: "actions.ts", line: 3, column: 8 },
    ]);
  });

  it("compiles a module into client stubs that carry only IDs", () => {
    const stub = serverStub([
      { id: "actions.ts#send", module: "actions.ts", export: "send", dryRun: false },
      { id: "actions.ts#default", module: "actions.ts", export: "default", dryRun: true },
    ]);
    expect(stub).toBe(
      [
        'import { createServerReference } from "@mostra/react";',
        'const reference0 = createServerReference("actions.ts#send");',
        'export { reference0 as "send" };',
        'const reference1 = createServerReference("actions.ts#default");',
        'export { reference1 as "default" };',
        "",
      ].join("\n"),
    );
  });
});

describe("live sources and pages (D56, D57)", () => {
  it("reads live.ts's defineLive exports", async () => {
    const scan = await scanArtifact(
      artifact({
        "live.ts": `import { defineLive } from "@mostra/server";
export const inbox = defineLive({ refresh: "5m", load: async () => [] });
export const prices = defineLive({ stream: async function* () {} });
export const helper = 1;
`,
      }),
    );
    expect(scan).toMatchObject({
      hasLive: true,
      liveSources: [{ key: "inbox" }, { key: "prices" }],
    });
  });

  it("maps pages/ files to routes, with index folders and [param] segments", async () => {
    const scan = await scanArtifact(
      artifact({
        "pages/index.tsx": "",
        "pages/settings.mdx": "",
        "pages/reports/index.jsx": "",
        "pages/reports/[id].tsx": "",
        "pages/docs/[...rest].tsx": "",
        "pages/notes.txt": "",
      }),
    );
    expect(scan.pages).toEqual([
      { path: "/docs/*", file: "pages/docs/[...rest].tsx" },
      { path: "/", file: "pages/index.tsx" },
      { path: "/reports/:id", file: "pages/reports/[id].tsx" },
      { path: "/reports", file: "pages/reports/index.jsx" },
      { path: "/settings", file: "pages/settings.mdx" },
    ]);
    const clash = await scanArtifact(artifact({ "pages/a.tsx": "", "pages/a/index.tsx": "" }));
    expect(clash.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["MOSTRA_BUILD_FAILED"]);
  });
});

describe("server modules of every script extension (D80 Claude review finding 2)", () => {
  it("scans .cts, .cjs, .mts and .mjs modules", async () => {
    const scan = await scanArtifact(
      artifact({
        "a.cts": '"use server";\nexport async function a(x: number) { return x; }\n',
        "b.cjs": '"use server";\nexport async function b() { return 1; }\n',
        "c.mts": '"use server";\nexport async function c(): Promise<number> { return 1; }\n',
        "d.mjs": '"use server";\nexport async function d() { return 1; }\n',
      }),
    );
    expect(scan.diagnostics).toEqual([]);
    expect([...scan.serverModules.keys()].sort()).toEqual(["a.cts", "b.cjs", "c.mts", "d.mjs"]);
  });

  it("fails the client build for a server module that has no stub, instead of shipping it", () => {
    const plugin = serverClientStubPlugin(new Map(), "/art/source");
    const transform = plugin.transform as (this: unknown, code: string, id: string) => unknown;
    const context = {
      error(message: string): never {
        throw new Error(message);
      },
    };
    const server = '"use server";\nexport async function leak() { return "SECRET"; }\n';
    expect(() => transform.call(context, server, "/art/source/x.cts")).toThrow(/use server/);
    // Ordinary modules, files outside the artifact and non-scripts pass through untouched.
    expect(transform.call(context, "export const a = 1;\n", "/art/source/y.ts")).toBeNull();
    expect(transform.call(context, server, "/elsewhere/x.ts")).toBeNull();
    expect(transform.call(context, server, "/art/source/x.css")).toBeNull();
  });
});
