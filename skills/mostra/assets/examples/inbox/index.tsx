import "./styles.css";
import { defineArtifact, useAction, useField } from "@mostra/react";
import { sendReply } from "./actions";

export const artifact = defineArtifact({
  title: "Replies to send this morning",
  description: "I drafted a reply to each email that needs one. Edit any of them, then send.",
  family: "inbox",
  submission: { policy: "none" },
});

interface Email {
  readonly id: string;
  readonly from: string;
  readonly subject: string;
  readonly received: string;
  readonly excerpt: string;
  readonly draft: string;
}

const EMAILS: readonly Email[] = [
  {
    id: "m-1042",
    from: "Priya Natarajan",
    subject: "Can we move Thursday's review?",
    received: "08:12",
    excerpt:
      "Something came up on Thursday afternoon. Would Friday at 10 work for the design review instead?",
    draft: "Hi Priya, Friday at 10 works. I'll move the invite and keep the same room.",
  },
  {
    id: "m-1043",
    from: "Billing at Northwind",
    subject: "Invoice 8831 is due on the 4th",
    received: "07:55",
    excerpt:
      "Invoice 8831 for October hosting (€412.00) is due on 4 November. Reply to confirm the PO number.",
    draft: "Hello, please use PO 2026-117 for invoice 8831. Thank you.",
  },
];

function Reply({ email }: { email: Email }) {
  const [body, setBody] = useField(`replies.${email.id}`, email.draft, {
    label: `Reply to ${email.from}`,
  });
  const send = useAction(sendReply, { key: `reply-${email.id}` });
  const sent = send.status === "succeeded";

  return (
    <article className="rounded-lg border bg-card p-5">
      <header className="flex items-baseline justify-between gap-4">
        <div className="min-w-0">
          <h2 className="truncate font-medium">{email.subject}</h2>
          <p className="text-sm text-muted-foreground">{email.from}</p>
        </div>
        <time className="shrink-0 text-sm tabular-nums text-muted-foreground">
          {email.received}
        </time>
      </header>
      <p className="mt-3 text-sm text-muted-foreground">{email.excerpt}</p>
      <label className="mt-4 block">
        <span className="sr-only">Your reply to {email.from}</span>
        <textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          readOnly={sent}
          rows={3}
          className="block w-full rounded-md border border-input bg-background px-3 py-2 text-base read-only:bg-muted"
        />
      </label>
      <footer className="mt-3 flex items-center justify-end gap-3">
        {send.error && (
          <p role="status" className="mr-auto text-sm text-destructive">
            Not sent: {send.error.message}
          </p>
        )}
        {sent && (
          <p role="status" className="mr-auto text-sm text-success">
            Sent
          </p>
        )}
        <button
          type="button"
          disabled={send.isPending || sent || body.trim() === ""}
          onClick={() => void send.run(email.id, body).catch(() => {})}
          className="rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-transform active:scale-[.97] disabled:opacity-50"
        >
          {send.isPending ? (send.progress?.message ?? "Sending…") : "Send"}
        </button>
      </footer>
    </article>
  );
}

export default function Page() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-12 sm:py-16">
      <header className="max-w-prose">
        <h1 className="text-3xl font-semibold tracking-tight">{artifact.title}</h1>
        <p className="mt-3 text-muted-foreground">{artifact.description}</p>
      </header>
      <div className="mt-10 space-y-4">
        {EMAILS.map((email) => (
          <Reply key={email.id} email={email} />
        ))}
      </div>
    </main>
  );
}
