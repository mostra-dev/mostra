// A disposable probe of the Windows facts WP-W2's design relies on (removed before the package
// merges). Each probe prints one JSON line: `{ probe, ...facts }`.
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, renameSync, rmSync, watch, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

const out = (probe, facts) => console.log(JSON.stringify({ probe, ...facts }));
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const which = process.argv[2] ?? "all";

async function exitCodes() {
  const run = (args) => {
    const result = spawnSync(process.execPath, args, { encoding: "utf8", timeout: 120_000 });
    return {
      status: result.status,
      signal: result.signal,
      hex: result.status === null ? null : (result.status >>> 0).toString(16),
      stderrTail: (result.stderr ?? "").trim().split(/\r?\n/).slice(-4),
    };
  };
  out(
    "oom",
    run([
      "--max-old-space-size=32",
      "-e",
      "const a=[];for(;;)a.push(new Array(1e5).fill(Math.random()))",
    ]),
  );
  out("abort", run(["-e", "process.abort()"]));
  out("uncaught", run(["-e", "throw new Error('boom')"]));
  out("self-sigkill", run(["-e", "process.kill(process.pid,'SIGKILL')"]));
  out("self-sigterm", run(["-e", "process.kill(process.pid,'SIGTERM')"]));
  out(
    "kill-negative",
    run([
      "-e",
      "try{process.kill(-process.pid,'SIGTERM');console.error('no throw')}catch(e){console.error('threw',e.code)}",
    ]),
  );
  // A child killed from outside: what Node reports.
  const child = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"]);
  await delay(500);
  child.kill();
  const [code, signal] = await new Promise((resolve) =>
    child.once("exit", (c, s) => resolve([c, s])),
  );
  out("killed-child", { code, signal });
  const child2 = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"]);
  await delay(500);
  child2.kill("SIGKILL");
  const [code2, signal2] = await new Promise((resolve) =>
    child2.once("exit", (c, s) => resolve([c, s])),
  );
  out("killed-child-sigkill", { code: code2, signal: signal2 });
}

async function ports() {
  let excluded = "";
  try {
    excluded = execFileSync("netsh", ["int", "ipv4", "show", "excludedportrange", "protocol=tcp"], {
      encoding: "utf8",
    });
  } catch (error) {
    excluded = String(error);
  }
  out("excluded-ranges", {
    text: excluded
      .split(/\r?\n/)
      .filter((l) => l.trim())
      .slice(0, 40),
  });
  const dynamic = execFileSync("netsh", ["int", "ipv4", "show", "dynamicport", "tcp"], {
    encoding: "utf8",
  });
  out("dynamic-range", { text: dynamic.split(/\r?\n/).filter((l) => l.trim()) });
  // Bind a port inside the first excluded range, if any.
  const range = excluded.match(/^\s*(\d+)\s+(\d+)/m);
  if (range) {
    const port = Number(range[1]);
    const server = createNetServer();
    const error = await new Promise((resolve) => {
      server.once("error", (e) => resolve(e.code));
      server.listen(port, "127.0.0.1", () => resolve("bound"));
    });
    server.close();
    out("bind-excluded", { port, error });
  }
  // Bind the same port twice from Node (EADDRINUSE?).
  const first = createNetServer();
  await new Promise((resolve) => first.listen(0, "127.0.0.1", resolve));
  const port = first.address().port;
  const second = createNetServer();
  const twice = await new Promise((resolve) => {
    second.once("error", (e) => resolve(e.code));
    second.listen(port, "127.0.0.1", () => resolve("bound"));
  });
  second.close();
  const wild = createNetServer();
  const wildcard = await new Promise((resolve) => {
    wild.once("error", (e) => resolve(e.code));
    wild.listen(port, "0.0.0.0", () => resolve("bound"));
  });
  wild.close();
  // Another process, with SO_REUSEADDR (.NET ReuseAddress): can it take the port?
  const ps = spawnSync(
    "pwsh",
    [
      "-NoProfile",
      "-Command",
      `$s = New-Object System.Net.Sockets.Socket([System.Net.Sockets.AddressFamily]::InterNetwork,[System.Net.Sockets.SocketType]::Stream,[System.Net.Sockets.ProtocolType]::Tcp); $s.ExclusiveAddressUse=$false; $s.SetSocketOption([System.Net.Sockets.SocketOptionLevel]::Socket,[System.Net.Sockets.SocketOptionName]::ReuseAddress,$true); try { $s.Bind((New-Object System.Net.IPEndPoint([System.Net.IPAddress]::Parse('127.0.0.1'), ${port}))); $s.Listen(1); 'bound' } catch { $_.Exception.Message }; $s.Close()`,
    ],
    { encoding: "utf8" },
  );
  first.close();
  out("bind-twice", {
    port,
    sameAddress: twice,
    wildcard,
    reuseAddrOtherProcess: (ps.stdout + ps.stderr).trim(),
  });
}

