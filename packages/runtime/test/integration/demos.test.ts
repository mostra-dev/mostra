/**
 * Demos built from their source and the page's exports (TM-08, VR-07; D185) through a real daemon.
 * A demo whose build fails, writes nothing where it said, or loads its files from outside its base
 * fails verify with the build's own words, and publish refuses it. An export of a page with
 * actions, live producers and a secret carries none of its server code, secret names or values,
 * names what it loses in its warning and report, and `strict` turns that into an error that writes
 * nothing; a snapshot's report says whose answers it holds and how many people the shared state
 * covers, and leaves the shared state out when asked.
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { MutationId } from "@mostra/protocol";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Browser, openLink } from "../browser-client.ts";
import { GatewayHome, ok, type Receipt, refused } from "../gateway-home.ts";
import { connectTo, initializeParams, tempDir } from "../support.ts";

/** The browser protocol's revision the suites speak. */
const REVISION = "2026-10-15";

interface Diagnostic {
  readonly code: string;
  readonly message: string;
}
interface Verdict {
  readonly status: "pass" | "fail";
  readonly diagnostics: readonly Diagnostic[];
}

/** An artifact whose one demo builds with `build` (a Node.js script given as its argument). */
function demoArtifact(
  name: string,
  script: string,
  output = "dist",
  build: readonly string[] = ["node", "build.mjs"],
): string {
  const dir = join(tempDir(`demos-${name}`), name);
  mkdirSync(join(dir, "app"), { recursive: true });
  writeFileSync(join(dir, "app", "build.mjs"), script);
  writeFileSync(
    join(dir, "index.tsx"),
    `import { defineArtifact } from "@mostra/react";
export const artifact = defineArtifact({
  title: "Demo ${name}",
  demos: { app: { source: "./app", build: ${JSON.stringify(build)}, output: ${JSON.stringify(output)} } },
});
export default function Page() {
  return <main><h1>Demo ${name}</h1></main>;
}
`,
  );
  return dir;
}

/** A build that writes its output from the files it reads: `<p>` holds each named file's text. */
function readingBuild(...files: string[]): string {
  return `import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
mkdirSync("dist", { recursive: true });
const text = ${JSON.stringify(files)}.map((file) => readFileSync(file, "utf8").trim()).join("|");
writeFileSync("dist/index.html", "<!doctype html><p>" + text + "</p>");
`;
}

type Built = { demos: { name: string; status: string; diagnostics: Diagnostic[] }[] };

