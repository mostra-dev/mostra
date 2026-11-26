/**
 * KT-03: every part of both bases type-checks under Mostra's strict check, as an artifact that
 * imports it is checked (verify's default options, D138 item 8 and D139), with the unused-code
 * checks of an artifact's own `tsconfig.json` on top (shadcn's Vite template sets them, and the
 * Base UI item that failed them is fixed in `scripts/studio.ts`). `@/*` resolves into the base's
 * registry, as it does for an artifact without its own copies (ROUND-3 §1.1).
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const tsc = join(dirname(require.resolve("typescript/package.json")), "bin", "tsc");

function check(base: "base" | "radix"): string[] {
  const dir = join(ROOT, ".check", base);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const registry = join(ROOT, "registry", base);
  writeFileSync(
    join(dir, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        lib: ["ES2023", "DOM", "DOM.Iterable"],
        jsx: "react-jsx",
        module: "ESNext",
        moduleResolution: "bundler",
        isolatedModules: true,
        allowImportingTsExtensions: true,
        resolveJsonModule: true,
        strict: true,
        noUnusedLocals: true,
        noUnusedParameters: true,
        noEmit: true,
        skipLibCheck: true,
        types: [],
        // A kit module imports another as an artifact does (`@mostra/kit/tokens`): the registry's.
        paths: {
          "@/*": [`${registry}/*`],
          "@mostra/kit/*": [`${registry}/components/mostra/*`],
        },
      },
      // Verify's check declares what the build's imports are with Vite's own client types; a
      // stylesheet imported for its effect is one (`declare module "*.css" {}`).
      include: [`${registry}/**/*.ts`, `${registry}/**/*.tsx`, join(dir, "assets.d.ts")],
    }),
  );
  // Vite's own declarations of these (its `client.d.ts`), as verify's check has them.
  writeFileSync(
    join(dir, "assets.d.ts"),
    'declare module "*.css" {}\ndeclare module "*?worker&url" {\n  const src: string;\n  export default src;\n}\n',
  );
  const run = spawnSync(
    process.execPath,
    [tsc, "-p", join(dir, "tsconfig.json"), "--pretty", "false"],
    {
      cwd: ROOT,
      encoding: "utf8",
    },
  );
  rmSync(dir, { recursive: true, force: true });
  return `${run.stdout}${run.stderr}`
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => line.replace(ROOT, ""));
}

describe("the registry packs type-check (KT-03)", () => {
  for (const base of ["base", "radix"] as const) {
    it(`${base}: every part, strict, with unused code refused`, () => {
      expect(check(base)).toEqual([]);
    }, 120_000);
  }
});
