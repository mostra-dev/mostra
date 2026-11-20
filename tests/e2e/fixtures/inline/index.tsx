import {
  defineArtifact,
  useAction,
  useArtifact,
  useChoice,
  useField,
  usePresence,
} from "@mostra/react";
import { useState } from "react";
import { count, greet } from "./actions";

// It takes the chat host's look: a page keeps its own theme unless its stack names "host" (D179 item 5).
export const artifact = defineArtifact({ title: "Inline fixture", kit: { theme: ["studio", "host"] } });

const CANDIDATES = [
  { id: "dense", label: "Dense" },
  { id: "airy", label: "Airy" },
];

/**
 * A page for an MCP Apps host (WP-17): a required field, a server function called directly, as a
 * run and as a stream, presence, a review set's choice, a review surface, an embedded frame and an
 * image from an origin outside the page: each feature a chat host's frame lacks.
 */
export default function Page() {
  const [name, setName] = useField("name", "", { label: "Your name", required: true });
  const greeting = useAction(greet);
  const [called, setCalled] = useState("");
  const [counted, setCounted] = useState("");
  const presence = usePresence();
  const { choice } = useChoice("layout", { candidates: CANDIDATES, current: "dense" });
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
      <button
        type="button"
        data-testid="count"
        onClick={() =>
          void (async () => {
            const seen: number[] = [];
            for await (const value of await count()) seen.push(value);
            setCounted(seen.join(","));
          })()
        }
      >
        Count
      </button>
      <p data-testid="counted">{counted}</p>
      <p data-testid="presence">{presence.status}</p>
      <p data-testid="choice">{choice ?? ""}</p>
      <section data-review-id="summary">Summary</section>
      <img data-testid="outside" alt="" width={1} height={1} src="https://images.example.com/dot.png" />
      <iframe title="demo" width={10} height={10} src="https://frames.example.com/" />
    </main>
  );
}
