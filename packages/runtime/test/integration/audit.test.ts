/**
 * The supervisor never loads artifact code (RT-02, AU-07): a real `mostra-runtime daemon`, with
 * every module it loads recorded, hosts several artifacts through create, publish, list and get;
 * afterwards its module list holds no artifact file and no bundler, and side effects written into
 * the artifacts never ran. Verify runs (WP-09) and action calls (WP-08) extend this audit (D93).
 */
import { cpSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import {
  connectTo,
  initializeParams,
  type Message,
  startDaemon,
  tempDir,
  testHome,
} from "../support.ts";

const fixtures = fileURLToPath(new URL("../fixtures/", import.meta.url));
const result = (message: Message): unknown => {
  if (message.error) throw new Error(`${message.error.data.code}: ${message.error.data.message}`);
  return message.result;
};

/** An artifact whose every module writes a marker when it is executed. */
function trap(marker: string): string {
  const dir = join(tempDir("trap"), "trap");
  cpSync(join(fixtures, "artifacts/directory"), dir, { recursive: true });
  // Bundles for the browser unchanged, and writes the marker if Node ever executes the module.
  const effect = `(globalThis as any).process?.getBuiltinModule?.("node:fs")?.appendFileSync(${JSON.stringify(marker)}, "ran\\n");\n`;
  for (const file of ["index.tsx", "pages/index.tsx", "components/greeting.tsx", "live.ts"]) {
    writeFileSync(join(dir, file), effect + readFileSync(join(dir, file), "utf8"));
  }
  const actions = readFileSync(join(dir, "actions.ts"), "utf8").replace(
    '"use server";\n',
    `"use server";\n${effect}`,
  );
  writeFileSync(join(dir, "actions.ts"), actions);
  return dir;
}

it("loads no artifact module and no bundler in the supervisor across create, publish, list and get (RT-02)", async () => {
  const home = testHome();
  const audit = join(tempDir("audit"), "modules.json");
  const marker = join(tempDir("marker"), "executed.txt");
  const daemon = await startDaemon(home, {
    env: { ...home.env, MOSTRA_TEST_AUDIT_FILE: audit },
    nodeArgs: ["--import", join(fixtures, "audit.mjs")],
  });
  const client = await connectTo(daemon.status.socket as string);
  result(await client.call("mostra/initialize", initializeParams()));

  const sources: string[] = [];
  const trapped = trap(marker);
  sources.push(trapped);
  const mdx = join(tempDir("mdx"), "notes");
  cpSync(join(fixtures, "artifacts/single-mdx"), mdx, { recursive: true });
  sources.push(mdx);
  const created = result(
    await client.call("artifact/create", { dir: join(tempDir("new"), "plan") }),
  ) as {
    dir: string;
  };
  sources.push(created.dir);

  const receipts = [];
  for (const path of [trapped, join(mdx, "page.mdx"), created.dir, trapped]) {
    receipts.push(
      result(await client.call("artifact/publish", { source: { path } })) as { artifactId: string },
    );
  }
  const failing = join(tempDir("failing"), "x");
  cpSync(trapped, failing, { recursive: true });
  writeFileSync(
    join(failing, "index.tsx"),
    readFileSync(join(failing, "index.tsx"), "utf8").replace(
      'title: "Team dashboard"',
      "title: String(1)",
    ),
  );
  sources.push(failing);
  expect(
    (await client.call("artifact/publish", { source: { path: failing } })).error?.data.code,
  ).toBe("MOSTRA_MANIFEST_NOT_LITERAL");
  const listed = result(await client.call("artifact/list", {})) as { artifacts: unknown[] };
  expect(listed.artifacts).toHaveLength(3);
  for (const receipt of receipts)
    result(await client.call("artifact/get", { artifact: { artifactId: receipt.artifactId } }));

  await client.call("mostra/shutdown", {});
  await daemon.exited;

  const modules = JSON.parse(readFileSync(audit, "utf8")) as string[];
  const paths = modules.filter((url) => url.startsWith("file:")).map((url) => fileURLToPath(url));
  // The audit sees the supervisor's own modules (sanity: the hook recorded real loads).
  expect(paths.some((path) => path.includes("oxc-parser"))).toBe(true);
  expect(paths.some((path) => path.includes("better-sqlite3"))).toBe(true);
  // No module from an artifact, its staging copy or a built version ran in the supervisor.
  const forbidden = [...sources, home.home];
  expect(paths.filter((path) => forbidden.some((root) => path.startsWith(root)))).toEqual([]);
  expect(paths.filter((path) => /\.(tsx|jsx|mdx)$/.test(path))).toEqual([]);
  // The bundler stays in the builder child.
  expect(
    paths.filter((path) =>
      /node_modules\/(vite|rolldown|@vitejs|@tailwindcss|@mdx-js)\//.test(path),
    ),
  ).toEqual([]);
  // No artifact code ran anywhere: not in the supervisor, not in the builder.
  expect(existsSync(marker)).toBe(false);
  // The trap works: the same statement, run by Node, writes the marker.
  const control = join(tempDir("control"), "executed.txt");
  new Function(
    `globalThis.process.getBuiltinModule("node:fs").appendFileSync(${JSON.stringify(control)}, "ran");`,
  )();
  expect(readFileSync(control, "utf8")).toBe("ran");
});
