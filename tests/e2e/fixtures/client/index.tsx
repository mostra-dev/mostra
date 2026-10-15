/**
 * The client runtime's end-to-end fixture (WP-07): a questionnaire written with the hooks of
 * INTERFACES §2.3, so the browser suites drive real fields, saves, conflicts, the artifact's own
 * submit, signals, `window.storage`, a review set's choice and the trusted Submit's label through
 * a real gateway and shell. Every control has a `data-testid`.
 */
import {
  defineArtifact,
  type FieldMeta,
  useArtifact,
  useChoice,
  useField,
  useSignal,
  useSubmit,
  useSubmitControl,
  useViewer,
} from "@mostra/react";
import { useState } from "react";

export const artifact = defineArtifact({ title: "Client runtime fixture" });

function Conflict<T>(props: { readonly id: string; readonly meta: FieldMeta<T> }) {
  const conflict = props.meta.conflict;
  if (!conflict) return null;
  return (
    <div data-testid={`${props.id}-conflict`}>
      <span data-testid={`${props.id}-theirs`}>{String(conflict.theirs)}</span>
      <button type="button" data-testid={`${props.id}-keep`} onClick={conflict.keepMine}>
        Keep mine
      </button>
      <button type="button" data-testid={`${props.id}-take`} onClick={conflict.takeTheirs}>
        Take theirs
      </button>
    </div>
  );
}

export default function Page() {
  const [name, setName, nameMeta] = useField("name", "", { label: "Your name", required: true });
  const [color, setColor, colorMeta] = useField("color", "red", { label: "Colour" });
  const [notes, setNotes, notesMeta] = useField("notes", "", { label: "Notes" });
  const [team, setTeam, teamMeta] = useField("team", "", { label: "Team", scope: "artifact" });
  const submit = useSubmit();
  const ping = useSignal("ping");
  const [candidate, setCandidate] = useState("dense");
  const choice = useChoice("layout", {
    candidates: [
      { id: "dense", label: "Dense" },
      { id: "airy", label: "Airy" },
    ],
    current: candidate,
  });
  const viewer = useViewer();
  const shown = useArtifact();
  const [result, setResult] = useState("");
  useSubmitControl({ label: "Send answers" });

  const attempt = async (fn: () => Promise<unknown>): Promise<void> => {
    try {
      const value = await fn();
      setResult(`ok:${JSON.stringify(value ?? null)}`);
    } catch (error) {
      setResult(`error:${(error as { code?: string }).code ?? String(error)}`);
    }
  };

  return (
    <main style={{ padding: 16, display: "grid", gap: 8, maxWidth: 480 }}>
      <label>
        Your name
        <input data-testid="name" name="name" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <span data-testid="name-save">{nameMeta.save}</span>
      <Conflict id="name" meta={nameMeta} />
      <label>
        Colour
        <input data-testid="color" value={color} onChange={(e) => setColor(e.target.value)} />
      </label>
      <span data-testid="color-save">{colorMeta.save}</span>
      <Conflict id="color" meta={colorMeta} />
      <label>
        Notes
        <textarea data-testid="notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>
      <span data-testid="notes-save">{notesMeta.save}</span>
      <label>
        Team (shared)
        <input data-testid="team" value={team} onChange={(e) => setTeam(e.target.value)} />
      </label>
      <span data-testid="team-by">{teamMeta.updatedBy?.kind ?? ""}</span>
      <Conflict id="team" meta={teamMeta} />
      <div>
        <button type="button" data-testid="show-dense" onClick={() => setCandidate("dense")}>
          Show dense
        </button>
        <button type="button" data-testid="show-airy" onClick={() => setCandidate("airy")}>
          Show airy
        </button>
        <span data-testid="choice">{choice.choice ?? ""}</span>
        <button type="button" data-testid="choose-airy" onClick={() => void attempt(() => choice.choose("airy"))}>
          Choose airy from the page
        </button>
      </div>
      <div>
        <span data-testid="submit-state">{submit.state}</span>
        <span data-testid="submit-allowed">{String(submit.allowed)}</span>
        <span data-testid="blockers">{submit.blockers.map((b) => `${b.fieldId}:${b.reason}`).join(",")}</span>
        <button type="button" data-testid="artifact-submit" onClick={() => void attempt(() => submit.submit())}>
          Submit from the page
        </button>
      </div>
      <button type="button" data-testid="ping" onClick={() => void attempt(() => ping.send({ at: 1 }))}>
        Ping
      </button>
      <button
        type="button"
        data-testid="storage-set"
        onClick={() => void attempt(() => window.storage.set("greeting", { text: "hello" }))}
      >
        Store
      </button>
      <button type="button" data-testid="storage-get" onClick={() => void attempt(() => window.storage.get("greeting"))}>
        Read
      </button>
      <span data-testid="result">{result}</span>
      <span data-testid="viewer">{viewer.name ?? ""}</span>
      <span data-testid="version">{shown.version}</span>
      <span data-testid="view">{shown.viewId}</span>
      <span data-testid="mode">{shown.mode}</span>
    </main>
  );
}
