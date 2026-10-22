// A disposable probe of the Windows facts WP-W1's design relies on (removed before the package
// merges). Run on a Windows runner after `cargo build -p mostra-win`:
//   node crates/mostra-win/probe/probe.mjs <target dir> <other user> <password>
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createConnection, createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [targetDir, otherUser, otherPassword] = process.argv.slice(2);
const exe = (name) => join(targetDir, `${name}.exe`);
const results = {};
const note = (key, value) => {
  results[key] = value;
  console.log(`== ${key}: ${JSON.stringify(value)}`);
};
const helper = (...args) => {
  const run = spawnSync(exe("mostra-win"), args, { encoding: "utf8" });
  try {
    return JSON.parse(run.stdout.trim().split("\n").at(-1));
  } catch {
    return { raw: run.stdout, stderr: run.stderr, status: run.status };
  }
};
const probe = (...targets) => {
  const run = spawnSync(
    exe("mostra-win-probe"),
    ["as-user", otherUser, otherPassword, ...targets],
    {
      encoding: "utf8",
    },
  );
  try {
    return JSON.parse(run.stdout.trim());
  } catch {
    return { raw: run.stdout, stderr: run.stderr, status: run.status };
  }
};
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

note("whoami", helper("whoami"));

// 1. Owner-only directories.
const base = mkdtempSync(join(tmpdir(), "w1-"));
const home = join(base, "home");
note("secure-dir created", helper("secure-dir", home));
note("secure-dir again", helper("secure-dir", home));
writeFileSync(join(home, "secret.txt"), "x");
mkdirSync(join(home, "sub"));
writeFileSync(join(home, "sub", "deep.txt"), "x");
const publicDir = "C:\\mostra-probe-public";
mkdirSync(publicDir, { recursive: true });
writeFileSync(join(publicDir, "open.txt"), "x");
const wide = join(publicDir, "wide-home");
mkdirSync(wide, { recursive: true });
writeFileSync(join(wide, "inside.txt"), "x");
note("public before tightening", probe(`dir:${wide}`, `file:${join(wide, "inside.txt")}`));
note("secure-dir tightened", helper("secure-dir", wide));
note("public after tightening", probe(`dir:${wide}`, `file:${join(wide, "inside.txt")}`));
note(
  "other user on home",
  probe(
    `dir:${home}`,
    `file:${join(home, "secret.txt")}`,
    `file:${join(home, "sub", "deep.txt")}`,
    `file:${join(publicDir, "open.txt")}`,
  ),
);
note("node fs.statSync uid on win", (await import("node:fs")).statSync(home).uid);

// 2. Node's own named pipe: who may open it?
const nodePipe = `\\\\.\\pipe\\mostra-probe-node-${process.pid}`;
const nodeServer = createServer((socket) => socket.end("hello\n"));
await new Promise((resolve) => nodeServer.listen(nodePipe, resolve));
note("other user on node's pipe", probe(`pipe:${nodePipe}`));
nodeServer.close();

// 3. The gate: report, go, IPC through it, grandchildren in the job, the lifeline.
const childScript = join(base, "child.mjs");
writeFileSync(
  childScript,
  `import { spawn } from "node:child_process";
const grand = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
process.on("message", (m) => { if (m === "who") process.send({ pid: process.pid, grand: grand.pid, fd: process.env.NODE_CHANNEL_FD }); });
console.log("child stdout works");
console.error("child stderr works");
setInterval(() => {}, 1000);
`,
);
async function gated(extra = {}) {
  const child = spawn(exe("mostra-win"), ["gate", "--", process.execPath, childScript], {
    stdio: ["ignore", "pipe", "pipe", "pipe", "ipc"],
    serialization: "json",
    windowsHide: true,
    ...extra,
  });
  let out = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (out += d));
  const gate = child.stdio[3];
  const report = await new Promise((resolve, reject) => {
    let text = "";
    gate.on("data", (d) => {
      text += d;
      if (text.includes("\n")) resolve(JSON.parse(text.split("\n")[0]));
    });
    child.once("exit", (code) => reject(new Error(`gate exited ${code}: ${out}`)));
  });
  gate.write("go\n");
  child.send("who");
  const [who] = await once(child, "message");
  return { child, gate, report, who, output: () => out };
}

