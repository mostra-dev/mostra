import { Page } from "@mostra/kit/layout";
import { defineArtifact, useAction, useField } from "@mostra/react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { sendReply } from "./actions";

export const artifact = defineArtifact({
  title: "Replies to send this morning",
  description: "I drafted a reply to each email that needs one. Edit any of them, then send.",
  family: "inbox",
  submission: { policy: "none" },
  kit: { theme: "studio" },
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
    <Card>
      <CardHeader>
        <CardTitle>{email.subject}</CardTitle>
        <CardDescription>
          {email.from}, at <time className="tabular-nums">{email.received}</time>
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-muted-foreground">{email.excerpt}</p>
        <Textarea
          aria-label={`Your reply to ${email.from}`}
          value={body}
          onChange={(event) => setBody(event.target.value)}
          readOnly={sent}
          rows={3}
        />
      </CardContent>
      <CardFooter className="justify-end gap-3">
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
        <Button
          disabled={send.isPending || sent || body.trim() === ""}
          onClick={() => void send.run(email.id, body).catch(() => {})}
        >
          {send.isPending ? (send.progress?.message ?? "Sending…") : "Send"}
        </Button>
      </CardFooter>
    </Card>
  );
}

export default function Inbox() {
  return (
    <Page title={artifact.title} description={artifact.description}>
      {EMAILS.map((email) => (
        <Reply key={email.id} email={email} />
      ))}
    </Page>
  );
}
