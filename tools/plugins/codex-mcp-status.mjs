// Asks Codex's app server for its MCP servers' status, which starts each server and lists its
// tools, with no model involved: node codex-mcp-status.mjs <server name>. Or, with `--skills
// <plugin id>`, for the skills it loaded from that plugin, each with its path, exiting 0 only when
// there is exactly one (MT-07: the plugin's second copy of the Skill, in claude-directory/, is
// never a second skill). HOME and CODEX_HOME come from the environment.
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

const skillsOf = process.argv[2] === "--skills" ? (process.argv[3] ?? "mostra@mostra") : undefined;
const wanted = process.argv[2] ?? "mostra";
// npm installs Codex on Windows as `codex.cmd`, which Node.js starts only through a shell.
const codex = spawn("codex", ["app-server"], {
  stdio: ["pipe", "pipe", "inherit"],
  shell: process.platform === "win32",
});
const lines = createInterface({ input: codex.stdout });
const pending = new Map();
let next = 1;
lines.on("line", (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  if (message.id !== undefined && pending.has(message.id)) {
    pending.get(message.id)(message);
    pending.delete(message.id);
  } else if (message.method?.startsWith("mcpServer/")) {
    console.error("notification", JSON.stringify(message).slice(0, 300));
  }
});
const call = (method, params) =>
  new Promise((resolve) => {
    const id = next++;
    pending.set(id, resolve);
    codex.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
  });
const timer = setTimeout(() => {
  console.log("TIMEOUT");
  codex.kill();
  process.exit(2);
}, 300_000);
const init = await call("initialize", {
  clientInfo: { name: "mostra-wp15-check", version: "0.0.0" },
});
if (init.error) console.log("initialize error", JSON.stringify(init.error));
codex.stdin.write(`${JSON.stringify({ method: "initialized" })}\n`);
if (skillsOf !== undefined) {
  const listed = await call("skills/list", { cwds: [process.cwd()], forceReload: true });
  const skills = (listed.result?.data ?? [])
    .flatMap((entry) => entry.skills ?? [])
    .filter((skill) => skill.pluginId === skillsOf);
  for (const skill of skills) console.log("SKILL", skill.name, skill.path);
  if (listed.error) console.log("skills/list error", JSON.stringify(listed.error));
  clearTimeout(timer);
  codex.kill();
  process.exit(skills.length === 1 ? 0 : 1);
}
const status = await call("mcpServerStatus/list", { detail: "toolsAndAuthOnly" });
const servers = status.result?.data ?? status.result?.servers ?? [];
const entry = servers.find((server) => server.name === wanted);
if (!entry) console.log("NOT FOUND", JSON.stringify(status).slice(0, 2000));
else
  console.log(
    "SERVER",
    wanted,
    "tools:",
    Object.keys(entry.tools ?? {})
      .sort()
      .join(","),
    JSON.stringify(entry).slice(0, 300),
  );
clearTimeout(timer);
codex.kill();
process.exit(entry && Object.keys(entry.tools ?? {}).length > 0 ? 0 : 1);
