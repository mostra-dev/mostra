import { describe, expect, it } from "vitest";
import { treeOf } from "../../src/harness/tree.ts";

/** A process list as `mostra-win processes` prints it. */
const at = (pid: number, ppid: number, created: number | undefined) => ({
  pid,
  ppid,
  ...(created === undefined ? {} : { startTime: `win/${created}` }),
});

describe("a shim's process tree on Windows (Opus review of WP-W3, finding 3)", () => {
  it("holds the shell and every descendant, however deep", () => {
    const tree = treeOf(
      [at(4, 0, 1), at(100, 4, 10), at(200, 100, 20), at(300, 200, 30), at(400, 4, 40)],
      100,
    );
    expect(tree.map((member) => member.pid)).toEqual([100, 200, 300]);
    expect(tree[2]).toEqual({ pid: 300, startTime: "win/30" });
  });

  it("leaves out a process that names a reused parent PID but is older than it", () => {
    // 250 was started before 100 by another 100 that has exited: not a descendant.
    const tree = treeOf([at(100, 4, 10), at(250, 100, 5), at(260, 100, 12)], 100);
    expect(tree.map((member) => member.pid)).toEqual([100, 260]);
  });

  it("leaves out what it can't end safely: no creation time, or no shell", () => {
    expect(treeOf([at(100, 4, 10), at(200, 100, undefined)], 100)).toEqual([
      { pid: 100, startTime: "win/10" },
    ]);
    expect(treeOf([at(200, 100, 20)], 100)).toEqual([]);
  });

  it("survives a cycle in the parent links", () => {
    const tree = treeOf([at(100, 200, 10), at(200, 100, 20)], 100);
    expect(tree.map((member) => member.pid)).toEqual([100, 200]);
  });
});
