/**
 * Demos built from their source and the page's exports (TM-08, VR-07; D185) through a real daemon.
 * A demo whose build fails, writes nothing where it said, or loads its files from outside its base
 * fails verify with the build's own words, and publish refuses it. An export of a page with
 * actions, live producers and a secret carries none of its server code, secret names or values,
 * names what it loses in its warning and report, and `strict` turns that into an error that writes
 * nothing; a snapshot's report says whose answers it holds and how many people the shared state
 * covers, and leaves the shared state out when asked.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GatewayHome, ok, type Receipt, refused } from "../gateway-home.ts";
import { tempDir } from "../support.ts";

interface Diagnostic {
  readonly code: string;
  readonly message: string;
}
interface Verdict {
  readonly status: "pass" | "fail";
  readonly diagnostics: readonly Diagnostic[];
}

/** An artifact whose one demo builds with `build` (a Node.js script given as its argument). */
function demoArtifact(name: string, script: string, output = "dist"): string {
  const dir = join(tempDir(`demos-${name}`), name);
  mkdirSync(join(dir, "app"), { recursive: true });
  writeFileSync(join(dir, "app", "build.mjs"), script);
  writeFileSync(
    join(dir, "index.tsx"),
    `import { defineArtifact } from "@mostra/react";
export const artifact = defineArtifact({
  title: "Demo ${name}",
  demos: { app: { source: "./app", build: ["node", "build.mjs"], output: ${JSON.stringify(output)} } },
});
export default function Page() {
  return <main><h1>Demo ${name}</h1></main>;
}
`,
  );
  return dir;
}

/** Every file under `dir`, with its text. */
function textsUnder(dir: string): { path: string; text: string }[] {
  const found: { path: string; text: string }[] = [];
  const walk = (at: string): void => {
    for (const name of readdirSync(at)) {
      const path = join(at, name);
      if (statSync(path).isDirectory()) walk(path);
      else found.push({ path, text: readFileSync(path, "latin1") });
    }
  };
  if (statSync(dir).isDirectory()) walk(dir);
  else found.push({ path: dir, text: readFileSync(dir, "latin1") });
  return found;
}

