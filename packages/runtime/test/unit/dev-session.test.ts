/**
 * A `mostra dev` session whose connection closes while it starts (VR-08, #35), with the dev
 * server and the packages stood in: the start owns the cleanup, so the session's directory is
 * removed only once the dev server it was starting stopped, and a cleanup that fails is the
 * start's failure, never an unhandled rejection that ends the instance.
 *
 * Before #35's fix, a close removed the directory at once, under a dev server still writing into
 * it; the removal then failed on the files it wrote (`ENOTEMPTY`), and that failure, unhandled,
 * took the whole instance down ("uncaught exception" in the suite's supervisor log).
 */
import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { DevChild, DevRequest, RenderMode } from "../../src/builder/index.ts";
import type { Dependencies } from "../../src/deps/index.ts";
import { createDev, type Dev, devRoot } from "../../src/dev/index.ts";
import { Gate } from "../../src/gate.ts";
import { silentLog } from "../../src/log.ts";
import { WINDOWS } from "../../src/platform/index.ts";
import type { Session } from "../../src/protocol-server/index.ts";
import type { Registry } from "../../src/registry/index.ts";
import { writeDevFixture } from "../dev-fixture.ts";
import { tempDir } from "../support.ts";

interface Fixture {
  readonly home: string;
  readonly source: string;
  readonly dev: Dev;
  /** Resolves the dev server's start; `requested` resolves once it was asked to start. */
  readonly server: {
    readonly requested: Promise<DevRequest>;
    finish(): void;
    /** Whether the session's directory was still there when the dev server finished starting. */
    rootWhenStarted?: boolean;
    stoppedAt?: number;
  };
}

function fixture(): Fixture {
  const home = tempDir("dev-session");
  const source = join(tempDir("dev-session-source"), "preview");
  writeDevFixture(source);
  let requested!: (request: DevRequest) => void;
  let finish!: () => void;
  const finished = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const server: Fixture["server"] = {
    requested: new Promise((resolve) => {
      requested = resolve;
    }),
    finish: () => finish(),
  };
  const renderMode = {
    async dev(request: DevRequest): Promise<DevChild> {
      requested(request);
      // A dev server writes into the session's root while it starts (its staging files, its
      // node_modules link, Vite's cache), as the real one does.
      mkdirSync(join(request.root, ".vite"), { recursive: true });
      writeFileSync(join(request.root, ".vite", "deps.json"), "{}");
      await finished;
      server.rootWhenStarted = existsSync(join(request.root, "source"));
      return {
        ready: { port: 1, build: { ok: false, diagnostics: [] } },
        reload: async () => {},
        changed: async () => {},
        exited: new Promise(() => {}),
        stop: async () => {
          server.stoppedAt = Date.now();
        },
      };
    },
  } as unknown as RenderMode;
  const dev = createDev({
    home,
    log: silentLog,
    registry: { artifactAt: () => undefined, sourceOf: () => undefined } as unknown as Registry,
    renderMode: () => renderMode,
    dependencies: () =>
      ({
        resolve: async () => ({ lock: "lockfileVersion: '9.0'\n", nodeModules: join(home, "nm") }),
      }) as unknown as Dependencies,
    gate: new Gate(),
    sandbox: () => {
      throw new Error("A session abandoned while it starts never reaches its sandbox.");
    },
    bindAddress: "127.0.0.1",
    notify: () => true,
  });
  fixtures.push({ home });
  return { home, source, dev, server };
}

const fixtures: { home: string }[] = [];
afterEach(() => {
  // A test that made the sessions' directory read-only gives it back, so its home can go.
  for (const { home } of fixtures.splice(0)) {
    if (existsSync(devRoot(home)) && !WINDOWS) chmodSync(devRoot(home), 0o700);
  }
});

function connection(): { session: Session; close(): void } {
  const controller = new AbortController();
  return {
    session: { id: 7, signal: controller.signal } as unknown as Session,
    close: () => controller.abort(),
  };
}

/** Starts a session through `dev/start`'s handler, as the protocol server calls it. */
function start(made: Fixture, session: Session): Promise<unknown> {
  const method = made.dev.methods().find((handler) => handler.definition.method === "dev/start");
  if (!method) throw new Error("dev/start isn't served.");
  return Promise.resolve(method.handle({ source: { path: made.source } }, session));
}

describe("a dev session whose connection closes while it starts (VR-08, #35)", () => {
  it("removes the session's directory only after the dev server it was starting stopped", async () => {
    const made = fixture();
    const owner = connection();
    const started = start(made, owner.session);
    const request = await made.server.requested;
    const sessionDir = join(request.root, "..");
    owner.close();
    // Time for a close to act on its own: before #35's fix it removed the directory here, under
    // the dev server still starting in it.
    await new Promise((done) => setTimeout(done, 300));
    expect(existsSync(join(sessionDir, "root", "source"))).toBe(true);
    made.server.finish();
    await expect(started).rejects.toMatchObject({
      diagnostic: { code: "MOSTRA_HOST_CONNECTION_CLOSED" },
    });
    expect(made.server.rootWhenStarted).toBe(true);
    expect(made.server.stoppedAt).toBeTypeOf("number");
    expect(existsSync(sessionDir)).toBe(false);
    expect(made.dev.count()).toBe(0);
    expect(made.dev.locks()).toEqual([]);
  });

  it.skipIf(WINDOWS || process.getuid?.() === 0)(
    "reports a cleanup that fails as the start's failure, never as an unhandled rejection",
    async () => {
      const made = fixture();
      const unhandled: unknown[] = [];
      const onUnhandled = (reason: unknown): void => {
        unhandled.push(reason);
      };
      process.on("unhandledRejection", onUnhandled);
      try {
        const owner = connection();
        const started = start(made, owner.session);
        await made.server.requested;
        // Nothing in the sessions' directory can be removed now.
        chmodSync(devRoot(made.home), 0o500);
        owner.close();
        await new Promise((done) => setTimeout(done, 300));
        made.server.finish();
        await expect(started).rejects.toBeDefined();
        await new Promise((done) => setTimeout(done, 100));
        expect(unhandled).toEqual([]);
      } finally {
        process.off("unhandledRejection", onUnhandled);
      }
    },
  );
});
