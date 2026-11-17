import { defineArtifact, useAction, useArtifact, useField, usePresence } from "@mostra/react";
import { useState } from "react";
import { greet } from "./actions";

export const artifact = defineArtifact({ title: "Inline fixture" });

/**
 * A page for an MCP Apps host (WP-17): a required field, a server function called directly and as
 * a run, presence, and an image from an origin outside the page.
 */
export default function Page() {
  const [name, setName] = useField("name", "", { label: "Your name", required: true });
  const greeting = useAction(greet);
  const [called, setCalled] = useState("");
  const presence = usePresence();
  const { mode } = useArtifact();
  return (
    <main>
      <p data-testid="mode">{mode}</p>
      <label>
        Your name
        <input data-testid="name" value={name} onChange={(event) => setName(event.target.value)} />
      </label>
      <button type="button" data-testid="call" onClick={() => void greet(name).then(setCalled)}>
        Call
      </button>
      <p data-testid="called">{called}</p>
      <button type="button" data-testid="run" onClick={() => void greeting.run(name)}>
        Run
      </button>
      <p data-testid="ran">{greeting.data ?? ""}</p>
      <p data-testid="presence">{presence.status}</p>
      <img data-testid="outside" alt="" width={1} height={1} src="https://images.example.com/dot.png" />
    </main>
  );
}
