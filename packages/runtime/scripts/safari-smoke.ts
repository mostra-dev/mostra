/**
 * The real-Safari smoke run (WP-05 acceptance, SH-03): external evidence, run by hand on macOS
 * with `node packages/runtime/scripts/safari-smoke.ts` after building the runtime and the shell.
 *
 * It starts a daemon on a fresh home, publishes a probe artifact and opens its capability link in
 * Safari (`open -a Safari`). Safari can't be scripted without changing its settings, so the probe
 * reports from inside the page instead: it requests `/_mostra-probe/<fact>` paths on its own
 * origin, which the gateway answers 404 and logs with their path. A 404 (not a 401) proves the
 * request carried a valid frame session, so each line is a fact Safari established:
 *
 * - `frame-ran`: the frame's page and scripts loaded through the cookie-mode session;
 * - `cookie-hidden`: scripts can't read the HttpOnly session cookie;
 * - `bridge-ready`: the bridge handshake with the shell (`ui/initialize`) completed;
 * - `parent-blocked`: the frame can't read the shell's document;
 * - the same four with `reload-`, after the frame reloaded itself on its persisted session.
 */
import { spawn, spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { createConnection } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const BIN = join(dirname(fileURLToPath(import.meta.url)), "..", "dist", "bin.js");
const FACTS = ["frame-ran", "cookie-hidden", "bridge-ready", "parent-blocked"];
const EXPECTED = [...FACTS, ...FACTS.map((fact) => `reload-${fact}`)];

const PROBE = `import { connectShell } from "@mostra/react";
import { useEffect, useState } from "react";

const probe = (fact: string) => fetch(\`/_mostra-probe/\${fact}\`).catch(() => undefined);

export default function Page() {
  const [state, setState] = useState("probing");
  useEffect(() => {
    void (async () => {
      const again = sessionStorage.getItem("mostra-smoke") === "1";
      const tag = again ? "reload-" : "";
      await probe(\`\${tag}frame-ran\`);
      await probe(\`\${tag}cookie-\${document.cookie === "" ? "hidden" : "visible"}\`);
      const shell = await connectShell();
      await probe(\`\${tag}bridge-\${shell ? "ready" : "missing"}\`);
      let parent = "blocked";
      try {
        void window.parent.document.title;
        parent = "readable";
      } catch {}
      await probe(\`\${tag}parent-\${parent}\`);
      setState(again ? "done" : "reloading");
      if (!again) {
        sessionStorage.setItem("mostra-smoke", "1");
        location.reload();
      }
    })();
  }, []);
  return <h1>Mostra Safari smoke: {state}</h1>;
}
`;

const root = realpathSync(mkdtempSync("/tmp/mostra-safari-"));
const home = join(root, "home");
const source = join(root, "probe");
mkdirSync(source);
writeFileSync(join(source, "index.tsx"), PROBE);

const daemon = spawn(process.execPath, [BIN, "daemon", "--home", home], {
  env: { ...process.env, MOSTRA_RUNTIME_DIR: join(root, "run") },
  stdio: ["ignore", "pipe", "inherit"],
});
const status = JSON.parse(
  await new Promise<string>((resolve) => {
    let out = "";
    daemon.stdout?.setEncoding("utf8");
    daemon.stdout?.on("data", (chunk: string) => {
      out += chunk;
      if (out.includes("\n")) resolve(out.slice(0, out.indexOf("\n")));
    });
  }),
) as { socket: string };

/** One request on the daemon's socket. */
async function call(method: string, params: unknown, id: number): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(status.socket);
    let buffer = "";
    socket.setEncoding("utf8");
    socket.on("connect", () => {
      socket.write(
        `${JSON.stringify({ jsonrpc: "2.0", id: 0, method: "mostra/initialize", params: { client: { name: "safari-smoke", version: "0" }, revisions: ["2026-10-10"], capabilities: {}, ports: [] } })}\n`,
      );
      socket.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      // Only newline-terminated records are complete; the tail waits for the next chunk.
      const end = buffer.lastIndexOf("\n");
      if (end < 0) return;
      const complete = buffer.slice(0, end);
      buffer = buffer.slice(end + 1);
      for (const line of complete.split("\n")) {
        if (!line.trim()) continue;
        const message = JSON.parse(line) as {
          id: number;
          result?: Record<string, unknown>;
          error?: unknown;
        };
        if (message.id !== id) continue;
        socket.end();
        if (message.error) reject(new Error(JSON.stringify(message.error)));
        else resolve(message.result ?? {});
      }
    });
  });
}

const receipt = await call("artifact/publish", { source: { path: source } }, 1);
const url = receipt["url"] as string;
console.log(`published version ${receipt["version"]}; opening the link in Safari`);
const opened = spawnSync("open", ["-a", "Safari", url]);
if (opened.status !== 0) throw new Error("couldn't open Safari");

/** The probe facts the gateway logged, with their codes. */
function seen(): Map<string, string> {
  const facts = new Map<string, string>();
  for (const file of readdirSync(join(home, "logs"))) {
    for (const line of readFileSync(join(home, "logs", file), "utf8").split("\n")) {
      if (!line.includes("/_mostra-probe/")) continue;
      const entry = JSON.parse(line) as { path: string; code: string };
      facts.set(entry.path.replace("/_mostra-probe/", ""), entry.code);
    }
  }
  return facts;
}

const deadline = Date.now() + 90_000;
let facts = seen();
while (Date.now() < deadline && !EXPECTED.every((fact) => facts.has(fact))) {
  await new Promise((resolve) => setTimeout(resolve, 500));
  facts = seen();
}
const version = spawnSync(
  "defaults",
  ["read", "/Applications/Safari.app/Contents/Info", "CFBundleShortVersionString"],
  {
    encoding: "utf8",
  },
).stdout.trim();
console.log(
  `Safari ${version}, macOS ${spawnSync("sw_vers", ["-productVersion"], { encoding: "utf8" }).stdout.trim()}`,
);
let passed = true;
for (const fact of EXPECTED) {
  const code = facts.get(fact);
  // 404 MOSTRA_HYGIENE_NOT_SERVED: the request reached the files with a valid frame session.
  const ok = code === "MOSTRA_HYGIENE_NOT_SERVED";
  passed &&= ok;
  console.log(
    `${ok ? "ok  " : "FAIL"} ${fact}${code && !ok ? ` (${code})` : code ? "" : " (never reported)"}`,
  );
}
for (const [fact, code] of facts)
  if (!EXPECTED.includes(fact)) console.log(`FAIL unexpected ${fact} (${code})`);
passed &&= [...facts.keys()].every((fact) => EXPECTED.includes(fact));
daemon.kill("SIGTERM");
console.log(passed ? "Safari smoke run passed." : "Safari smoke run FAILED.");
process.exitCode = passed ? 0 : 1;
