/**
 * A build reads nothing from the directories above the home (VR-01, D80 Claude review finding 1):
 * a stray `node_modules`, `tsconfig.json` or PostCSS config there would change versions without
 * changing any digest. The test plants all three beside a real home, and a marker file that a
 * PostCSS config writes when it runs.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  connectTo,
  initializeParams,
  type LineClient,
  type Message,
  startDaemon,
  type TestHome,
  tempDir,
  testHome,
} from "../support.ts";

let home: TestHome;
let root: string;
let client: LineClient;
let exited: Promise<unknown>;

beforeAll(async () => {
  home = testHome();
  root = join(home.home, "..");
  const write = (path: string, text: string): void => {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  write(
    "node_modules/leftpad-x/package.json",
    JSON.stringify({ name: "leftpad-x", version: "1.0.0", type: "module", main: "index.js" }),
  );
  write("node_modules/leftpad-x/index.js", 'export const marker = "ANCESTOR_PACKAGE";\n');
  write("tsconfig.json", JSON.stringify({ compilerOptions: { useDefineForClassFields: false } }));
  write("package.json", JSON.stringify({ name: "above-the-home", private: true }));
  write(
    "postcss.config.cjs",
    `require("node:fs").writeFileSync(${JSON.stringify(join(root, "postcss-ran"))}, "ran");\nmodule.exports = { plugins: [] };\n`,
  );
  const daemon = await startDaemon(home);
  exited = daemon.exited;
  client = await connectTo(daemon.status.socket as string);
  expect((await client.call("mostra/initialize", initializeParams())).error).toBeUndefined();
});

afterAll(async () => {
  await client?.call("mostra/shutdown", {});
  await exited;
});

function artifact(page: string): string {
  const dir = join(tempDir("ancestors"), "artifact");
  mkdirSync(dir);
  writeFileSync(join(dir, "index.tsx"), page);
  writeFileSync(join(dir, "styles.css"), ".box { color: red; }\n");
  return dir;
}

const publish = (dir: string): Promise<Message> =>
  client.call("artifact/publish", { source: { path: dir } });

describe("inputs above the home (VR-01)", () => {
  it("refuses a package that isn't in the warm set, even when a node_modules above the home has it", async () => {
    const response = await publish(
      artifact(
        'import { marker } from "leftpad-x";\nexport default function Page() { return <p>{marker}</p>; }\n',
      ),
    );
    expect(response.error?.data.code).toBe("MOSTRA_BUILD_UNRESOLVED");
    expect(response.error?.data.message).toContain("isn't in the warm set");
  });

  it("compiles with Mostra's settings, not a tsconfig.json above the home, and runs no PostCSS config from there", async () => {
    const response = await publish(
      artifact(
        [
          'import "./styles.css";',
          'class Box { foo = "FIELD_MARK"; }',
          'export default function Page() { return <p className="box">{new Box().foo}</p>; }',
          "",
        ].join("\n"),
      ),
    );
    expect(response.error).toBeUndefined();
    const { versionId } = response.result as { versionId: string };
    const assets = join(home.home, "versions", versionId, "client", "assets");
    const script = readdirSync(assets)
      .filter((name) => name.endsWith(".js"))
      .map((name) => readFileSync(join(assets, name), "utf8"))
      .join("\n");
    // useDefineForClassFields: true keeps the class field; the planted `false` would turn it into
    // an assignment in a constructor.
    expect(script).toContain("FIELD_MARK");
    expect(script).not.toMatch(/this\.foo\s*=/);
    expect(existsSync(join(root, "postcss-ran"))).toBe(false);
  });
});
