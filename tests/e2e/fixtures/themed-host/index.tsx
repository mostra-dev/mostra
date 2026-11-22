import { defineArtifact } from "@mostra/react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// The themed fixture, its stack naming the host's look over Studio (D181 item 5).
export const artifact = defineArtifact({ title: "Themed fixture", kit: { theme: ["studio", "host"] } });

export default function Page() {
  return (
    <main className="mx-auto max-w-xl p-6">
      <h1>Themed fixture</h1>
      <Card data-testid="card">
        <CardHeader>
          <CardTitle>A card</CardTitle>
        </CardHeader>
        <CardContent>
          <Button data-testid="button">A button</Button>
        </CardContent>
      </Card>
    </main>
  );
}