describe("a demo's build is checked before anyone sees it (D185 item 4)", () => {
  const gateway = new GatewayHome();

  beforeAll(async () => {
    await gateway.start();
  }, 120_000);

  afterAll(async () => {
    await gateway.stop();
  });

  const verify = async (dir: string): Promise<Verdict> =>
    ok<Verdict>(await gateway.client.call("artifact/verify", { source: { path: dir } }, 240_000));

  it("a build that fails fails verify with its last log lines, and publish refuses it", async () => {
    const dir = demoArtifact(
      "broken",
      `console.log("compiling the inventory");
console.error("src/main.js: Unexpected token, broken-build-marker");
process.exit(3);
`,
    );
    const verdict = await verify(dir);
    expect(verdict.status).toBe("fail");
    const failed = verdict.diagnostics.find((one) => one.code === "MOSTRA_DEMO_BUILD_FAILED");
    expect(failed?.message).toContain("broken-build-marker");
    expect(failed?.message).toContain("3");
    const publish = refused(
      await gateway.client.call("artifact/publish", { source: { path: dir } }, 240_000),
    );
    // A source whose demo didn't build is refused whatever `force` says, as a page that didn't build is.
    expect(publish).toBe("MOSTRA_DEMO_BUILD_FAILED");
  }, 300_000);

  it("a build that writes nothing where it said fails with MOSTRA_DEMO_OUTPUT_MISSING", async () => {
    const dir = demoArtifact("empty", `console.log("built nothing");\n`);
    const verdict = await verify(dir);
    expect(verdict.diagnostics.map((one) => one.code)).toContain("MOSTRA_DEMO_OUTPUT_MISSING");
  }, 300_000);

  it("an output that loads its files from outside its base fails with MOSTRA_DEMO_BASE_MISMATCH", async () => {
    const dir = demoArtifact(
      "unbased",
      `import { mkdirSync, writeFileSync } from "node:fs";
mkdirSync("dist/assets", { recursive: true });
writeFileSync("dist/assets/main.js", "document.title = 'x';");
writeFileSync("dist/index.html", '<!doctype html><script type="module" src="/assets/main.js"></script>');
`,
    );
    const verdict = await verify(dir);
    expect(verdict.diagnostics.map((one) => one.code)).toContain("MOSTRA_DEMO_BASE_MISMATCH");
  }, 300_000);

  it("a demo built for its base passes, is kept with the version and served at its path", async () => {
    const dir = demoArtifact(
      "good",
      `import { mkdirSync, writeFileSync } from "node:fs";
const base = process.env.MOSTRA_DEMO_BASE;
mkdirSync("dist/assets", { recursive: true });
writeFileSync("dist/assets/main.js", "document.body.dataset.ready = 'yes';");
writeFileSync("dist/index.html", '<!doctype html><title>Good</title><script type="module" src="' + base + 'assets/main.js"></script>');
`,
    );
    const verdict = await verify(dir);
    expect(verdict.diagnostics.filter((one) => one.code.startsWith("MOSTRA_DEMO_"))).toEqual([]);
    const receipt = ok<Receipt>(
      await gateway.client.call("artifact/publish", { source: { path: dir } }, 240_000),
    );
    const version = join(
      gateway.home.home,
      "versions",
      receipt.versionId,
      "client",
      "_mostra",
      "demos",
      "app",
    );
    expect(existsSync(join(version, "index.html"))).toBe(true);
    expect(readFileSync(join(version, "index.html"), "utf8")).toContain(
      "/_mostra/demos/app/assets/main.js",
    );
    // `demo/build` again finds it in the cache: the same source, command and base.
    const again = ok<{ demos: { name: string; status: string }[] }>(
      await gateway.client.call("demo/build", { source: { path: dir } }, 240_000),
    );
    expect(again.demos).toEqual([expect.objectContaining({ name: "app", status: "cached" })]);
  }, 300_000);

  it("keeps a demo's three newest builds in the cache and removes the older ones", async () => {
    const dir = demoArtifact(
      "kept",
      `import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
mkdirSync("dist", { recursive: true });
writeFileSync("dist/index.html", "<!doctype html><p>" + readFileSync("round.txt", "utf8") + "</p>");
`,
    );
    const cache = join(gateway.home.home, "cache", "demos");
    const mine = (): { digest: string; round: string }[] =>
      readdirSync(cache)
        .filter((entry) => !entry.startsWith(".") && existsSync(join(cache, entry, "demo.json")))
        .map((entry) => ({
          digest: entry,
          marker: JSON.parse(readFileSync(join(cache, entry, "demo.json"), "utf8")) as {
            folder: string;
          },
          html: readFileSync(join(cache, entry, "out", "index.html"), "utf8"),
        }))
        .filter((one) => one.marker.folder === join(dir, "app"))
        .map((one) => ({ digest: one.digest, round: /<p>(.*)<\/p>/.exec(one.html)?.[1] ?? "" }));
    for (const round of ["1", "2", "3", "4"]) {
      writeFileSync(join(dir, "app", "round.txt"), round);
      const built = ok<{ demos: { name: string; status: string }[] }>(
        await gateway.client.call("demo/build", { source: { path: dir } }, 240_000),
      );
      expect(built.demos).toEqual([expect.objectContaining({ name: "app", status: "built" })]);
    }
    expect(
      mine()
        .map((one) => one.round)
        .sort(),
    ).toEqual(["2", "3", "4"]);
  }, 300_000);
});