/** Every file under `dir` (or `dir` itself, when it is one file), with its text. */
function textsUnder(dir: string): { path: string; text: string }[] {
  const found: { path: string; text: string }[] = [];
  const walk = (at: string): void => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      const path = join(at, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile()) found.push({ path, text: readFileSync(path, "latin1") });
    }
  };
  try {
    found.push({ path: dir, text: readFileSync(dir, "latin1") });
  } catch {
    walk(dir);
  }
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

  it("keeps a build a version just took over an older one never used since (review finding 2)", async () => {
    const dir = demoArtifact("used", readingBuild("round.txt"));
    const build = async (round: string): Promise<string | undefined> => {
      writeFileSync(join(dir, "app", "round.txt"), round);
      const built = ok<Built>(
        await gateway.client.call("demo/build", { source: { path: dir } }, 240_000),
      );
      return built.demos[0]?.status;
    };
    for (const round of ["1", "2", "3"]) expect(await build(round)).toBe("built");
    // Round 1 again: found in the cache and taken, as a publish copies it into its version.
    expect(await build("1")).toBe("cached");
    expect(await build("4")).toBe("built");
    // The build taken last is kept; the one nothing took since round 2 is the one removed.
    expect(await build("1")).toBe("cached");
    expect(await build("2")).toBe("built");
  }, 300_000);

  it("a source changed while its demo builds is never kept under the digest it had (review finding 3)", async () => {
    const dir = demoArtifact(
      "edited",
      `import { mkdirSync, writeFileSync } from "node:fs";
mkdirSync("dist", { recursive: true });
writeFileSync("dist/index.html", "<!doctype html><p>built</p>");
// An edit of the source that lands while the build runs.
writeFileSync("src.txt", String(Date.now()));
`,
    );
    const built = ok<Built>(
      await gateway.client.call("demo/build", { source: { path: dir } }, 240_000),
    );
    expect(built.demos[0]?.status).toBe("failed");
    expect(built.demos[0]?.diagnostics[0]?.message).toContain("changed while it was being built");
  }, 300_000);

  it("a file a demo reads through a link counts, and so does a .env its .gitignore names (review findings 4, 12)", async () => {
    const dir = demoArtifact("linked", readingBuild("shared/item.txt", ".env"));
    const shared = join(dir, "shared-outside");
    mkdirSync(shared, { recursive: true });
    writeFileSync(join(shared, "item.txt"), "walnut");
    // A junction on Windows, which needs no privilege; a symbolic link elsewhere.
    symlinkSync(shared, join(dir, "app", "shared"), "junction");
    writeFileSync(join(dir, "app", ".gitignore"), ".env\n");
    writeFileSync(join(dir, "app", ".env"), "VITE_TITLE=one");
    const status = async (): Promise<string | undefined> =>
      ok<Built>(await gateway.client.call("demo/build", { source: { path: dir } }, 240_000))
        .demos[0]?.status;
    expect(await status()).toBe("built");
    expect(await status()).toBe("cached");
    writeFileSync(join(shared, "item.txt"), "oak");
    expect(await status()).toBe("built");
    writeFileSync(join(dir, "app", ".env"), "VITE_TITLE=two");
    expect(await status()).toBe("built");
  }, 300_000);

  it("an output that is the source folder itself is refused, and nothing of the folder is kept (review finding 1)", async () => {
    for (const output of [".", "./"]) {
      const dir = demoArtifact(
        `whole${output.length}`,
        `import { writeFileSync } from "node:fs";
writeFileSync("index.html", "<!doctype html><p>the project</p>");
`,
        output,
      );
      writeFileSync(join(dir, "app", ".env"), "API_KEY=whole-folder-secret");
      const verdict = await verify(dir);
      expect(verdict.status).toBe("fail");
      expect(verdict.diagnostics.map((one) => one.code)).toContain("MOSTRA_MANIFEST_INVALID");
    }
  }, 300_000);

  it("a client that goes away ends the demo build it asked for, and frees its folder (review finding 10)", async () => {
    const dir = demoArtifact(
      "cancelled",
      `import { existsSync, mkdirSync, writeFileSync } from "node:fs";
if (existsSync("started.txt")) {
  mkdirSync("dist", { recursive: true });
  writeFileSync("dist/index.html", "<!doctype html><p>built</p>");
} else {
  writeFileSync("started.txt", String(process.pid));
  setTimeout(() => undefined, 600_000);
}
`,
    );
    // A client of its own, as `mostra demo build` is, which goes away (Ctrl-C) mid-build.
    const client = await connectTo(gateway.daemon.status.socket as string);
    ok(await client.call("mostra/initialize", initializeParams()));
    void client.call("demo/build", { source: { path: dir } }, 240_000).catch(() => undefined);
    const started = join(dir, "app", "started.txt");
    for (let waited = 0; !existsSync(started); waited += 100) {
      if (waited > 60_000) throw new Error("the build never started");
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const pid = Number(readFileSync(started, "utf8"));
    client.close();
    const alive = (): boolean => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    };
    for (let waited = 0; alive(); waited += 100) {
      if (waited > 20_000) throw new Error(`the build ${pid} still runs after its client left`);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    // The folder is free again: the next build runs at once.
    const again = ok<Built>(
      await gateway.client.call("demo/build", { source: { path: dir } }, 60_000),
    );
    expect(again.demos[0]?.status).toBe("built");
  }, 300_000);

  it("an export names --base to its page only when its demos were built for it (review finding 7)", async () => {
    const dir = demoArtifact(
      "based",
      `import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
const base = process.env.MOSTRA_DEMO_BASE;
mkdirSync("dist", { recursive: true });
writeFileSync("dist/app.js", "document.title = " + JSON.stringify(readFileSync("round.txt", "utf8")) + ";");
writeFileSync("dist/index.html", '<!doctype html><script src="' + base + 'app.js"></script>');
`,
    );
    writeFileSync(join(dir, "app", "round.txt"), "1");
    const receipt = ok<Receipt>(
      await gateway.client.call("artifact/publish", { source: { path: dir } }, 240_000),
    );
    const out = tempDir("based-exports", true);
    const facts = (path: string): { base?: string } =>
      JSON.parse(
        /<script type="application\/json" id="mostra-export">(.*?)<\/script>/s.exec(
          readFileSync(join(path, "index.html"), "utf8"),
        )?.[1] ?? "{}",
      ) as { base?: string };
    const exported = async (name: string) =>
      ok<{ warnings?: Diagnostic[] }>(
        await gateway.client.call(
          "artifact/export",
          {
            artifact: { artifactId: receipt.artifactId },
            as: "static",
            out: join(out, name),
            base: "/sub/",
          },
          240_000,
        ),
      );
    // Its source as published: built again for /sub/, and the page is told so.
    const rebuilt = await exported("rebuilt");
    expect((rebuilt.warnings ?? []).map((one) => one.code)).not.toContain(
      "MOSTRA_DEMO_NOT_REBUILT",
    );
    expect(facts(join(out, "rebuilt")).base).toBe("/sub/");
    expect(
      readFileSync(join(out, "rebuilt", "_mostra", "demos", "app", "index.html"), "utf8"),
    ).toContain("/sub/_mostra/demos/app/app.js");
    // Its source changed since: carried as built, for a host's root, and the page isn't told /sub/.
    writeFileSync(join(dir, "app", "round.txt"), "2");
    const carried = await exported("carried");
    expect((carried.warnings ?? []).map((one) => one.code)).toContain("MOSTRA_DEMO_NOT_REBUILT");
    expect(facts(join(out, "carried")).base).toBeUndefined();
  }, 300_000);

  it("gc waits for an export under way, which holds the instance's gate as a bundle's does (review finding 6)", async () => {
    const dir = demoArtifact(
      "gated",
      `import { mkdirSync, writeFileSync } from "node:fs";
const base = process.env.MOSTRA_DEMO_BASE;
mkdirSync("dist", { recursive: true });
writeFileSync("dist/index.html", '<!doctype html><p>' + base + '</p>');
// Rebuilt for an export's --base: slow, and says when it started, outside its own source.
if (base.startsWith("/sub/")) {
  writeFileSync("../export-started.txt", "yes");
  await new Promise((resolve) => setTimeout(resolve, 3000));
}
`,
    );
    const receipt = ok<Receipt>(
      await gateway.client.call("artifact/publish", { source: { path: dir } }, 240_000),
    );
    const order: string[] = [];
    const exporting = gateway.client
      .call(
        "artifact/export",
        {
          artifact: { artifactId: receipt.artifactId },
          as: "static",
          out: join(tempDir("gated-export", true), "page"),
          base: "/sub/",
        },
        240_000,
      )
      .then((answer) => {
        order.push("export");
        return answer;
      });
    for (let waited = 0; !existsSync(join(dir, "export-started.txt")); waited += 100) {
      if (waited > 60_000) throw new Error("the export's rebuild never started");
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const collecting = gateway.client.call("gc/run", { dryRun: true }, 240_000).then((answer) => {
      order.push("gc");
      return answer;
    });
    ok(await exporting);
    ok(await collecting);
    expect(order).toEqual(["export", "gc"]);
  }, 300_000);

  it.runIf(process.platform === "win32")(
    "a .cmd build the line names by its path from the demo's folder runs, its words whole (review finding 9)",
    async () => {
      const dir = demoArtifact(
        "cmd script",
        `import { mkdirSync, writeFileSync } from "node:fs";
mkdirSync("dist", { recursive: true });
writeFileSync("dist/index.html", "<!doctype html><p>" + JSON.stringify(process.argv.slice(2)) + "</p>");
`,
        "dist",
        ["tools\\make site.cmd", "a b", "x&y", 'say "hi"'],
      );
      mkdirSync(join(dir, "app", "tools"), { recursive: true });
      writeFileSync(join(dir, "app", "tools", "make site.cmd"), "@node build.mjs %*\r\n");
      const built = ok<Built>(
        await gateway.client.call("demo/build", { source: { path: dir } }, 240_000),
      );
      expect(built.demos[0]?.status, JSON.stringify(built.demos[0]?.diagnostics)).toBe("built");
      const receipt = ok<Receipt>(
        await gateway.client.call("artifact/publish", { source: { path: dir } }, 240_000),
      );
      const page = readFileSync(
        join(
          gateway.home.home,
          "versions",
          receipt.versionId,
          "client",
          "_mostra",
          "demos",
          "app",
          "index.html",
        ),
        "utf8",
      );
      expect(page).toContain(JSON.stringify(["a b", "x&y", 'say "hi"']));
    },
    300_000,
  );
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

  it("a submission's snapshot counts the people whose answers its own frozen state holds (review finding 5)", async () => {
    const artifactId = published.artifactId;
    // A colleague writes the shared state through a link of their own.
    const colleague = new Browser();
    const theirs = await openLink(
      colleague,
      (await gateway.link(artifactId, { viewer: { ref: "colleague", name: "Colleague" } })).url,
    );
    const wrote = await colleague.fetchJson(theirs.frameOrigin, `/_mostra/v/${REVISION}/fields`, {
      body: {
        mutationId: MutationId.create(),
        scope: "artifact",
        baseRevision: "0",
        viewId: theirs.viewId,
        ops: [{ id: "notes.colleague", value: "Their answer" }],
      },
      csrf: theirs.frameCsrf,
    });
    expect(wrote.status, wrote.body).toBe(200);
    // The home's own user answers and submits, freezing that state with their answer.
    const me = new Browser();
    const mine = await openLink(me, (await gateway.link(artifactId)).url);
    const answered = await me.fetchJson(mine.frameOrigin, `/_mostra/v/${REVISION}/fields`, {
      body: {
        mutationId: MutationId.create(),
        scope: "viewer",
        baseRevision: "0",
        viewId: mine.viewId,
        ops: [{ id: "mine", value: "yes" }],
      },
      csrf: mine.frameCsrf,
    });
    expect(answered.status, answered.body).toBe(200);
    const submitted = await me.fetchJson(
      mine.link.shell,
      `/a/${artifactId}/_mostra/v/${REVISION}/submit`,
      {
        body: {
          viewId: mine.viewId,
          expectedRevision: answered.json<{ revision: string }>().revision,
        },
        csrf: mine.shellCsrf,
      },
    );
    expect(submitted.status, submitted.body).toBe(200);
    const submission = submitted.json<{ id: string }>().id;
    // Their field is overwritten since: the state as it is now names only the agent.
    ok(
      await gateway.client.call("state/patch", {
        artifact: { artifactId },
        ops: [{ id: "notes.colleague", value: "Replaced" }],
        mutationId: MutationId.create(),
        as: "agent",
      }),
    );
    const { path, result } = await exportAs("snapshot", "submission-people", { submission });
    const frozen = JSON.parse(readFileSync(join(path, "snapshot.json"), "utf8")) as {
      state?: Record<string, unknown>;
    };
    expect(frozen.state?.["notes.colleague"]).toBe("Their answer");
    const report = result["report"] as { snapshot: { sharedState: { people: number } } };
    expect(report.snapshot.sharedState.people).toBe(1);
    expect(((result["warnings"] ?? []) as Diagnostic[]).map((one) => one.code)).toContain(
      "MOSTRA_TARGET_SHARED_STATE",
    );
    const strict = refused(
      await gateway.client.call(
        "artifact/export",
        {
          artifact: { artifactId },
          as: "snapshot",
          out: join(out, "submission-strict"),
          submission,
          strict: true,
        },
        240_000,
      ),
    );
    expect(strict).toBe("MOSTRA_TARGET_EXPORT_STRICT");
  }, 300_000);
});
