"use server";
import { abortSignal, dryRun, progress, secret } from "@mostra/server";

/**
 * Sends one reply. The key the page runs it under is also the mail service's idempotency key, so
 * a run cut off mid-send and tried again under a new key can't send twice.
 */
export async function sendReply(emailId: string, body: string): Promise<{ sentAt: string }> {
  if (dryRun()) return { sentAt: new Date().toISOString() };
  progress({ message: "Sending…" });
  const response = await fetch(`${secret("MAIL_API")}/send`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${secret("MAIL_TOKEN")}`,
      "content-type": "application/json",
      "idempotency-key": `reply-${emailId}`,
    },
    body: JSON.stringify({ inReplyTo: emailId, body }),
    signal: abortSignal,
  });
  if (!response.ok) throw new Error(`The mail service answered ${response.status}.`);
  return { sentAt: new Date().toISOString() };
}