describe("an export carries the page's front end and nothing of its server (D185 item 8)", () => {
  const gateway = new GatewayHome();
  let published: Receipt & { dir: string };
  const out = tempDir("exports", true);
  const SECRET_VALUE = "sk-export-test-9f1c2b7e4d";

  beforeAll(async () => {
    await gateway.start();
    published = await gateway.publish("actions");
    ok(
      await gateway.client.call("secret/set", {
        name: "MAIL_TOKEN",
        value: SECRET_VALUE,
        artifact: { artifactId: published.artifactId },
      }),
    );
    // A live value the page shows, frozen as it is now in the export.
    ok(
      await gateway.client.call("live/push", {
        artifact: { artifactId: published.artifactId },
        key: "inbox",
        value: { unread: 7 },
      }),
    );
    // Shared state another person wrote: the snapshot says so.
    ok(
      await gateway.client.call("state/patch", {
        artifact: { artifactId: published.artifactId },
        ops: [
          { id: "notes.team", value: "Ship Friday" },
          // Text that would end the page's own script element if the export wrote it raw.
          { id: "notes.markup", value: "</script><script>window.__hijacked = 1</script>" },
        ],
        mutationId: "mut_01J00000000000000000000001",
        as: "agent",
      }),
    );
  }, 300_000);

  afterAll(async () => {
    await gateway.stop();
  });

  const exportAs = async (
    as: "static" | "html" | "snapshot",
    name: string,
    extra: Record<string, unknown> = {},
  ): Promise<{ path: string; result: Record<string, unknown> }> => {
    const path = join(out, name);
    const result = ok<Record<string, unknown>>(
      await gateway.client.call(
        "artifact/export",
        { artifact: { artifactId: published.artifactId }, as, out: path, ...extra },
        240_000,
      ),
    );
    return { path, result };
  };

  it("static, html and snapshot hold no server code, no secret and no server environment", async () => {
    const server = readFileSync(join(published.dir, "actions.ts"), "utf8");
    // Lines only server code holds: a secret's name, an action's body.
    const serverOnly = ["MAIL_URL", 'secret("MAIL_TOKEN")', "Bearer ${"];
    for (const line of serverOnly) expect(server).toContain(line);
    for (const [as, name] of [
      ["static", "page"],
      ["html", "page.html"],
      ["snapshot", "snap"],
    ] as const) {
      const { path } = await exportAs(as, name);
      for (const file of textsUnder(path)) {
        expect(file.text, file.path).not.toContain(SECRET_VALUE);
        for (const line of serverOnly)
          expect(file.text, `${file.path}: ${line}`).not.toContain(line);
        expect(file.text, file.path).not.toContain('"use server"');
        expect(file.path, file.path).not.toMatch(/[\\/]server[\\/]/);
      }
    }
  }, 300_000);

  it("names what it loses, specifically, in its warning and its report; strict writes nothing", async () => {
    const { result } = await exportAs("static", "named");
    const warnings = (result["warnings"] ?? []) as Diagnostic[];
    const lost = warnings.find((one) => one.code === "MOSTRA_TARGET_SERVER_FEATURES");
    expect(lost?.message).toMatch(/\d+ actions? \(/);
    expect(lost?.message).toMatch(/live producers? \(/);
    expect(lost?.message).toContain("snapshot");
    expect(lost?.message).toContain("bundle");
    const report = result["report"] as {
      unavailable: { actions: string[]; live: string[]; submit: boolean };
    };
    expect(report.unavailable.actions.length).toBeGreaterThan(0);
    expect(report.unavailable.live).toContain("counter");

    const strict = refused(
      await gateway.client.call(
        "artifact/export",
        {
          artifact: { artifactId: published.artifactId },
          as: "static",
          out: join(out, "strict"),
          strict: true,
        },
        240_000,
      ),
    );
    expect(strict).toBe("MOSTRA_TARGET_EXPORT_STRICT");
    expect(existsSync(join(out, "strict"))).toBe(false);
  }, 300_000);

  it("a snapshot freezes the live value and the shared state, and leaves the state out when asked", async () => {
    const { path, result } = await exportAs("snapshot", "snapshot-state");
    const frozen = JSON.parse(readFileSync(join(path, "snapshot.json"), "utf8")) as {
      state?: Record<string, unknown>;
    };
    expect(frozen.state?.["notes.team"]).toBe("Ship Friday");
    const page = readFileSync(join(path, "index.html"), "utf8");
    expect(page).toContain('content="static"');
    expect(page).toContain("mostra-snapshot");
    // An answer's markup stays text inside the page's data: it never ends its script element.
    expect(frozen.state?.["notes.markup"]).toBe("</script><script>window.__hijacked = 1</script>");
    expect(page).not.toContain("<script>window.__hijacked");
    expect(page).toContain("\\u003c/script>\\u003cscript>window.__hijacked");
    const report = result["report"] as {
      snapshot: { answers: string; sharedState: { included: boolean }; live: string[] };
    };
    expect(report.snapshot.answers).toBe("viewer");
    expect(report.snapshot.sharedState.included).toBe(true);
    expect(report.snapshot.live).toContain("inbox");

    const without = await exportAs("snapshot", "snapshot-alone", { sharedState: false });
    const alone = JSON.parse(readFileSync(join(without.path, "snapshot.json"), "utf8")) as {
      state?: unknown;
    };
    expect(alone.state).toBeUndefined();
    expect(
      (without.result["report"] as { snapshot: { sharedState: { included: boolean } } }).snapshot
        .sharedState.included,
    ).toBe(false);
  }, 300_000);
});
