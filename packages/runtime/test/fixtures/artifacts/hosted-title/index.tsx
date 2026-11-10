import { defineArtifact } from "@mostra/react";

// D161: an owner who opts in shows the title, and only the title, in a hosted link preview.
export const artifact = defineArtifact({
  title: "Plans & <ideas> for \"Q4\"",
  hosted: { preview: "title" },
});

export default function Page() {
  return <p>Our private plans, never in a preview.</p>;
}
