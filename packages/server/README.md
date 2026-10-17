# @mostra/server

What a Mostra artifact's server code imports: who a call is for, progress and log lines for the
page, named secrets, signals and host events, the artifact's shared state, cancellation, and live
sources. It works inside the artifact's worker, which Mostra starts for every version with
`"use server"` modules or a `live.ts`; it needs no installation in the artifact.

```ts
"use server";
import { abortSignal, progress, secret, signal } from "@mostra/server";

export async function sendReply(messageId: string, body: string) {
  progress({ message: "Sending…" });
  const response = await fetch("https://mail.example/api/send", {
    method: "POST",
    headers: { authorization: `Bearer ${secret("MAIL_TOKEN")}`, "idempotency-key": messageId },
    body: JSON.stringify({ messageId, body }),
    signal: abortSignal,
  });
  if (!response.ok) throw new Error(`Mail API returned ${response.status}`);
  signal("reply-sent", { messageId });
  return { sent: true };
}
```

Part of [Mostra](https://github.com/mostra-dev/mostra), the agent artifact runtime. Apache-2.0.
