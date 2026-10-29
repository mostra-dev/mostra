/**
 * Worker mode's end-to-end fixture (WP-13, D70): a page that registers service workers of its
 * own, at the root scope and at a narrower one. In a worker-mode frame neither can run with the
 * page's session, so the client runtime refuses both with `MOSTRA_HYGIENE_FRAME_SESSION`; in
 * cookie mode both register. A field saves through the frame session either way.
 */
import { defineArtifact, useField } from "@mostra/react";
import { useState } from "react";

export const artifact = defineArtifact({ title: "Worker-mode fixture" });

export default function Page() {
  const [note, setNote] = useField("note", "", { label: "A note" });
  const [root, setRoot] = useState("not tried");
  const [narrow, setNarrow] = useState("not tried");
  const register = async (scope: string, done: (outcome: string) => void): Promise<void> => {
    try {
      await navigator.serviceWorker.register("/own-worker.js", { scope });
      done("registered");
    } catch (error) {
      const code = (error as { code?: string }).code;
      done(code ?? `failed: ${String(error)}`);
    }
  };
  return (
    <main>
      <h1>Worker mode</h1>
      <label>
        A note
        <input data-testid="note" value={note} onChange={(event) => setNote(event.target.value)} />
      </label>
      <button type="button" data-testid="root" onClick={() => void register("/", setRoot)}>
        Register a worker at /
      </button>
      <p data-testid="root-outcome">{root}</p>
      <button type="button" data-testid="narrow" onClick={() => void register("/app/", setNarrow)}>
        Register a worker at /app/
      </button>
      <p data-testid="narrow-outcome">{narrow}</p>
    </main>
  );
}
