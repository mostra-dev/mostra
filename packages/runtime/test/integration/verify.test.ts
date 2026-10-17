/**
 * `verify` through the real host protocol (WP-09: AX-02, AX-04, AX-05, AU-05, VR-09): a real
 * `mostra-runtime daemon` builds, type-checks and renders artifacts in its verify runner, and its
 * publish is gated by the verdict.
 */
import { cpSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { VerifyVerdict } from "@mostra/protocol";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  connectTo,
  type DaemonStatus,
  initializeParams,
  type LineClient,
  type Message,
  type RuntimeProcess,
  startDaemon,
  type TestHome,
  tempDir,
  verifiedHome,
} from "../support.ts";

const FIXTURES = fileURLToPath(new URL("../fixtures/artifacts/", import.meta.url));

let home: TestHome;
let daemon: RuntimeProcess & { status: DaemonStatus };
let client: LineClient;

const result = (message: Message): unknown => {
  if (message.error) throw new Error(`${message.error.data.code}: ${message.error.data.message}`);
  return message.result;
};

/** A copy of a fixture, so tests never write into the repository. */
function copy(fixture: string): string {
  const dir = join(tempDir(`verify-${fixture}`), fixture);
  cpSync(join(FIXTURES, fixture), dir, { recursive: true });
  return dir;
}

async function verify(path: string, extra: Record<string, unknown> = {}): Promise<VerifyVerdict> {
  const verdict = result(
    await client.call("artifact/verify", { source: { path }, ...extra }, 300_000),
  );
  return VerifyVerdict.parse(verdict);
}

beforeAll(async () => {
  home = verifiedHome();
  daemon = await startDaemon(home);
  client = await connectTo(daemon.status.socket as string);
  result(await client.call("mostra/initialize", initializeParams()));
});

afterAll(async () => {
  await client?.call("mostra/shutdown", {});
  await daemon?.exited;
});

/** The codes of a verdict's diagnostics at one severity. */
const codes = (verdict: VerifyVerdict, severity: "error" | "warning" | "hint"): string[] =>
  verdict.diagnostics.filter((d) => d.severity === severity).map((d) => d.code);

describe("verify on WP-03's fixtures (AU-01, AU-02): correct code raises no error or warning", () => {
  it("passes a plain React page", async () => {
    const verdict = await verify(join(copy("single-tsx"), "page.tsx"));
    expect(codes(verdict, "error")).toEqual([]);
    expect(codes(verdict, "warning")).toEqual([]);
    expect(verdict.status).toBe("pass");
    expect(verdict.smoke.interactions).toBeGreaterThanOrEqual(3);
  }, 300_000);

  it("passes a single MDX page", async () => {
    const verdict = await verify(join(copy("single-mdx"), "page.mdx"));
    console.log(JSON.stringify(verdict.diagnostics, null, 2));
    expect(codes(verdict, "error")).toEqual([]);
    expect(codes(verdict, "warning")).toEqual([]);
    expect(verdict.status).toBe("pass");
  }, 300_000);

  it("passes a directory artifact with pages, components, data, assets, server code and live sources", async () => {
    const verdict = await verify(copy("directory"));
    console.log(JSON.stringify(verdict, null, 2));
    expect(codes(verdict, "error")).toEqual([]);
    expect(codes(verdict, "warning")).toEqual([]);
    expect(verdict.status).toBe("pass");
  }, 300_000);
});
