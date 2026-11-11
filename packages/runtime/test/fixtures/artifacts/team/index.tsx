// WP-31 (D168): a team form, one submission per person, whose people see each other by name.
import { defineArtifact, useField, usePresence, useRespondents } from "@mostra/react";

export const artifact = defineArtifact({
  title: "Retro",
  submission: { policy: "once", scope: "per-viewer" },
  team: { visibility: "names" },
});

export default function Retro() {
  const [went, setWent] = useField("went", "", { label: "What went well" });
  const [actions, setActions] = useField("actions", "", { label: "Actions", scope: "artifact" });
  const { counts } = useRespondents();
  const { others } = usePresence({ cursor: true });
  return (
    <main>
      <h1>Retro</h1>
      <p data-testid="answered">
        {counts ? `${counts.submitted} of ${counts.total} answered` : "…"}
      </p>
      <p data-testid="here">{others.length} here</p>
      <textarea aria-label="What went well" value={went} onChange={(e) => setWent(e.target.value)} />
      <textarea aria-label="Actions" value={actions} onChange={(e) => setActions(e.target.value)} />
    </main>
  );
}
