/**
 * Secrets stay out of everything verify keeps or shows (D44, AC-06, D138 item 1): server code
 * reads the real secrets in a verify run, and an action, a thrown error and a live source hand one
 * to the page, yet the page only ever receives it redacted (so no screenshot can show it), and the
 * verdict, its ARIA snapshots and every file verify wrote hold none of it.
 * WP-08 left verify's output to repeat AC-06's grep (PROGRESS-WP-08, untested boundaries).
 */
import { type Dirent, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { ArtifactId } from "@mostra/protocol";
import { expect, it } from "vitest";
import {
  connectTo,
  initializeParams,
  type Message,
  startDaemon,
  tempDir,
  verifiedHome,
} from "../support.ts";

const SECRET = "sk-verify-4f9c2e7a1b8d3f60e5c4a9b2";

const result = (message: Message): unknown => {
  if (message.error) throw new Error(`${message.error.data.code}: ${message.error.data.message}`);
  return message.result;
};

/** Every file under `dir`, read as bytes (entries listed with their types: no stat, then read). */
function files(dir: string): { path: string; bytes: Buffer }[] {
  const found: { path: string; bytes: Buffer }[] = [];
  const walk = (current: string): void => {
    let entries: Dirent[];
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile()) found.push({ path, bytes: readFileSync(path) });
    }
  };
  walk(dir);
  return found;
}

it("keeps a secret server code read during verify out of the verdict and every file verify wrote", async () => {
  // What the page received, reported to a sink outside Mostra: the page's own view of the values.
  const seen: string[] = [];
  const sink = createServer((request, response) => {
    seen.push(new URL(request.url ?? "/", "http://sink").searchParams.get("v") ?? "");
    response.end();
  });
  await new Promise<void>((done) => sink.listen(0, "127.0.0.1", done));
  const sinkUrl = `http://127.0.0.1:${(sink.address() as AddressInfo).port}/seen`;
  const home = verifiedHome();
  const daemon = await startDaemon(home);
  const client = await connectTo(daemon.status.socket as string);
  try {
    result(await client.call("mostra/initialize", initializeParams()));
    result(await client.call("secret/set", { name: "API_KEY", value: SECRET }));
    const dir = join(tempDir("verify-secret"), "secret");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "index.tsx"),
      `import { useEffect, useState } from "react";
import { defineArtifact, useAction, useLive } from "@mostra/react";
import { fail, reveal } from "./actions";

export const artifact = defineArtifact({ id: "${ArtifactId.create()}", title: "Secret" });

export default function Page() {
  const revealing = useAction(reveal);
  const failing = useAction(fail);
  const key = useLive("key");
  const [shown, setShown] = useState("");
  const live = String(key.data ?? "");
  useEffect(() => {
    for (const value of [live, shown]) {
      if (value) void fetch(${JSON.stringify(sinkUrl)} + "?v=" + encodeURIComponent(value), { mode: "no-cors" }).catch(() => {});
    }
  }, [live, shown]);
  return (
    <main>
      <h1>Key</h1>
      <p>Live: {live}</p>
      <p>Shown: {shown}</p>
      <button type="button" onClick={() => { void revealing.run().then(setShown); }}>Reveal</button>
      <button type="button" onClick={() => { failing.run().catch((error: Error) => setShown(error.message)); }}>Fail</button>
    </main>
  );
}
`,
    );
    writeFileSync(
      join(dir, "actions.ts"),
      `"use server";
import { dryRun, secret } from "@mostra/server";

export async function reveal(): Promise<string> {
  if (dryRun()) console.log("revealing", secret("API_KEY"));
  return secret("API_KEY");
}

export async function fail(): Promise<string> {
  if (dryRun()) throw new Error(\`failed with \${secret("API_KEY")}\`);
  return "ok";
}
`,
    );
    writeFileSync(
      join(dir, "live.ts"),
      `import { defineLive, secret } from "@mostra/server";
export const key = defineLive({ load: async () => secret("API_KEY") });
`,
    );
    const message = await client.call("artifact/verify", { source: { path: dir } }, 300_000);
    const text = JSON.stringify(result(message));
    // The page received the values (as Mostra hands them out, redacted), and the run went through.
    expect(text).toContain('"interactions"');
    expect(text).not.toContain(SECRET);
    const written = [
      ...files(join(home.home, "cache", "verify")),
      ...files(join(home.home, "logs")),
    ];
    expect(written.length).toBeGreaterThan(0);
    expect(written.some((file) => file.path.endsWith(".aria.yml"))).toBe(true);
    const leaks = written.filter((file) => file.bytes.includes(Buffer.from(SECRET)));
    expect(leaks.map((file) => file.path)).toEqual([]);
    // What the page showed of the key reached the ARIA snapshot redacted, never as the value.
    const aria = written
      .filter((file) => file.path.endsWith(".aria.yml"))
      .map((file) => file.bytes.toString("utf8"))
      .join("\n");
    expect(aria).toContain("[redacted]");
    // The page itself got the action's result, its error and the live value, each redacted.
    expect(seen.length).toBeGreaterThanOrEqual(3);
    expect(seen.filter((value) => value.includes(SECRET))).toEqual([]);
    expect(seen.every((value) => value.includes("[redacted]"))).toBe(true);
  } finally {
    sink.close();
    await client.call("mostra/shutdown", {});
    await daemon.exited;
  }
}, 300_000);
