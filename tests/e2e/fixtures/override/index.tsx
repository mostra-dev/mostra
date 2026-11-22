import { defineArtifact } from "@mostra/react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

// Design freedom (KT-10): a className restyles a kit part, and a copy of a part in the artifact
// (`components/ui/button.tsx`, which the test writes from the kit's own) wins over the kit's.
export const artifact = defineArtifact({ title: "Override fixture", kit: { theme: "studio" } });

export default function Page() {
  return (
    <main className="p-8">
      <h1>Override fixture</h1>
      <Card data-testid="card" className="bg-[rgb(1,2,3)] text-[rgb(250,250,250)]">
        <CardContent>
          <Badge data-testid="badge">Kit badge</Badge>
          <Button data-testid="button">Copied button</Button>
        </CardContent>
      </Card>
    </main>
  );
}
