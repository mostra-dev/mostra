import "./styles.css";
import { defineArtifact, useField, useSubmitControl } from "@mostra/react";

export const artifact = defineArtifact({
  title: "Checkout: which layout ships?",
  description:
    "Two layouts passed review. Pick the one to ship on Monday and tell me what to change; I need your answer by Friday.",
  family: "proposal",
  submission: { policy: "once" },
});

const LAYOUTS = [
  {
    id: "single-page",
    name: "Single page",
    summary: "Address, delivery and payment on one scrolling page.",
    facts: [
      ["Steps", "1"],
      ["Median time in test", "1 min 48 s"],
      ["Abandoned in test", "9 of 40"],
    ],
  },
  {
    id: "three-steps",
    name: "Three steps",
    summary: "One screen each for address, delivery and payment, with a summary at the side.",
    facts: [
      ["Steps", "3"],
      ["Median time in test", "2 min 05 s"],
      ["Abandoned in test", "5 of 40"],
    ],
  },
] as const;

export default function Page() {
  const [layout, setLayout] = useField("layout", "", { label: "Layout to ship", required: true });
  const [changes, setChanges] = useField("changes", "", { label: "Changes before shipping" });
  useSubmitControl({ label: "Send my decision" });

  return (
    <main className="mx-auto max-w-3xl px-6 py-12 sm:py-16">
      <header className="max-w-prose">
        <h1 className="text-3xl font-semibold tracking-tight">{artifact.title}</h1>
        <p className="mt-3 text-base text-muted-foreground">{artifact.description}</p>
      </header>

      <fieldset className="mt-10">
        <legend className="text-sm font-medium">Layout to ship</legend>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          {LAYOUTS.map((option) => (
            <label
              key={option.id}
              className="group relative flex cursor-pointer flex-col rounded-lg border bg-card p-5 transition-colors hover:border-input has-checked:border-primary has-checked:ring-1 has-checked:ring-primary"
            >
              <span className="flex items-center gap-3">
                <input
                  type="radio"
                  name="layout"
                  value={option.id}
                  checked={layout === option.id}
                  onChange={() => setLayout(option.id)}
                  className="size-4 accent-primary"
                />
                <span className="font-medium">{option.name}</span>
              </span>
              <span className="mt-2 text-sm text-muted-foreground">{option.summary}</span>
              <dl className="mt-4 space-y-1.5 border-t pt-4 text-sm">
                {option.facts.map(([term, value]) => (
                  <div key={term} className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">{term}</dt>
                    <dd className="font-medium tabular-nums">{value}</dd>
                  </div>
                ))}
              </dl>
            </label>
          ))}
        </div>
      </fieldset>

      <label className="mt-8 block">
        <span className="text-sm font-medium">Changes before shipping</span>
        <span className="mt-1 block text-sm text-muted-foreground">
          Optional. Anything you want different in the layout you picked.
        </span>
        <textarea
          value={changes}
          onChange={(event) => setChanges(event.target.value)}
          rows={4}
          className="mt-2 block w-full rounded-md border border-input bg-background px-3 py-2 text-base shadow-xs placeholder:text-muted-foreground"
          placeholder="For example: keep the order summary visible on phones…"
        />
      </label>
    </main>
  );
}
