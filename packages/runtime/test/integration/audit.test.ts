/**
 * The supervisor never loads artifact code (RT-02, AU-07): a real `mostra-runtime daemon`, with
 * every module it loads recorded, hosts several artifacts through create, publish, list and get;
 * afterwards its module list holds no artifact file and no bundler, and side effects written into
 * the artifacts never ran in it. Action calls and live producers (WP-08) run the artifact's server
 * code, and only ever in its worker; verify runs (WP-09) extend this audit too (D93).
 */
import { cpSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { openPage, type RunState } from "../action-page.ts";
import {
  connectTo,
  eventually,
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
  // Each line names the process that ran it: its PID and its entry script.
  const effect = `{ const p = (globalThis as any).process; p?.getBuiltinModule?.("node:fs")?.appendFileSync(${JSON.stringify(marker)}, \`\${p.pid} \${p.argv[1]}\\n\`); }\n`;
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

it("loads no artifact module and no bundler in the supervisor across create, publish, list, get, action calls and live sources (RT-02)", async () => {
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
      result(await client.call("artifact/publish", { source: { path } })) as {
        artifactId: string;
        url: string;
      },
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
  // Building, publishing and reading ran no artifact code anywhere.
  expect(existsSync(marker)).toBe(false);

  // A page calls an action and reads a live source (WP-08): the server code runs, in a worker.
  const page = await openPage(receipts[3]?.url ?? "");
  const archived = await page.call("actions.ts#archive", ["a1"]);
  expect(archived.value).toEqual({ id: "a1", archived: true });
  const run = (await page.run("actions.ts#notify", ["hi"])).json<RunState>();
  expect((await page.settled(run.runId)).status).toBe("succeeded");
  expect((await page.live([{ key: "openWork" }])).status).toBe(200);
  await eventually(async () => {
    const live = (await page.live([{ key: "openWork" }])).json<{
      sources: { revision?: string }[];
    }>();
    return live.sources[0]?.revision !== undefined;
  }, 15_000);
  const ran = readFileSync(marker, "utf8").trim().split("\n");
  expect(ran.length).toBeGreaterThan(0);
  for (const line of ran) {
    const [pid, entry] = line.split(" ");
    expect(Number(pid)).not.toBe(daemon.status.pid);
    expect(entry).toMatch(/worker\/(dist|src)\/main\.(js|ts)$/);
  }

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
  // The trap works: the same statement, run by Node, writes the marker.
  const control = join(tempDir("control"), "executed.txt");
  new Function(
    `globalThis.process.getBuiltinModule("node:fs").appendFileSync(${JSON.stringify(control)}, "ran");`,
  )();
  expect(readFileSync(control, "utf8")).toBe("ran");
});
