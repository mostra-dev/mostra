/**
 * D19 seam 4 (RS-01): the client runtime is ready for a later `rsc` render mode. Its entries carry
 * `"use client"`, so an RSC bundler puts them on the client side of the boundary; importing it
 * where there is no browser (a server render) assumes no environment and creates no singleton
 * that needs one; and the host bridge is reached only from a browser frame.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = (file: string): string =>
  readFileSync(fileURLToPath(new URL(`../src/${file}`, import.meta.url)), "utf8");

describe("D19 seam 4: a `use client` runtime (RS-01)", () => {
  it("marks every entry and module that renders or holds page state as client code", () => {
    for (const file of [
      "index.ts",
      "form.ts",
      "router.ts",
      "hooks.ts",
      "server-hooks.ts",
      "mount.ts",
      "storage.ts",
      "shell-bridge.ts",
      "server-reference.ts",
    ]) {
      expect(source(file).startsWith('"use client";'), file).toBe(true);
    }
    // The library build keeps the directive at the top of each entry it emits.
    expect(
      readFileSync(fileURLToPath(new URL("../tsdown.config.ts", import.meta.url)), "utf8"),
    ).toContain("MODULE_LEVEL_DIRECTIVE");
  });

  it("loads where there is no browser, touching nothing of one", async () => {
    expect(typeof globalThis.window).toBe("undefined");
    expect(typeof globalThis.document).toBe("undefined");
    const runtime = await import("@mostra/react");
    expect(typeof runtime.useField).toBe("function");
    expect(typeof runtime.useAction).toBe("function");
    expect(typeof runtime.useLive).toBe("function");
    // A server reference outside a page's runtime makes no request: it says where it can run.
    const reference = runtime.createServerReference("actions.ts#send");
    expect(reference.mostraServerFunctionId).toBe("actions.ts#send");
    await expect(reference()).rejects.toMatchObject({ code: "MOSTRA_TARGET_UNAVAILABLE" });
  });

  it("reaches the host bridge only from a browser frame", async () => {
    const { connectShell } = await import("@mostra/react");
    await expect(connectShell()).resolves.toBeUndefined();
  });
});
