import { defineArtifact, useField } from "@mostra/react";

// RM-08's load test: a public poll answered by many people who aren't signed in, one answer per
// browser, counted by the server's built-in tally (D165 items 12, 13).
export const artifact = defineArtifact({
  title: "Which day suits you?",
  submission: { policy: "once", scope: "per-viewer" },
  tally: [{ field: "answer", choices: ["monday", "tuesday", "wednesday"] }],
});

export default function Poll() {
  const [answer, setAnswer] = useField("answer", "monday", { label: "Day" });
  return (
    <main>
      <h1>Which day suits you?</h1>
      <select value={answer} onChange={(event) => setAnswer(event.target.value)}>
        <option value="monday">Monday</option>
        <option value="tuesday">Tuesday</option>
        <option value="wednesday">Wednesday</option>
      </select>
    </main>
  );
}
