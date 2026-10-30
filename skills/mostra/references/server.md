# Server code: actions, secrets and side effects

## Contents

- Server functions
- Actions: `useAction`
- Side effects that happen once
- Secrets
- What server code can use: `@mostra/server`
- Verify and `dryRun()`
- Limits and crashes

## Server functions

Any module whose first statement is `"use server"` runs on this machine, in a worker process of its own, with full Node.js: files, processes, the network, any npm package. It exports only async functions (async generators too). The page imports them like ordinary functions; Mostra sends the call to the worker.

```ts
// actions.ts
"use server";
import { readFile } from "node:fs/promises";

export async function loadReport(name: string) {
  return JSON.parse(await readFile(`data/${name}.json`, "utf8"));   // relative to the artifact's directory
}
```

```tsx
// index.tsx
import { loadReport } from "./actions";

const report = await loadReport("q3");   // inside an effect or event handler
```

- Arguments and results are what React's Server Functions accept: JSON values, `Date`, `Map`, `Set`, `BigInt`, typed arrays, `FormData`, `File`, promises, plus async iterables as results. Functions and class instances don't cross (`MOSTRA_ACTION_UNSERIALIZABLE`).
- A thrown error reaches the page as a `MostraError` with `code: "MOSTRA_ACTION_THREW"` and the error's message; its stack goes to the run's log.
- Calling a function directly is a plain call: nothing is recorded, and a reload forgets it. Use it to read things. For anything that changes the world, use an action.

## Actions: `useAction`

`useAction` makes every call a recorded **run** with progress, a log, a final state, and cancellation:

```tsx
import { useAction } from "@mostra/react";
import { sendReply } from "./actions";

function Reply({ email }: { email: Email }) {
  const send = useAction(sendReply, { key: `reply-${email.id}` });
  return (
    <button disabled={send.isPending || send.status === "succeeded"} onClick={() => void send.run(email.id, draft)}>
      {send.status === "succeeded" ? "Sent" : send.isPending ? send.progress?.message ?? "Sending…" : "Send"}
    </button>
  );
}
```

- **Without a `key`**, a second call while the first runs joins it, so a double click runs once.
- **With a `key`**, the run happens at most once, ever: every click, tab, reload and viewer with that key joins the same run and sees its progress and result. A run that failed stays failed; a new attempt needs a new key (`reply-${email.id}-retry-1`).
- The handle has `status` (`idle`, `queued`, `running`, `succeeded`, `failed`, `cancelled`), `isPending`, `data`, `error` (`{ code, message }`), `progress` (`{ fraction?, message? }`), `log`, `partial` (the items an async-iterable result yielded so far), `runId` and `cancel()`.
- `run()` resolves with the result or rejects with a `MostraError` whose `code` says why (`MOSTRA_ACTION_THREW`, `MOSTRA_ACTION_CANCELLED`, `MOSTRA_ACTION_INTERRUPTED`, `MOSTRA_RUNTIME_WORKER_PARKED`).
- A run keeps going when the tab closes. A page that loads later finds a keyed run again by its key.
- Results list the runs started in the submitting view, so you can see what the person did.

## Side effects that happen once

A run cut off by a crash or a restart ends `failed` with `MOSTRA_ACTION_INTERRUPTED`, and Mostra never retries it: the email may or may not have gone. So for any external side effect, pass an idempotency key the provider understands, derived from the run's key, so the provider drops a repeat:

```ts
"use server";
import { abortSignal, progress, secret } from "@mostra/server";

export async function sendReply(emailId: string, body: string) {
  progress({ message: "Sending…" });
  const response = await fetch("https://api.mail.example/v1/send", {
    method: "POST",
    headers: {
      authorization: `Bearer ${secret("MAIL_TOKEN")}`,
      "idempotency-key": `reply-${emailId}`,      // the same key the page gave useAction
      "content-type": "application/json",
    },
    body: JSON.stringify({ inReplyTo: emailId, body }),
    signal: abortSignal,                           // cancel() aborts the request
  });
  if (!response.ok) throw new Error(`The mail service answered ${response.status}`);
  return { sent: true };
}
```

## Secrets

Keep keys and tokens out of the source. Mostra stores each one in its home, read from stdin:

```sh
mostra secret set MAIL_TOKEN --artifact ./inbox < mail-token.txt   # this artifact only
mostra secret set CALENDAR_KEY < calendar-key.txt                 # every artifact in this home
mostra secret list --artifact ./inbox                              # names only, never values
mostra secret rm MAIL_TOKEN --artifact ./inbox                     # remove it
```

Server code reads it with `secret("MAIL_TOKEN")`, synchronously; a missing one throws `MOSTRA_SECRET_MISSING`. Mostra redacts every value it hands out from logs, run logs, errors, events, results and live values, so returning or logging one shows `[redacted]`. A secret is the person's to store: ask them to run `mostra secret set` themselves, and never ask for the value in the conversation or in a page field.

## What server code can use

Import these from `@mostra/server` inside a `"use server"` function or a live source:

| Function | Does |
|---|---|
| `progress({ fraction?, message? })` | Shows progress on the page's run |
| `log(line)` | Adds a line to the run's log (`console.log` goes there too) |
| `abortSignal` | Aborts when the run is cancelled; pass it to `fetch` and child processes |
| `secret(name)` | Reads a secret |
| `viewer()` | The person who called: `{ id, name? }` |
| `signal(name, payload?)` | Raises a signal you can `mostra wait <dir> --until signal:<name>` for |
| `emit("host.<name>", payload?)` | An event for the program hosting Mostra; pages never see it |
| `state.get(id)`, `state.set(id, value)`, `state.patch(ops)` | Reads and writes the artifact's shared fields ([long-lived.md](long-lived.md)) |
| `dryRun()` | True only while verify exercises the page |
| `defineLive` | Defines a live source in `live.ts` ([long-lived.md](long-lived.md)) |

Errors these throw are `MostraServerError`s with a `code`.

## Verify and `dryRun()`

Verify clicks through the page but never runs a server function unless that function opts in by checking `dryRun()`:

```ts
export async function sendReply(emailId: string, body: string) {
  if (dryRun()) return { sent: true };   // verify: no email, a realistic answer
  // …the real send
}
```

A function that doesn't opt in is refused in verify, its click gets `MOSTRA_VERIFY_ACTION_SKIPPED` (a hint), and the verdict lists it under skipped actions. Opt in when the page's behavior after the action matters to what verify should see; keep real side effects behind the check.

## Limits and crashes

- Arguments and results up to 16 MiB each, a run's log 1 MB, signals 64 KiB.
- A worker has a 1 GiB heap and is stopped when its event loop is blocked for 10 s; change them in the manifest's `limits` (`heapMb`, `watchdogMs`).
- A crashed worker restarts with backoff. After more than five crashes in ten minutes it stops (`MOSTRA_RUNTIME_WORKER_PARKED`, and the page says the server code keeps crashing); publish a fix to clear it.
- Workers stop after 10 idle minutes and start again on the next call. Keep nothing in module variables that must survive; use shared state or files.
