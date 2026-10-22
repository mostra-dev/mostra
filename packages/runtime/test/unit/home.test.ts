import { chmodSync, mkdirSync, realpathSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { RpcError } from "@mostra/protocol";
import { describe, expect, it } from "vitest";
import {
  checkPlatform,
  platformName,
  prepareOwnedDirectory,
  resolveHomePath,
  resolveRuntimeDir,
  socketPathFor,
  socketPathLimit,
} from "../../src/home/index.ts";
import { tempDir, WINDOWS } from "../support.ts";

const scratch = (): string => tempDir("mostra-paths");
const codeOf = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (error) {
    return error instanceof RpcError ? error.diagnostic.code : `not an RpcError: ${String(error)}`;
  }
  return undefined;
};

describe("home resolution (D84)", () => {
  const base = { userHome: "/Users/u", cwd: "/work" };

  it("prefers --home, then MOSTRA_HOME, then the platform default", () => {
    const env = { MOSTRA_HOME: "/env/home", XDG_DATA_HOME: "/xdg/data" };
    expect(resolveHomePath({ ...base, home: "/flag/home", env, platform: "linux" })).toBe(
      "/flag/home",
    );
    expect(resolveHomePath({ ...base, env, platform: "linux" })).toBe("/env/home");
    expect(
      resolveHomePath({ ...base, env: { XDG_DATA_HOME: "/xdg/data" }, platform: "linux" }),
    ).toBe("/xdg/data/mostra");
    expect(resolveHomePath({ ...base, env: {}, platform: "linux" })).toBe(
      "/Users/u/.local/share/mostra",
    );
    expect(resolveHomePath({ ...base, env: {}, platform: "darwin" })).toBe("/Users/u/.mostra");
  });

  it("resolves relative paths against the working directory and ignores empty or relative XDG values", () => {
    expect(resolveHomePath({ ...base, home: "h", env: {} })).toBe("/work/h");
    expect(
      resolveHomePath({ ...base, env: { MOSTRA_HOME: "" }, home: "", platform: "darwin" }),
    ).toBe("/Users/u/.mostra");
    expect(resolveHomePath({ ...base, env: { XDG_DATA_HOME: "rel" }, platform: "linux" })).toBe(
      "/Users/u/.local/share/mostra",
    );
  });
});

describe("runtime directory (D82)", () => {
  it("uses MOSTRA_RUNTIME_DIR first and ~/.mostra/run on macOS", () => {
    expect(resolveRuntimeDir({ env: { MOSTRA_RUNTIME_DIR: "/r" }, platform: "linux" })).toEqual({
      dir: "/r",
      source: "override",
    });
    expect(resolveRuntimeDir({ env: {}, platform: "darwin", userHome: "/Users/u" })?.dir).toBe(
      "/Users/u/.mostra/run",
    );
  });

  it("on Linux accepts $XDG_RUNTIME_DIR only when it is owned by the user and 0700", () => {
    const root = scratch();
    const good = join(root, "good");
    mkdirSync(good, { mode: 0o700 });
    chmodSync(good, 0o700);
    expect(resolveRuntimeDir({ env: { XDG_RUNTIME_DIR: good }, platform: "linux" })).toEqual({
      dir: join(good, "mostra"),
      source: "xdg",
    });

    const open = join(root, "open");
    mkdirSync(open);
    chmodSync(open, 0o755);
    const state = join(root, "state");
    const fallback = resolveRuntimeDir({
      env: { XDG_RUNTIME_DIR: open, XDG_STATE_HOME: state },
      platform: "linux",
    });
    expect(fallback).toEqual({
      dir: join(state, "mostra", "run"),
      source: "fallback",
      rejected: "other users can access it",
    });
    expect(
      resolveRuntimeDir({
        env: { XDG_RUNTIME_DIR: join(root, "missing") },
        platform: "linux",
        userHome: "/h",
      }),
    ).toEqual({
      dir: "/h/.local/state/mostra/run",
      source: "fallback",
      rejected: "it doesn't exist",
    });
    expect(
      resolveRuntimeDir({ env: { XDG_RUNTIME_DIR: "/" }, platform: "linux", userHome: "/h" })
        ?.rejected,
    ).toBe(process.getuid?.() === 0 ? "other users can access it" : "another user owns it");
    expect(resolveRuntimeDir({ env: {}, platform: "linux", userHome: "/h" })).toEqual({
      dir: "/h/.local/state/mostra/run",
      source: "fallback",
    });
  });
});

