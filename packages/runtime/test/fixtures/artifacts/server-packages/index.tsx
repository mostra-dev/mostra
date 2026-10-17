import { defineArtifact } from "@mostra/react";

export const artifact = defineArtifact({ title: "Server packages" });

export default function Page() {
  return <main>Packages that run from their own directories (D135).</main>;
}
