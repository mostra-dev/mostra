import { defineArtifact } from "@mostra/react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// The kit's tokens as Studio, the default, makes them; `themed-host` names the host's look too.
export const artifact = defineArtifact({ title: "Themed fixture" });

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
