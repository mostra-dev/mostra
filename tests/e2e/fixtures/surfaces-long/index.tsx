/**
 * UX-01's surfaces fixture with a title that won't break: the chrome must keep its layout.
 */
import { defineArtifact, useField } from "@mostra/react";

export const artifact = defineArtifact({
  title:
    "Quarterly-planning-retrospective-for-the-platform-infrastructure-and-developer-experience-working-group-2026",
});

const DAYS = ["Monday 7 December", "Tuesday 8 December", "Wednesday 9 December"];

export default function Page() {
  const [day, setDay] = useField("day", "", { label: "Which day suits you?", required: true });
  const [notes, setNotes] = useField("notes", "", { label: "Anything the agent should know?" });
  return (
    <main
      style={{
        fontFamily: "system-ui, sans-serif",
        maxWidth: 560,
        margin: "0 auto",
        padding: "32px 20px",
        lineHeight: 1.5,
      }}
    >
      <h1 style={{ fontSize: 28, margin: "0 0 8px" }}>Pick the launch day</h1>
      <p style={{ margin: "0 0 24px", opacity: 0.75 }}>
        Three days work for the team. Choose one and say why; the agent books the room once
        everyone has answered.
      </p>
      <fieldset style={{ border: 0, padding: 0, margin: "0 0 20px", display: "grid", gap: 8 }}>
        <legend style={{ fontWeight: 600, marginBottom: 8 }}>Which day suits you?</legend>
        {DAYS.map((label) => (
          <label key={label} style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="radio"
              name="day"
              data-testid={`day-${label.split(" ")[0]}`}
              checked={day === label}
              onChange={() => setDay(label)}
            />
            {label}
          </label>
        ))}
      </fieldset>
      <label style={{ display: "grid", gap: 6 }}>
        <span style={{ fontWeight: 600 }}>Anything the agent should know?</span>
        <textarea
          data-testid="notes"
          rows={3}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
        />
      </label>
    </main>
  );
}
