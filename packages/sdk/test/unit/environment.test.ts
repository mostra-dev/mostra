/**
 * The environment of the SDK's children (D153): on Windows a host's own environment keeps the
 * system's variables, without which Node.js aborts; elsewhere it is the host's, as it is.
 */
import { describe, expect, it } from "vitest";
import { childEnvironment } from "../../src/environment.ts";

const own = { SystemRoot: "C:\\Windows", ComSpec: "C:\\Windows\\system32\\cmd.exe", SECRET: "s" };

describe("a child's environment (D153)", () => {
  it("adds on Windows the system's variables a host's environment lacks, and nothing else", () => {
    const vars = childEnvironment({ PATH: "C:\\bin" }, { platform: "win32", own });
    expect(vars).toEqual({ PATH: "C:\\bin", SystemRoot: "C:\\Windows", ComSpec: own.ComSpec });
  });

  it("keeps the host's own value, whatever its case", () => {
    const vars = childEnvironment({ SYSTEMROOT: "D:\\Win" }, { platform: "win32", own });
    expect(vars["SYSTEMROOT"]).toBe("D:\\Win");
    expect(vars["SystemRoot"]).toBeUndefined();
  });

  it("is the host's environment as it is elsewhere", () => {
    expect(childEnvironment({ PATH: "/bin" }, { platform: "linux", own })).toEqual({
      PATH: "/bin",
    });
  });
});