{
  const run = await gated();
  note("gate report", run.report);
  note("child says", run.who);
  note("identity", helper("identity", String(run.who.pid), String(run.who.grand)));
  await delay(300);
  note("output", run.output());
  // Closing the lifeline ends the child and its grandchild.
  run.gate.end();
  const [code] = await once(run.child, "exit");
  await delay(500);
  note("after lifeline closed", { code, child: alive(run.who.pid), grand: alive(run.who.grand) });
}
{
  const run = await gated();
  run.child.kill(); // TerminateProcess on the gate: the job closes with its last handle.
  await once(run.child, "exit");
  await delay(500);
  note("after gate killed", { child: alive(run.who.pid), grand: alive(run.who.grand) });
}
{
  // A supervisor that is killed: its gates' lifelines close.
  const sup = join(base, "sup.mjs");
  writeFileSync(
    sup,
    `import { spawn } from "node:child_process";
import { once } from "node:events";
const child = spawn(${JSON.stringify(exe("mostra-win"))}, ["gate", "--", process.execPath, ${JSON.stringify(childScript)}], { stdio: ["ignore", "ignore", "ignore", "pipe", "ipc"], serialization: "json", windowsHide: true });
let text = "";
child.stdio[3].on("data", (d) => { text += d; if (text.includes("\\n")) { child.stdio[3].write("go\\n"); child.send("who"); } });
const [who] = await once(child, "message");
console.log(JSON.stringify(who));
setInterval(() => {}, 1000);
`,
  );
  const supervisor = spawn(process.execPath, [sup], { stdio: ["ignore", "pipe", "inherit"] });
  const [line] = await once(supervisor.stdout, "data");
  const who = JSON.parse(String(line));
  supervisor.kill();
  await once(supervisor, "exit");
  await delay(800);
  note("after supervisor killed", { child: alive(who.pid), grand: alive(who.grand) });
}
{
  // The gate never released: the command never runs.
  const marker = join(base, "ran.txt");
  const child = spawn(
    exe("mostra-win"),
    [
      "gate",
      "--",
      process.execPath,
      "-e",
      `require("fs").writeFileSync(${JSON.stringify(marker)}, "x")`,
    ],
    {
      stdio: ["ignore", "ignore", "ignore", "pipe"],
      windowsHide: true,
    },
  );
  await once(child.stdio[3], "data");
  child.stdio[3].end();
  const [code] = await once(child, "exit");
  await delay(300);
  note("never released", { code, ran: (await import("node:fs")).existsSync(marker) });
}
{
  // Reaping a recorded child whose gate is gone but whose job lives: simulate with `reap` on a
  // live gated child.
  const run = await gated();
  note("reap live", helper("reap", `${run.report.pid}:${run.report.startTime}`));
  await delay(300);
  note("after reap", { child: alive(run.who.pid), grand: alive(run.who.grand) });
  note("reap reused", helper("reap", `${process.pid}:win/1`));
  await once(run.child, "exit");
}

// 4. The pipe broker.
{
  const name = `mostra-probe-${process.pid}`;
  const broker = spawn(exe("mostra-win"), ["gate", "--", exe("mostra-win"), "pipe", name], {
    stdio: ["ignore", "pipe", "pipe", "pipe", "overlapped"],
    windowsHide: true,
  });
  broker.stderr.on("data", (d) => console.log("broker stderr", String(d)));
  let text = "";
  broker.stdio[3].on("data", (d) => {
    text += d;
    if (text.includes("\n")) broker.stdio[3].write("go\n");
  });
  const channel = broker.stdio[4];
  let buffer = Buffer.alloc(0);
  const frames = [];
  let waiting;
  channel.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 9) {
      const length = buffer.readUInt32LE(5);
      if (buffer.length < 9 + length) break;
      const frame = {
        id: buffer.readUInt32LE(0),
        kind: buffer[4],
        payload: buffer.subarray(9, 9 + length),
      };
      buffer = buffer.subarray(9 + length);
      frames.push(frame);
      // Echo server: DATA back as DATA uppercased.
      if (frame.kind === 2) {
        const reply = Buffer.from(String(frame.payload).toUpperCase());
        const header = Buffer.alloc(9);
        header.writeUInt32LE(frame.id, 0);
        header[4] = 2;
        header.writeUInt32LE(reply.length, 5);
        channel.write(Buffer.concat([header, reply]));
      }
      waiting?.();
    }
  });
  const next = async (kind) => {
    for (;;) {
      const index = frames.findIndex((f) => f.kind === kind);
      if (index >= 0) return frames.splice(index, 1)[0];
      await new Promise((r) => (waiting = r));
    }
  };
  const ready = await next(4);
  note("broker ready", String(ready.payload));
  const client = createConnection(String(ready.payload));
  await once(client, "connect");
  client.write("hello broker\n");
  const [echo] = await once(client, "data");
  note("broker echo", String(echo));
  note("other user on broker pipe", probe(`pipe:${String(ready.payload)}`));
  // 16 clients at once.
  const many = await Promise.all(
    Array.from({ length: 16 }, async (_, i) => {
      const c = createConnection(String(ready.payload));
      await once(c, "connect");
      c.write(`c${i}\n`);
      const [d] = await once(c, "data");
      c.end();
      return String(d).trim();
    }),
  );
  note("broker 16 clients", many);
  // A second broker on the same name is refused (first instance).
  const second = spawn(exe("mostra-win"), ["gate", "--", exe("mostra-win"), "pipe", name], {
    stdio: ["ignore", "pipe", "pipe", "pipe", "overlapped"],
    windowsHide: true,
  });
  second.stdio[3].once("data", () => second.stdio[3].write("go\n"));
  const [secondFrame] = await once(second.stdio[4], "data");
  note("second broker", { kind: secondFrame[4], why: String(secondFrame.subarray(9)) });
  client.end();
  channel.end();
  broker.stdio[3].end();
  await once(broker, "exit");
  note("broker exit", broker.exitCode);
}

console.log(JSON.stringify(results, null, 2));
process.exit(0);
