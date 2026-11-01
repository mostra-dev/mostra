import "./styles.css";
import { defineArtifact, useField, useLive } from "@mostra/react";
import { useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export const artifact = defineArtifact({
  title: "Deploys this week",
  description: "Updated every minute. Tick off priorities as they land; I read the list too.",
  family: "dashboard",
  submission: { policy: "none" },
});

interface Priority {
  readonly id: string;
  readonly title: string;
  readonly done: boolean;
}

function Figure({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="px-5 py-4">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold tabular-nums">{value}</dd>
      <dd className="mt-1 text-sm text-muted-foreground">{note}</dd>
    </div>
  );
}

export default function Page() {
  const live = useLive("deploys");
  const [priorities, setPriorities] = useField("priorities", [] as Priority[], {
    label: "Priorities",
    scope: "artifact",
  });
  const [draft, setDraft] = useState("");
  const data = live.data;

  const add = () => {
    const title = draft.trim();
    if (title === "") return;
    setPriorities((list) => [...list, { id: crypto.randomUUID(), title, done: false }]);
    setDraft("");
  };

  return (
    <main className="mx-auto max-w-5xl px-6 py-12">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">{artifact.title}</h1>
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {live.error
            ? "Couldn't refresh; showing the last good numbers."
            : live.at
              ? `Updated ${new Date(live.at).toLocaleTimeString()}`
              : "Loading…"}
        </p>
      </header>

      <dl className="mt-8 grid divide-y rounded-lg border bg-card sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        <Figure
          label="Deploys today"
          value={data ? String(data.today) : "–"}
          note="since midnight"
        />
        <Figure
          label="Failed today"
          value={data ? String(data.failed) : "–"}
          note="rolled back automatically"
        />
        <Figure
          label="Median deploy time"
          value={data ? `${data.medianMinutes.toFixed(1)} min` : "–"}
          note="last 50 deploys"
        />
      </dl>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_20rem]">
        <section className="rounded-lg border bg-card p-5">
          <h2 className="font-medium">Deploys per day</h2>
          <div className="mt-4 h-56">
            {data ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={[...data.lastDays]}
                  margin={{ top: 4, right: 4, bottom: 0, left: -20 }}
                >
                  <CartesianGrid vertical={false} stroke="var(--border)" />
                  <XAxis dataKey="day" tickLine={false} axisLine={false} fontSize={12} />
                  <YAxis allowDecimals={false} tickLine={false} axisLine={false} fontSize={12} />
                  <Tooltip cursor={{ fill: "var(--muted)" }} />
                  <Bar
                    dataKey="deploys"
                    name="Deploys"
                    fill="var(--chart-1)"
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full rounded-md bg-muted" />
            )}
          </div>
        </section>

        <section className="rounded-lg border bg-card p-5">
          <h2 className="font-medium">Priorities</h2>
          {priorities.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">
              Nothing yet. Add the first one below.
            </p>
          ) : (
            <ul className="mt-3 space-y-2">
              {priorities.map((item) => (
                <li key={item.id}>
                  <label className="flex items-start gap-3 text-sm">
                    <input
                      type="checkbox"
                      checked={item.done}
                      onChange={() =>
                        setPriorities((list) =>
                          list.map((p) => (p.id === item.id ? { ...p, done: !p.done } : p)),
                        )
                      }
                      className="mt-0.5 size-4 accent-primary"
                    />
                    <span className={item.done ? "text-muted-foreground line-through" : ""}>
                      {item.title}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          <form
            className="mt-4 flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              add();
            }}
          >
            <label className="sr-only" htmlFor="new-priority">
              New priority
            </label>
            <input
              id="new-priority"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Add a priority…"
              className="min-w-0 flex-1 rounded-md border border-input bg-background px-3 py-1.5 text-sm"
            />
            <button
              type="submit"
              className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted"
            >
              Add
            </button>
          </form>
        </section>
      </div>
    </main>
  );
}
