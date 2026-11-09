import { defineArtifact, useField } from "@mostra/react";

// RM-03: a project two accounts both host, copied with its manifest, so with one artifact ID and,
// built by one runtime, one version ID.
export const artifact = defineArtifact({
  id: "art_01JC0PYQ3TENANCY0000000000",
  title: "A copied project",
  submission: { policy: "once", scope: "per-viewer" },
});

export default function Page() {
  const [answer, setAnswer] = useField("answer", "", { label: "Answer" });
  return <input value={answer} onChange={(event) => setAnswer(event.target.value)} />;
}
