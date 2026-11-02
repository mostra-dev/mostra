// `mostra mcp` as an MCP client starts it from npm (D164 item 7): with no runtime bundle in its
// cache yet, the server must answer its client within a client's startup timeout (Codex gives 10 s)
// and list its tools, then, once its own background install is done, serve a tool that needs the
// instance. Plain JSON-RPC over stdio, so the smoke test installs nothing more.
//
//   node mcp-smoke.mjs <expected artifact ID> -- <command> <args…>
//
// The command runs with this process's environment (MOSTRA_CACHE_DIR names the empty cache).
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

const separator = process.argv.indexOf("--");
const [expected] = process.argv.slice(2, separator);
const [command, ...args] = process.argv.slice(separator + 1);
const say = (text) => process.stdout.write(`mcp-smoke: ${text}\n`);
const die = (text) => {
  process.stderr.write(`mcp-smoke: FAILED: ${text}\n`);
  process.exit(1);
};

const started = Date.now();
const server = spawn(command, args, { stdio: ["pipe", "pipe", "inherit"] });
server.on("error", (error) => die(`the server didn't start: ${error.message}`));
const pending = new Map();
createInterface({ input: server.stdout }).on("line", (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    die(`the server wrote something other than JSON-RPC on stdout: ${line.slice(0, 200)}`);
  }
  pending.get(message.id)?.(message);
  pending.delete(message.id);
});
let next = 1;
const request = (method, params, ms) =>
  new Promise((resolve) => {
    const id = next++;
    const timer = setTimeout(() => die(`${method} got no answer in ${ms} ms`), ms);
    pending.set(id, (message) => {
      clearTimeout(timer);
      if (message.error) die(`${method}: ${JSON.stringify(message.error)}`);
      resolve(message.result);
    });
    server.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  });

const init = await request(
  "initialize",
  {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "mostra-npm-smoke", version: "1.0.0" },
  },
  10_000,
);
const answeredIn = Date.now() - started;
say(
  `initialize answered in ${answeredIn} ms by ${init.serverInfo?.name} ${init.serverInfo?.version}`,
);
server.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
const { tools } = await request("tools/list", {}, 10_000);
if (!tools.some((tool) => tool.name === "artifact_verify"))
  die("tools/list has no artifact_verify");
say(`tools/list: ${tools.length} tools`);

// The install goes on while calls answer MOSTRA_ENV_RUNTIME_INSTALLING; then the instance answers.
const deadline = Date.now() + 15 * 60_000;
let installing = 0;
for (;;) {
  const result = await request("tools/call", { name: "artifact_list", arguments: {} }, 120_000);
  const text = result.content?.find((block) => block.type === "text")?.text ?? "";
  if (text.includes("MOSTRA_ENV_RUNTIME_INSTALLING")) {
    installing += 1;
    if (Date.now() > deadline) die("the runtime's install didn't finish in 15 minutes");
    continue;
  }
  if (result.isError) die(`artifact_list failed: ${text}`);
  if (!text.includes(expected))
    die(`artifact_list doesn't list ${expected}: ${text.slice(0, 400)}`);
  break;
}
say(`artifact_list lists ${expected} after ${installing} answers that the runtime was installing`);
server.stdin.end();
await new Promise((resolve) => server.on("exit", resolve));
say(`passed in ${Math.round((Date.now() - started) / 1000)} s`);
