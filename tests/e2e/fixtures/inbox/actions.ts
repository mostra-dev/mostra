"use server";
import { abortSignal, log, progress, secret } from "@mostra/server";

const sleep = (ms: number) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    abortSignal.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(abortSignal.reason);
    });
  });

/** Sends a reply through the mail API, whose URL is a secret (J3). */
export async function sendReply(id: string, body: string) {
  progress({ message: "Sending…" });
  const response = await fetch(secret("MAIL_URL"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id, body }),
    signal: abortSignal,
  });
  if (!response.ok) throw new Error(`Mail API returned ${response.status}`);
  return { sent: true };
}

/** Exports ten pages, slowly. */
export async function exportReport() {
  for (let page = 1; page <= 10; page++) {
    progress({ fraction: page / 10, message: `Page ${page} of 10` });
    log(`page ${page}`);
    await sleep(400);
  }
  return { pages: 10 };
}

/** Runs until cancelled. */
export async function longJob() {
  progress({ message: "Working" });
  await sleep(120_000);
  return "done";
}
