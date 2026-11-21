import { Figure, Figures, Page } from "@mostra/kit/layout";
import { defineArtifact, useField, useLive } from "@mostra/react";
import { useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";

export const artifact = defineArtifact({
  title: "Deploys this week",
  description: "Updated every minute. Tick off priorities as they land; I read the list too.",
  family: "dashboard",
  submission: { policy: "none" },
  kit: { theme: "arcata" },
});

interface Priority {
  readonly id: string;
  readonly title: string;
  readonly done: boolean;
}

export default function Dashboard() {
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
    <Page
      width="wide"
      title={artifact.title}
      description={artifact.description}
      meta={
        <span aria-live="polite">
          {live.error
            ? "Couldn't refresh; showing the last good numbers."
            : live.at
              ? `Updated ${new Date(live.at).toLocaleTimeString()}`
              : "Loading…"}
        </span>
      }
    >
      <Figures>
        <Figure
          label="Deploys today"
          value={data ? String(data.today) : "–"}
          change="since midnight"
        />
        <Figure
          label="Failed today"
          value={data ? String(data.failed) : "–"}
          change="rolled back automatically"
          tone={data && data.failed > 0 ? "bad" : "neutral"}
        />
        <Figure
          label="Median deploy time"
          value={data ? `${data.medianMinutes.toFixed(1)} min` : "–"}
          change="last 50 deploys"
        />
      </Figures>

      <div className="grid gap-(--stack-gap) lg:grid-cols-[1fr_22rem]">
        <Card>
          <CardHeader>
            <CardTitle>Deploys per day</CardTitle>
          </CardHeader>
          <CardContent className="h-56">
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
              <div className="h-full rounded-control bg-muted" />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Priorities</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {priorities.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing yet. Add the first one below.</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {priorities.map((item) => (
                  <li key={item.id} className="flex items-start gap-3 text-sm">
                    <Checkbox
                      id={`priority-${item.id}`}
                      checked={item.done}
                      onCheckedChange={() =>
                        setPriorities((list) =>
                          list.map((p) => (p.id === item.id ? { ...p, done: !p.done } : p)),
                        )
                      }
                      className="mt-0.5"
                    />
                    <label
                      htmlFor={`priority-${item.id}`}
                      className={item.done ? "text-muted-foreground line-through" : ""}
                    >
                      {item.title}
                    </label>
                  </li>
                ))}
              </ul>
            )}
            <form
              className="flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                add();
              }}
            >
              <Input
                aria-label="New priority"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="Add a priority…"
                className="min-w-0 flex-1"
              />
              <Button type="submit" variant="outline">
                Add
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </Page>
  );
}
