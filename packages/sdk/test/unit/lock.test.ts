/**
 * The install lock's takeover (src/bundle/cache.ts, D142 item 4, Opus review of WP-12, finding 10):
 * a stale lock is removed only if the file moved aside is the one judged, by identity and by
 * contents, so a fresh lock another installer took meanwhile is never removed (MT-02).
 */
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { judgeLock, removeJudged } from "../../src/bundle/cache.ts";
import { tempDir } from "../support.ts";

const dir = tempDir("msdk-lock");
afterAll(() => dir.cleanup());
let round = 0;

/** A PID no process has: one that just exited. */
function deadPid(): number {
  const ran = spawnSync(process.execPath, ["-e", "process.stdout.write(String(process.pid))"], {
    encoding: "utf8",
  });
  return Number(ran.stdout);
}

async function staleLock(): Promise<{
  path: string;
  judged: Exclude<Awaited<ReturnType<typeof judgeLock>>, string>;
}> {
  round += 1;
  const path = join(dir.path, `digest-${round}.lock`);
  writeFileSync(path, `${deadPid()} dead\n`);
  const judged = await judgeLock(path);
  if (typeof judged === "string") throw new Error(`a lock of a dead owner is ${judged}, not stale`);
  return { path, judged };
}

describe("the install lock's takeover (D142 item 4)", () => {
  it("never removes a fresh lock another installer took after the judgement", async () => {
    const { path, judged } = await staleLock();
    const first = await judgeLock(path);
    if (typeof first === "string") throw new Error("stale");
    await removeJudged(path, first);
    writeFileSync(path, `${process.pid} fresh\n`, { flag: "wx" });
    await removeJudged(path, judged);
    expect(readFileSync(path, "utf8")).toBe(`${process.pid} fresh\n`);
    expect(readdirSync(dir.path).filter((name) => name.includes(".stale-"))).toEqual([]);
  });

  it("never removes a fresh lock that got the stale one's file number (ext4 reuses it at once)", async () => {
    const { path, judged } = await staleLock();
    // The fresh lock in the judged file's own number: the same (dev, ino), other contents.
    writeFileSync(path, `${process.pid} fresh\n`);
    await removeJudged(path, judged);
    expect(readFileSync(path, "utf8")).toBe(`${process.pid} fresh\n`);
  });

  it("removes the lock it judged stale", async () => {
    const { path, judged } = await staleLock();
    await removeJudged(path, judged);
    expect(await judgeLock(path)).toBe("gone");
  });
});
