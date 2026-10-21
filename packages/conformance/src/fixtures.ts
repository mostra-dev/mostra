/**
 * The artifacts the scenarios publish, written fresh into the run's authoring directory. They
 * declare their fields with literal IDs, so every answer a scenario writes is covered by the
 * version (D109) and none is orphaned by accident.
 */

/** A fixture: its files by relative path. */
export type Fixture = Readonly<Record<string, string>>;

/** A questionnaire with viewer fields, an artifact-scoped counter, a family and a link (H-06). */
export const FORM: Fixture = {
  "index.tsx": `import { defineArtifact, useField, useSubmitControl } from "@mostra/react";

export const artifact = defineArtifact({
  title: "Conformance questionnaire",
  description: "The form the host conformance kit answers.",
  family: "questionnaire",
  links: [{ rel: "round-of", artifact: "conformance-round-1" }],
});

export default function Page() {
  useSubmitControl({ label: "Send answers" });
  const [name, setName] = useField("name", "", { label: "Your name", required: true });
  const [comment, setComment] = useField("comment", "", { label: "Comment" });
  const [count, setCount] = useField("count", 0, { label: "Count", scope: "artifact" });
  const [done, setDone] = useField("done", false, { label: "Done", scope: "artifact" });
  return (
    <main>
      <h1>Conformance questionnaire</h1>
      <input name="name" aria-label="Your name" value={name} onChange={(e) => setName(e.target.value)} />
      <textarea name="comment" aria-label="Comment" value={comment} onChange={(e) => setComment(e.target.value)} />
      <button type="button" onClick={() => setCount(count + 1)}>Count {count}</button>
      <label><input type="checkbox" checked={done} onChange={(e) => setDone(e.target.checked)} /> Done</label>
    </main>
  );
}
`,
};

/** The same questionnaire with one more question: a second version of {@link FORM}. */
export const FORM_V2: Fixture = {
  "index.tsx": (FORM["index.tsx"] as string)
    .replace("<h1>Conformance questionnaire</h1>", "<h1>Conformance questionnaire, round 2</h1>")
    .replace(
      "  const [done, setDone]",
      '  const [extra, setExtra] = useField("extra", "", { label: "Extra" });\n  const [done, setDone]',
    )
    .replace(
      "      <label>",
      '      <input name="extra" aria-label="Extra" value={extra} onChange={(e) => setExtra(e.target.value)} />\n      <label>',
    ),
};

/**
 * Server code: an action that raises a signal and emits a host event (AC-05), and one that reads
 * a secret through `secret()` (D131) and returns only its length, never the value.
 */
export const ACTIONS: Fixture = {
  "index.tsx": `import { defineArtifact } from "@mostra/react";

export const artifact = defineArtifact({ title: "Conformance actions" });

export default function Page() {
  return <main><h1>Conformance actions</h1></main>;
}
`,
  "actions.ts": `"use server";
import { emit, secret, signal } from "@mostra/server";

export async function notify(to: string): Promise<string> {
  signal("mail.sent", { to });
  emit("host.mail.sent", { to });
  return "sent";
}

export async function secretLength(name: string): Promise<number> {
  return secret(name).length;
}
`,
};

/** The bundled fixtures by name. */
export const FIXTURES: Readonly<Record<string, Fixture>> = {
  form: FORM,
  "form-v2": FORM_V2,
  actions: ACTIONS,
};
