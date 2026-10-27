/**
 * `pnpm check --deadline` (tools/check/deadline.ts, #55): a run still going at its deadline lists
 * every process, keeps the supervisor logs its test homes still hold, and stops what it started.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  descendants,
  processListing,
  redactSecrets,
  searchRoots,
  supervisorLogDirs,
  testHomeProcesses,
} from "../check/deadline.ts";

const root = mkdtempSync(join(tmpdir(), "mostra-deadline-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("pnpm check --deadline (#55)", () => {
  it("stops every process below the run, and only those", () => {
    const table: [number, number][] = [
      [1, 0],
      [100, 1], // pnpm check
      [200, 100], // turbo
      [300, 200], // vitest
      [301, 300], // a fork
      [400, 301], // a supervisor the fork started
      [500, 1], // someone else's
      [501, 500],
      [600, 600], // a process that names itself as its parent
    ];
    expect(descendants(table, 100).sort((a, b) => a - b)).toEqual([200, 300, 301, 400]);
    expect(descendants(table, 999)).toEqual([]);
    // A cycle in a table read while processes come and go ends the walk.
    expect(
      descendants(
        [
          [2, 3],
          [3, 2],
        ],
        2,
      ),
    ).toEqual([3]);
  });

  it("finds the logs a test home still holds, and nothing else", () => {
    const home = join(root, "mrt-AbCdEf", "home", "logs");
    mkdirSync(home, { recursive: true });
    writeFileSync(join(home, "supervisor.log"), "{}\n");
    const nested = join(root, "mostra-e2e-x", "run", "a", "home", "logs");
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(nested, "supervisor.log"), "{}\n");
    // A `logs` directory without a supervisor's log, and one past the depth.
    mkdirSync(join(root, "other", "logs"), { recursive: true });
    const deep = join(root, "a", "b", "c", "d", "e", "logs");
    mkdirSync(deep, { recursive: true });
    writeFileSync(join(deep, "supervisor.log"), "{}\n");
    mkdirSync(join(root, "pkg", "node_modules", "x", "logs"), { recursive: true });
    writeFileSync(join(root, "pkg", "node_modules", "x", "logs", "supervisor.log"), "{}\n");
    expect(supervisorLogDirs(root).sort()).toEqual([home, nested].sort());
  });

  it("looks where the test homes are: /tmp on POSIX as well as the temporary directory (GPT review of MT-02)", () => {
    const roots = searchRoots("darwin", root);
    expect(roots).toContain(realpathSync.native(root));
    expect(roots).toContain(realpathSync.native("/tmp"));
    // Each real directory once, however it is named.
    expect(searchRoots("linux", "/tmp")).toEqual([realpathSync.native("/tmp")]);
    expect(searchRoots("win32", root)).toEqual([realpathSync.native(root)]);
  });

  it("never writes a secret a command line carries (the Opus review of MT-02)", () => {
    const listing = "4242 mostra-win-probe.exe squat mostraother Pa55-w0rd!x C:\\pipe\n4243 node x";
    const text = redactSecrets(listing, {
      MOSTRA_TEST_OTHER_PASSWORD: "Pa55-w0rd!x",
      GH_TOKEN: "ghs_abcdef",
      PATH: "/usr/bin",
      SHORT_KEY: "abc",
    });
    expect(text).not.toContain("Pa55-w0rd!x");
    expect(text).toContain("squat mostraother [redacted] C:\\pipe");
    expect(redactSecrets("PATH=/usr/bin", { PATH: "/usr/bin" })).toBe("PATH=/usr/bin");
    // Too short to redact without hiding everything else.
    expect(redactSecrets("abc", { SHORT_KEY: "abc" })).toBe("abc");
  });

  it("finds a test's detached daemon by the home it names, never this run or its shell (the Opus review of MT-02)", () => {
    const posix = [
      "    1     0 /sbin/launchd",
      "   90     1 bash -c run the deadline for /tmp/mrt-AbC123/home",
      "  100    90 node tools/check/cli.ts --deadline 10",
      "  101   100 node /repo/node_modules/vitest/vitest.mjs run",
      "  202     1 node /repo/packages/runtime/dist/bin.js daemon --home /tmp/mrt-AbC123/home",
      "  303     1 node bin.js daemon --home /var/folders/x/T/mostra-e2e-Zz9/home",
      "  404     1 node bin.js daemon --home /home/me/.mostra",
    ].join("\n");
    // The shell (90) names a test home too, but it started this run (100).
    expect(testHomeProcesses(posix, ["/tmp", "/var/folders/x/T"], false, 100)).toEqual([202, 303]);
    const windows = [
      "11 4 C:\\a\\node.exe bin.js daemon --home C:\\Users\\RUNNER~1\\AppData\\Local\\Temp\\MRT-q1w2e3\\home",
      "12 4 C:\\a\\node.exe other.js",
    ].join("\n");
    expect(
      testHomeProcesses(windows, ["C:\\Users\\RUNNER~1\\AppData\\Local\\Temp"], true, 99),
    ).toEqual([11]);
  });

  it("lists processes with what a hang shows on every system", () => {
    expect(processListing("linux").args.join(" ")).toContain("wchan");
    expect(processListing("linux").args).toContain("--forest");
    expect(processListing("darwin").args.join(" ")).toContain("wchan");
    expect(processListing("win32").command).toBe("powershell.exe");
  });
});
