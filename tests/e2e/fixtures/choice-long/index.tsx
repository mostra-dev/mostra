/**
 * A choice whose candidates have long labels (#182, #188): on a phone the shell's bar repeats the
 * current candidate's label in its Choose button, beside the trusted Submit, and both must stay
 * whole and pressable; a label past the Submit's 48 characters still gets its Choose, cut with an
 * ellipsis where the bar has no room, its whole name kept for assistive technology and results.
 */
import { defineArtifact, useChoice, useField, useSubmitControl } from "@mostra/react";
import { useState } from "react";

export const artifact = defineArtifact({ title: "Next week's focus" });

const FOCUS = [
  { id: "mockups", label: "Finish the Harbor Coffee mockups for the review" },
  { id: "approvals", label: "Clear every approval waiting three days or more" },
  {
    id: "launch",
    label:
      "Write the launch post, record the walkthrough video, and answer every reply on the first day",
  },
] as const;

export default function Page() {
  const [why, setWhy] = useField("why", "", { label: "Why", required: true });
  const [shown, setShown] = useState<string>(FOCUS[0].id);
  useChoice("focus", { candidates: [...FOCUS], current: shown });
  useSubmitControl({ label: "Send my answers" });
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: 20 }}>
      <h1>Next week's focus</h1>
      <div role="tablist" aria-label="Focus">
        {FOCUS.map((focus) => (
          <button
            key={focus.id}
            type="button"
            role="tab"
            aria-selected={shown === focus.id}
            data-testid={`focus-${focus.id}`}
            onClick={() => setShown(focus.id)}
          >
            {focus.label}
          </button>
        ))}
      </div>
      <label>
        Why
        <textarea data-testid="why" value={why} onChange={(event) => setWhy(event.target.value)} />
      </label>
    </main>
  );
}
