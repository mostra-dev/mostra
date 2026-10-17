/**
 * J3's inbox (WP-08): each email has an editable reply and a "Send" button wired to an action that
 * calls a mail API with a secret held server-side; its key makes a double click, a second tab or a
 * reload send once. A keyed export shows progress and survives a reload; a long job can be
 * cancelled; live sources fill the inbox and a ticker. Every control has a `data-testid`.
 */
import { defineArtifact, useAction, useField, useLive } from "@mostra/react";
import { exportReport, longJob, sendReply } from "./actions";

export const artifact = defineArtifact({ title: "Morning inbox", family: "inbox" });

interface Mail {
  readonly id: string;
  readonly from: string;
  readonly subject: string;
  readonly suggested: string;
}

function Message(props: { readonly mail: Mail }) {
  const { mail } = props;
  const [reply, setReply] = useField(`reply.${mail.id}`, mail.suggested, {
    label: `Reply to ${mail.from}`,
  });
  const send = useAction(sendReply, { key: `send.${mail.id}` });
  return (
    <li>
      <h3>{mail.subject}</h3>
      <textarea
        data-testid={`reply-${mail.id}`}
        value={reply}
        onChange={(event) => setReply(event.target.value)}
      />
      <button
        type="button"
        data-testid={`send-${mail.id}`}
        onClick={() => void send.run(mail.id, reply).catch(() => {})}
      >
        {send.status === "succeeded" ? "Sent" : send.isPending ? (send.progress?.message ?? "Sending…") : "Send"}
      </button>
      <output data-testid={`send-${mail.id}-status`}>{send.status}</output>
      {send.error && <p role="alert">{send.error.message}</p>}
    </li>
  );
}

export default function Inbox() {
  const inbox = useLive("inbox");
  const ticks = useLive("ticks", { mode: "append", window: 5 });
  const report = useAction(exportReport, { key: "export.weekly" });
  const job = useAction(longJob);
  const mails = (inbox.data as { messages: Mail[] } | undefined)?.messages ?? [];
  const recent = (ticks.data as number[] | undefined) ?? [];
  return (
    <main>
      <p data-testid="inbox-state">{inbox.isLoading ? "loading" : `${mails.length} messages`}</p>
      <ul>
        {mails.map((mail) => (
          <Message key={mail.id} mail={mail} />
        ))}
      </ul>
      <section>
        <output data-testid="ticks-count">{recent.length}</output>
        <output data-testid="ticks-last">{recent.at(-1) ?? ""}</output>
      </section>
      <section>
        <button type="button" data-testid="export" onClick={() => void report.run().catch(() => {})}>
          Export
        </button>
        <output data-testid="export-status">{report.status}</output>
        <output data-testid="export-progress">{report.progress?.message ?? ""}</output>
        <output data-testid="export-log">{report.log.length}</output>
        <output data-testid="export-pages">{report.data ? String(report.data.pages) : ""}</output>
      </section>
      <section>
        <button type="button" data-testid="job" onClick={() => void job.run().catch(() => {})}>
          Start
        </button>
        <button type="button" data-testid="job-cancel" onClick={job.cancel}>
          Cancel
        </button>
        <output data-testid="job-status">{job.status}</output>
        <output data-testid="job-error">{job.error?.code ?? ""}</output>
      </section>
    </main>
  );
}
