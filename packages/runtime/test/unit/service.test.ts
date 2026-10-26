/**
 * The login service's definitions (RT-08, RT-11): the Windows task (D151), checked here on every
 * platform; the Windows suites register and run it for real.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { serviceFile, serviceFor, windowsArgument } from "../../src/service/unit.ts";

describe("the Windows login service's task (D151)", () => {
  const spec = {
    home: "C:\\Users\\Ada Lovelace\\AppData\\Local\\mostra",
    node: "C:\\Program Files\\Mostra\\node\\node.exe",
    entry: "C:\\Program Files\\Mostra\\lib\\node_modules\\@mostra\\runtime\\dist\\bin.js",
    platform: "win32",
    user: "S-1-5-21-1-2-3-1001",
    launcher: "C:\\Program Files\\Mostra\\bin\\mostra-win-service.exe",
    // The helper a checkout names and the time zone pass on; nothing else of the caller's does
    // (WP-W3 removed the development switch, which passed on before).
    env: {
      MOSTRA_DEV_WINDOWS: "1",
      MOSTRA_WIN_HELPER: "C:\\mostra\\target\\release\\mostra-win.exe",
      TZ: "Europe/Istanbul",
      SOME_SECRET: "hunter2",
      PATH: "C:\\x",
    },
  };

  it("quotes words as the Microsoft C runtime parses them", () => {
    expect(windowsArgument("plain")).toBe("plain");
    expect(windowsArgument("")).toBe('""');
    expect(windowsArgument("C:\\Program Files\\x")).toBe('"C:\\Program Files\\x"');
    expect(windowsArgument('say "hi"')).toBe('"say \\"hi\\""');
    // Backslashes before a quote, and at the end of a quoted word, are doubled.
    expect(windowsArgument('a\\"b c')).toBe('"a\\\\\\"b c"');
    expect(windowsArgument("C:\\dir with space\\")).toBe('"C:\\dir with space\\\\"');
  });

  it("runs the daemon always-on through the launcher, at the user's logon, without elevation or a time limit", () => {
    const status = serviceFor(spec);
    expect(status.manager).toBe("task-scheduler");
    expect(status.name).toMatch(/^mostra-[0-9a-z]{16}$/);
    expect(status.file).toBe(`${spec.home}\\service\\task.xml`);
    expect(status.command).toEqual([
      spec.launcher,
      "--stop-event",
      expect.stringMatching(/^Local\\mostra-service-[0-9a-z]{16}-[0-9a-f]{16}$/),
      "--log",
      `${spec.home}\\logs\\service.log`,
      "--env",
      "MOSTRA_WIN_HELPER=C:\\mostra\\target\\release\\mostra-win.exe",
      "--env",
      "TZ=Europe/Istanbul",
      "--",
      spec.node,
      spec.entry,
      "daemon",
      "--always-on",
      "--home",
      spec.home,
    ]);
    const text = serviceFile(spec, status);
    expect(text).toContain("<LogonTrigger>");
    expect(text.match(/<UserId>S-1-5-21-1-2-3-1001<\/UserId>/g)).toHaveLength(2);
    expect(text).toContain("<LogonType>InteractiveToken</LogonType>");
    expect(text).toContain("<RunLevel>LeastPrivilege</RunLevel>");
    expect(text).toContain("<ExecutionTimeLimit>PT0S</ExecutionTimeLimit>");
    expect(text).toContain("<MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>");
    expect(text).toContain(`<Command>${spec.launcher}</Command>`);
    // The arguments, quoted for the launcher's command line, then escaped for XML.
    expect(text).toContain(
      "--home &quot;C:\\Users\\Ada Lovelace\\AppData\\Local\\mostra&quot;</Arguments>",
    );
    expect(text).not.toMatch(/SECRET|hunter2|PASSWORD/i);
  });

  it("names its stop event with a random part, so nobody can create it first (Opus review of WP-W2, finding 6)", () => {
    const event = (status: ReturnType<typeof serviceFor>): string | undefined =>
      status.command[status.command.indexOf("--stop-event") + 1];
    expect(event(serviceFor(spec))).not.toBe(event(serviceFor(spec)));
  });

  it.runIf(process.platform === "win32")(
    "keeps the event its definition names, so an uninstall finds the launcher",
    () => {
      const home = mkdtempSync(join(tmpdir(), "mostra-task-"));
      try {
        const local = { ...spec, home };
        const first = serviceFor(local);
        mkdirSync(join(home, "service"), { recursive: true });
        writeFileSync(first.file, Buffer.from(`\ufeff${serviceFile(local, first)}`, "utf16le"));
        const again = serviceFor(local);
        expect(again.command).toEqual(first.command);
        expect(serviceFile(local, again)).toBe(serviceFile(local, first));
      } finally {
        rmSync(home, { recursive: true, force: true });
      }
    },
  );
});