describe("socket path (D82)", () => {
  it("is 16 Crockford base32 characters of the home's real path, the same through a symlink", () => {
    const root = scratch();
    const home = join(root, "home");
    mkdirSync(home);
    symlinkSync(home, join(root, "link"));
    const direct = socketPathFor("/tmp/r", realpathSync(home), "linux");
    const viaLink = socketPathFor("/tmp/r", realpathSync(join(root, "link")), "linux");
    expect(direct).toBe(viaLink);
    expect(direct).toMatch(/^\/tmp\/r\/[0-9A-HJKMNP-TV-Z]{16}\.sock$/);
    expect(socketPathFor("/tmp/r", "/other/home", "linux")).not.toBe(direct);
  });

  it("fails closed with MOSTRA_HOME_SOCKET_TOO_LONG over the OS limit, naming MOSTRA_RUNTIME_DIR", () => {
    expect(socketPathLimit("darwin")).toBe(103);
    expect(socketPathLimit("linux")).toBe(107);
    // "/" + dir + "/" + 16 + ".sock" = dir length + 23 bytes.
    const fits = `/${"a".repeat(103 - 23)}`;
    expect(Buffer.byteLength(socketPathFor(fits, "/h", "darwin"))).toBe(103);
    const long = `/${"a".repeat(104 - 23)}`;
    let error: unknown;
    try {
      socketPathFor(long, "/h", "darwin");
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(RpcError);
    expect((error as RpcError).diagnostic.code).toBe("MOSTRA_HOME_SOCKET_TOO_LONG");
    expect((error as RpcError).diagnostic.hint).toContain("MOSTRA_RUNTIME_DIR");
    expect(Buffer.byteLength(socketPathFor(long, "/h", "linux"))).toBe(104);
  });
});

describe.skipIf(WINDOWS)("owned directories (D85)", () => {
  it("creates missing directories with mode 0700", () => {
    const path = join(scratch(), "a", "b");
    const prepared = prepareOwnedDirectory(path);
    expect(prepared).toMatchObject({ created: true, realPath: path });
    expect(statSync(path).mode & 0o777).toBe(0o700);
  });

  it("tightens a directory the user owns and reports the old mode", () => {
    const path = join(scratch(), "loose");
    mkdirSync(path);
    chmodSync(path, 0o755);
    expect(prepareOwnedDirectory(path)).toMatchObject({ created: false, tightenedFrom: "755" });
    expect(statSync(path).mode & 0o777).toBe(0o700);
  });

  it("refuses a directory owned by another user, and a path that isn't a directory, changing nothing", () => {
    if (process.getuid?.() !== 0) {
      const before = statSync("/").mode;
      expect(codeOf(() => prepareOwnedDirectory("/"))).toBe("MOSTRA_HOME_NOT_OWNED");
      expect(statSync("/").mode).toBe(before);
    }
    const file = join(scratch(), "file");
    writeFileSync(file, "x");
    expect(codeOf(() => prepareOwnedDirectory(file))).toBe("MOSTRA_HOME_NOT_OWNED");
    expect(codeOf(() => prepareOwnedDirectory(join(file, "below")))).toBe("MOSTRA_HOME_NOT_OWNED");
  });
});

describe("platform gate (D35, RT-07)", () => {
  it("accepts macOS and Linux on x64 and arm64", () => {
    for (const os of ["darwin", "linux"]) {
      for (const arch of ["x64", "arm64"]) expect(checkPlatform(os, arch)).toBeUndefined();
    }
    expect(platformName("linux", "arm64")).toBe("linux-arm64");
  });

  it("refuses Windows and every other platform with MOSTRA_PLATFORM_UNSUPPORTED", () => {
    for (const [os, arch] of [
      ["win32", "x64"],
      ["win32", "arm64"],
      ["freebsd", "x64"],
      ["linux", "ia32"],
      ["darwin", "ppc64"],
    ] as const) {
      const diagnostic = checkPlatform(os, arch, {});
      expect(diagnostic?.code).toBe("MOSTRA_PLATFORM_UNSUPPORTED");
      expect(diagnostic?.phase).toBe("platform");
      expect(diagnostic?.message).toContain(`${os}-${arch}`);
    }
    expect(checkPlatform("win32", "x64", {})?.message).toContain("Windows");
  });

  it("admits Windows on x64 and arm64 only behind MOSTRA_DEV_WINDOWS=1 (D146)", () => {
    const on = { MOSTRA_DEV_WINDOWS: "1" };
    for (const arch of ["x64", "arm64"]) expect(checkPlatform("win32", arch, on)).toBeUndefined();
    for (const value of ["", "0", "true", "yes"]) {
      expect(checkPlatform("win32", "x64", { MOSTRA_DEV_WINDOWS: value })?.code).toBe(
        "MOSTRA_PLATFORM_UNSUPPORTED",
      );
    }
    // The switch admits Windows alone: every other platform still fails closed.
    for (const [os, arch] of [
      ["win32", "ia32"],
      ["freebsd", "x64"],
      ["linux", "ia32"],
    ] as const) {
      expect(checkPlatform(os, arch, on)?.code).toBe("MOSTRA_PLATFORM_UNSUPPORTED");
    }
  });
});

describe("Windows defaults (RT-10)", () => {
  it("puts the home under %LOCALAPPDATA% and the control pipe in no directory", () => {
    const env = { LOCALAPPDATA: "C:\\Users\\u\\AppData\\Local" };
    expect(resolveHomePath({ env, platform: "win32", userHome: "C:\\Users\\u" })).toBe(
      "C:\\Users\\u\\AppData\\Local\\mostra",
    );
    expect(resolveHomePath({ env: {}, platform: "win32", userHome: "C:\\Users\\u" })).toBe(
      "C:\\Users\\u\\AppData\\Local\\mostra",
    );
    // A relative LOCALAPPDATA is ignored, as a relative XDG value is.
    expect(
      resolveHomePath({
        env: { LOCALAPPDATA: "rel" },
        platform: "win32",
        userHome: "C:\\Users\\u",
      }),
    ).toBe("C:\\Users\\u\\AppData\\Local\\mostra");
    expect(
      resolveRuntimeDir({
        env: { MOSTRA_RUNTIME_DIR: "/r" },
        platform: "win32",
        userHome: "C:\\u",
      }),
    ).toBeUndefined();
    expect(socketPathFor(undefined, "C:\\h", "win32")).toMatch(
      /^\\\\\.\\pipe\\mostra-[0-9A-HJKMNP-TV-Z]{16}$/,
    );
  });
});

describe.runIf(WINDOWS)("owned directories on Windows (D85, RT-10)", () => {
  it("creates a missing directory owner-only, keeps it, and tightens a wider one it owns", () => {
    const path = join(scratch(), "a", "b");
    expect(prepareOwnedDirectory(path)).toMatchObject({ created: true });
    expect(prepareOwnedDirectory(path)).toEqual({
      created: false,
      realPath: realpathSync.native(path),
    });
    const loose = join(scratch(), "loose");
    mkdirSync(loose);
    const tightened = prepareOwnedDirectory(loose);
    expect(tightened.created).toBe(false);
    // The temporary directory's inherited entries were what it allowed before.
    expect(tightened.tightenedFrom).toMatch(/^O:.*D:/);
    expect(prepareOwnedDirectory(loose).tightenedFrom).toBeUndefined();
  });

  it("refuses a path that isn't a directory, changing nothing", () => {
    const file = join(scratch(), "file");
    writeFileSync(file, "x");
    expect(codeOf(() => prepareOwnedDirectory(file))).toBe("MOSTRA_HOME_NOT_OWNED");
  });
});
