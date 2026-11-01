/**
 * The processes the CLI leaves running start in their file system's root, so every path variable
 * they read must reach them absolute (D151 item 3, Opus review of WP-W2 finding 3).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { detachedDirectory, detachedEnvironment, PATH_VARIABLES } from "../../src/detached.ts";

const PACKAGES = fileURLToPath(new URL("../../..", import.meta.url));

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(ts|mts|mjs)$/.test(name) && !name.endsWith(".d.ts") ? [path] : [];
  });
}

describe("what the CLI's detached processes get", () => {
  it("resolves every relative path variable against the command's directory", () => {
    const env = detachedEnvironment(
      {
        MOSTRA_RUNTIME_DIR: "run",
        MOSTRA_WIN_HELPER: join("target", "mostra-win.exe"),
        MOSTRA_HOME: resolve("/somewhere/home"),
        MOSTRA_TELEMETRY: "1",
        MOSTRA_CACHE_DIR: "",
      },
      resolve("/work/project"),
    );
    expect(env["MOSTRA_RUNTIME_DIR"]).toBe(resolve("/work/project/run"));
    expect(env["MOSTRA_WIN_HELPER"]).toBe(resolve("/work/project/target/mostra-win.exe"));
    expect(env["MOSTRA_HOME"]).toBe(resolve("/somewhere/home"));
    // Not paths, or unset: untouched.
    expect(env["MOSTRA_TELEMETRY"]).toBe("1");
    expect(env["MOSTRA_CACHE_DIR"]).toBe("");
    expect(detachedDirectory(resolve("/work/project"))).toBe(resolve("/"));
  });

  it("classifies every Mostra variable a process reads: a path, or not", () => {
    // Every variable read from an environment by the runtime, the worker, verify, the SDK or the
    // CLI is either a path (made absolute for a detached process) or named here as not one, so a
    // new variable can't reach a detached process unresolved unnoticed.
    const notPaths = [
      "MOSTRA_BUNDLE_MIRROR",
      "MOSTRA_OFFLINE",
      "MOSTRA_TELEMETRY",
      "MOSTRA_TELEMETRY_DEBUG",
      "MOSTRA_TELEMETRY_ENDPOINT",
      "MOSTRA_TEST_BROWSER_REVISION_NEXT",
      "MOSTRA_TEST_BUILD_TIMEOUT_MS",
      "MOSTRA_TEST_CLOCK_OFFSET_MS",
      "MOSTRA_TEST_FAULTS",
      "MOSTRA_TEST_FLUSH_INTERVAL_MS",
      "MOSTRA_TEST_GATE",
      "MOSTRA_TEST_IDLE_EXIT_MS",
      "MOSTRA_TEST_INSTALL_TIMEOUT_MS",
      "MOSTRA_TEST_INTEREST_LEASE_MS",
      "MOSTRA_TEST_LOCALTIME",
      "MOSTRA_TEST_LOCK_BREAK_MS",
      "MOSTRA_TEST_PORT_TIMEOUT_MS",
      "MOSTRA_TEST_REQUEST_LOG",
      "MOSTRA_TEST_SERVICE_QUERY_MS",
      "MOSTRA_TEST_SERVICE_STOP",
      "MOSTRA_TEST_SHARE_PROBE_MS",
      "MOSTRA_TEST_SHARE_SWEEP_MS",
      "MOSTRA_TEST_SMOKE_INTERACTIONS",
      "MOSTRA_TEST_UNVERIFIED_PUBLISH",
      "MOSTRA_TEST_VERIFY_IDLE_MS",
      "MOSTRA_TEST_VERIFY_TIMEOUT_MS",
      "MOSTRA_TEST_WORKER_BACKOFF_MS",
      "MOSTRA_TEST_WORKER_IDLE_MS",
    ];
    const read = new Set<string>();
    for (const pkg of ["runtime", "worker", "verify", "sdk", "cli"]) {
      for (const file of sources(join(PACKAGES, pkg, "src"))) {
        const text = readFileSync(file, "utf8");
        // Also a name kept in a constant (`FAULTS_VARIABLE = "MOSTRA_TEST_FAULTS"`).
        for (const match of text.matchAll(/_VARIABLE\s*=\s*"(MOSTRA_[A-Z_]+)"/g)) {
          read.add(match[1] as string);
        }
        for (const match of text.matchAll(
          /\b(?:env|environment)(?:\?\.)?(?:\["|\.)(MOSTRA_[A-Z_]+)/g,
        )) {
          read.add(match[1] as string);
        }
      }
    }
    expect(read.size).toBeGreaterThan(15);
    for (const name of read) {
      expect(PATH_VARIABLES.includes(name) || notPaths.includes(name), name).toBe(true);
    }
  });
});
