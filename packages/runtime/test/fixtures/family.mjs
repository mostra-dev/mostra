// A child with grandchildren, for the Windows reaping checks (RT-10): starts two Node.js
// grandchildren that idle, writes their PIDs and its own to the file it is given, and idles.
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

const [file] = process.argv.slice(2);
const idle = ["-e", "setInterval(() => {}, 1 << 30)"];
const grandchildren = [0, 1].map(() => spawn(process.execPath, idle, { stdio: "ignore" }).pid);
writeFileSync(file, JSON.stringify({ pid: process.pid, grandchildren }));
setInterval(() => {}, 1 << 30);
