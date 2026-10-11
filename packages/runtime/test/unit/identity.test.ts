import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  bootId,
  isSameProcess,
  listProcesses,
  parseProcStat,
  parsePsLine,
  readProcess,
  sameBoot,
  startedNoEarlier,
} from "../../src/processes/identity.ts";

describe("start-time parsing", () => {
  it("reads pgrp and starttime after the last parenthesis of /proc/<pid>/stat", () => {
    // comm "(evil) 1 2 (x)" contains spaces and parentheses (man 5 proc_pid_stat).
    const fields = [
      "S",
      "1",
      "4242",
      "4242",
      "0",
      "-1",
      "4194560",
      "0",
      "0",
      "0",
      "0",
      "0",
      "0",
      "0",
      "0",
      "20",
      "0",
      "1",
      "0",
      "987654",
    ];
    const line = `4242 ((evil) 1 2 (x)) ${fields.join(" ")} 1000 2000`;
    expect(parseProcStat(line, "boot-a")).toEqual({
      pid: 4242,
      pgid: 4242,
      startTime: "boot-a/987654",
    });
    expect(parseProcStat("garbage", "boot-a")).toBeUndefined();
    expect(parseProcStat("12 (x) S 1", "boot-a")).toBeUndefined();
    expect(parseProcStat(`4242 (x) Z ${fields.slice(1).join(" ")}`, "boot-a")).toBeUndefined();
  });

  it("reads ps -o pid=,pgid=,stat=,lstart= lines in UTC and skips zombies", () => {
    expect(parsePsLine("  214 99444 Ss   Tue Oct  6 13:53:19 2026", "b")).toEqual({
      pid: 214,
      pgid: 99444,
      startTime: `b/${Date.UTC(2026, 9, 6, 13, 53, 19) / 1000}`,
    });
    expect(parsePsLine("214 1 S Xyz Oct 6 13:53:19 2026 extra", "b")?.pid).toBe(214);
    expect(parsePsLine("214 1 S Tue Foo 6 13:53:19 2026", "b")).toBeUndefined();
    expect(parsePsLine("214 1 Z Tue Oct 6 13:53:19 2026", "b")).toBeUndefined();
    expect(parsePsLine("", "b")).toBeUndefined();
  });

  it("compares start times only within one boot", () => {
    expect(sameBoot("a/1", "a/9")).toBe(true);
    expect(sameBoot("a/1", "b/1")).toBe(false);
    expect(startedNoEarlier("a/5", "a/5")).toBe(true);
    expect(startedNoEarlier("a/6", "a/5")).toBe(true);
    expect(startedNoEarlier("a/4", "a/5")).toBe(false);
    expect(startedNoEarlier("b/9", "a/5")).toBe(false);
    expect(startedNoEarlier("nonsense", "a/5")).toBe(false);
  });
});

describe("live process identity on this platform", () => {
  it("reads this process with its group and a start time in the current boot", async () => {
    const me = await readProcess(process.pid);
    expect(me?.pid).toBe(process.pid);
    expect(me?.startTime.startsWith(`${await bootId()}/`)).toBe(true);
    expect(await isSameProcess(process.pid, me?.startTime ?? "")).toBe(true);
    expect(await isSameProcess(process.pid, `${await bootId()}/1`)).toBe(false);
    expect((await listProcesses()).some((info) => info.pid === process.pid)).toBe(true);
  });

  it("sees a detached child as the leader of its own group, and nothing once it exits", async () => {
    const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)"], {
      detached: true,
      stdio: "ignore",
    });
    await new Promise((resolve) => child.once("spawn", resolve));
    const pid = child.pid ?? 0;
    const info = await readProcess(pid);
    expect(info).toMatchObject({ pid, pgid: pid });
    const exited = new Promise((resolve) => child.once("exit", resolve));
    child.kill("SIGKILL");
    await exited;
    expect(await readProcess(pid)).toBeUndefined();
  });
});
