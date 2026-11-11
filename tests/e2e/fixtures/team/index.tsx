// WP-31 (J14, D168): a retro five people answer. Each sees who answered, who is here with their
// cursor, and who changed the shared action list, all from the hooks, in the page's own design.
import { defineArtifact, useField, usePresence, useRespondents } from "@mostra/react";
import { useState } from "react";

export const artifact = defineArtifact({
  title: "Retro",
  submission: { policy: "once", scope: "per-viewer" },
  team: { visibility: "names" },
});

function Respondents() {
  const { counts, respondents } = useRespondents();
  return (
    <section>
      <p data-testid="answered">{counts ? `${counts.submitted} of ${counts.total} answered` : "…"}</p>
      <ul>
        {respondents.map((one) => (
          <li key={one.key} data-testid="respondent" data-name={one.name} data-status={one.status}>
            {one.name}: {one.status}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Here({ share }: { share: boolean }) {
  const { others } = usePresence({ cursor: share });
  return (
    <ul data-testid="here">
      {others.map((peer) => (
        <li
          key={peer.key}
          data-testid="peer"
          data-name={peer.name}
          data-cursor={peer.cursor ? `${peer.cursor.x},${peer.cursor.y}` : ""}
        >
          {peer.name}
        </li>
      ))}
    </ul>
  );
}

export default function Retro() {
  const [went, setWent] = useField("went", "", { label: "What went well" });
  const [actions, setActions, meta] = useField("actions", "", {
    label: "Actions",
    scope: "artifact",
  });
  const [share, setShare] = useState(true);
  return (
    <main style={{ minHeight: "900px", padding: 24 }}>
      <h1>Retro</h1>
      <Respondents />
      <label>
        <input type="checkbox" checked={share} onChange={(e) => setShare(e.target.checked)} />
        Share my cursor
      </label>
      <Here share={share} />
      <label>
        What went well
        <textarea data-testid="went" value={went} onChange={(e) => setWent(e.target.value)} />
      </label>
      <label>
        Actions
        <textarea data-testid="actions" value={actions} onChange={(e) => setActions(e.target.value)} />
      </label>
      <p data-testid="changed-by">
        {meta.updatedBy ? `${meta.updatedBy.self ? "you" : meta.updatedBy.name}` : "nobody"}
      </p>
    </main>
  );
}
