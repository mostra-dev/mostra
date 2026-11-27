import { WebDemo } from "@mostra/kit/demo";
import { defineArtifact } from "@mostra/react";
import { useState } from "react";

/**
 * Three demos built from their source into the version (D185): a Vite app and a Next.js static
 * export that move between pages by browser history, and a Vite app that moves by hash.
 */
export const artifact = defineArtifact({
  title: "Demos",
  demos: {
    vite: { source: "./apps/vite", build: ["npx", "--no", "vite", "build"], output: "dist" },
    next: { source: "./apps/next", build: ["npx", "--no", "next", "build"], output: "out" },
    hash: {
      source: "./apps/hash",
      build: ["npx", "--no", "vite", "build"],
      output: "dist",
      routing: "hash",
    },
  },
});

export default function Page() {
  const [heard, setHeard] = useState("nothing yet");
  return (
    <main className="space-y-8 p-6">
      <h1 className="text-2xl">The demos</h1>
      <section data-testid="vite">
        <WebDemo demo="vite" device="laptop" devices={false} title="Vite demo" />
      </section>
      <section data-testid="next">
        <WebDemo demo="next" device="laptop" devices={false} title="Next.js demo" />
      </section>
      <section data-testid="hash">
        <WebDemo
          demo="hash"
          device="laptop"
          devices={false}
          title="Hash demo"
          values={{ greeting: "Hello from the page" }}
          onMessage={(data) => {
            const told = (data as { "demo/told"?: string } | null)?.["demo/told"];
            if (told !== undefined) setHeard(told);
          }}
        />
        <p data-testid="heard">{heard}</p>
      </section>
    </main>
  );
}