async function opener() {
  const server = createServer((req, res) => {
    hits.push({ url: req.url, ua: req.headers["user-agent"] });
    res.end("ok");
  });
  const hits = [];
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const dir = mkdtempSync(join(tmpdir(), "mostra open-"));
  const tryOne = async (label, argv, tag) => {
    const page = join(dir, `${tag}.html`);
    writeFileSync(
      page,
      `<!DOCTYPE html><meta charset="utf-8"><script>location.replace("http://127.0.0.1:${port}/${tag}")</script>`,
    );
    const before = hits.length;
    const started = await new Promise((resolve) => {
      const child = spawn(argv[0], [...argv.slice(1), page], { detached: true, stdio: "ignore" });
      child.once("spawn", () => resolve(true));
      child.once("error", (e) => resolve(String(e)));
      child.unref();
    });
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline && !hits.slice(before).some((h) => h.url === `/${tag}`))
      await delay(250);
    out("opener", {
      label,
      started,
      page,
      hit: hits.slice(before).find((h) => h.url === `/${tag}`) ?? null,
    });
  };
  await tryOne("explorer", ["explorer.exe"], "explorer");
  await tryOne("rundll32", ["rundll32.exe", "url.dll,FileProtocolHandler"], "rundll32");
  let assoc = "";
  try {
    assoc = execFileSync(
      "reg",
      [
        "query",
        "HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\http\\UserChoice",
      ],
      { encoding: "utf8" },
    );
  } catch (error) {
    assoc = String(error.stdout ?? error);
  }
  let htmlAssoc = "";
  try {
    htmlAssoc = execFileSync("cmd", ["/c", "assoc", ".html"], { encoding: "utf8" });
  } catch (error) {
    htmlAssoc = String(error.stdout ?? error);
  }
  out("associations", { http: assoc.trim().split(/\r?\n/), html: htmlAssoc.trim() });
  server.close();
}

async function watching() {
  const dir = mkdtempSync(join(tmpdir(), "mostra-watch-"));
  mkdirSync(join(dir, "src"));
  writeFileSync(join(dir, "src", "page.tsx"), "export default 1;\n");
  const events = [];
  const watcher = watch(dir, { recursive: true }, (type, name) => events.push([type, name]));
  await delay(300);
  const mark = async (label, act) => {
    events.length = 0;
    act();
    await delay(800);
    out("watch", { label, events: [...events] });
  };
  await mark("in-place", () => writeFileSync(join(dir, "src", "page.tsx"), "export default 2;\n"));
  await mark("atomic-rename", () => {
    writeFileSync(join(dir, "src", ".page.tsx.tmp"), "export default 3;\n");
    renameSync(join(dir, "src", ".page.tsx.tmp"), join(dir, "src", "page.tsx"));
  });
  await mark("backup-rename", () => {
    renameSync(join(dir, "src", "page.tsx"), join(dir, "src", "page.tsx~"));
    writeFileSync(join(dir, "src", "page.tsx"), "export default 4;\n");
    rmSync(join(dir, "src", "page.tsx~"));
  });
  await mark("new-dir", () => {
    mkdirSync(join(dir, "src", "deep"));
    writeFileSync(join(dir, "src", "deep", "x.ts"), "1");
  });
  watcher.close();
}

const all = { exitCodes, ports, opener, watching };
for (const [name, fn] of Object.entries(all)) {
  if (which !== "all" && which !== name) continue;
  try {
    await fn();
  } catch (error) {
    out(name, { failed: String(error?.stack ?? error) });
  }
}
process.exit(0);
