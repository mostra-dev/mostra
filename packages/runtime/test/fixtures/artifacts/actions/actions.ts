"use server";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { abortSignal, emit, log, progress, secret, signal, state, viewer } from "@mostra/server";

/** Echoes its arguments and who called. */
export async function echo(...args: unknown[]) {
  return { args, viewer: viewer() ?? null };
}

/** Runs for `ms`, reporting progress and logging, until cancelled. */
export async function slow(ms: number) {
  progress({ fraction: 0.25, message: "started" });
  log("slow started");
  console.log("console line", { ms });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    abortSignal.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(abortSignal.reason);
    });
  });
  progress({ fraction: 1, message: "done" });
  return "finished";
}

/** Sends one "email" to the fake mail server whose URL and token are secrets (J3). */
export async function send(to: string, body: string) {
  progress({ message: "Sending…" });
  const response = await fetch(secret("MAIL_URL"), {
    method: "POST",
    headers: { authorization: `Bearer ${secret("MAIL_TOKEN")}`, "content-type": "application/json" },
    body: JSON.stringify({ to, body }),
    signal: abortSignal,
  });
  if (!response.ok) throw new Error(`Mail API returned ${response.status}`);
  signal("reply-sent", { to });
  return { sent: true, id: (await response.json()).id };
}

/** Logs, signals, emits and returns a secret: none of it may keep the value (AC-06). */
export async function leak() {
  const value = secret("MAIL_TOKEN");
  log(`token is ${value}`);
  console.error("token", value);
  signal("leaked", { value });
  emit("host.leaked", { value });
  await state.set("leaked", value);
  throw new Error(`failed with ${value}`);
}

/** Full capability (AC-01): a file, a process and the network. */
export async function capability(url: string) {
  const file = readFileSync(new URL(import.meta.url), "utf8").length > 0;
  const processOutput = execFileSync("/bin/echo", ["from a process"], { encoding: "utf8" }).trim();
  const network = await (await fetch(url)).text();
  return { file, process: processOutput, network, pid: process.pid };
}

/** Signals and a host event with this run as their cause (AC-05). */
export async function raise() {
  signal("reply-sent", { id: 7 });
  emit("host.mail.sent", { id: 7 });
  return "raised";
}

/** Writes artifact state as the agent (D63). */
export async function addTask(title: string) {
  const tasks = (await state.get<string[]>("tasks")) ?? [];
  const result = await state.set("tasks", [...tasks, title]);
  return result.revision;
}

/** Streams partial results (an AsyncIterable result). */
export async function* count(to: number) {
  for (let i = 1; i <= to; i++) {
    yield i;
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
}

/** Throws. */
export async function fails() {
  throw new Error("Mail API returned 500");
}

/** Ends its worker (RT-04). */
export async function crash() {
  setTimeout(() => {
    throw new Error("crashed on purpose");
  }, 10);
  await new Promise(() => {});
}

/** Allocates past the heap limit (RT-04). */
export async function oom() {
  const hoard: unknown[] = [];
  for (;;) hoard.push(new Array(100_000).fill({ n: Math.random() }));
}

/** Blocks the event loop (RT-04). */
export async function hang() {
  for (;;) {}
}

/** The worker's process ID, to check one worker per version. */
export async function pid() {
  return process.pid;
}

/** Writes 2 MB of log lines: the run log keeps 1 MB and a marker (D47). */
export async function chatty() {
  const line = "x".repeat(1000);
  for (let i = 0; i < 2100; i++) log(`${i} ${line}`);
  return "chatted";
}

/** Returns a secret: the result Mostra keeps and sends has it redacted (AC-06). */
export async function reveal() {
  return { token: secret("MAIL_TOKEN") };
}

/** Whether the secret `name` holds `expected`, without returning it. */
export async function holds(name: string, expected: string) {
  return secret(name) === expected;
}

/** Returns the secret `name`: Mostra redacts it from what it sends and keeps. */
export async function named(name: string) {
  return secret(name);
}

/** Waits, then says who called: each call keeps its own context across awaits (D19 seam 3). */
export async function whoAfter(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
  return viewer()?.name ?? null;
}

/** Returns `mib` MiB of text: past 16 MiB, Mostra stops the call or run (D131). */
export async function huge(mib: number) {
  return "x".repeat(mib * 1024 * 1024);
}

/** What the worker's process sees of its start: no secret reaches it that way (D124, D38). */
export async function environment() {
  return { env: { ...process.env }, argv: process.argv };
}
