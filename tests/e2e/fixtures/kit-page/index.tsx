import { Page, Section } from "@mostra/kit/layout";
import { Choice, Question, Questionnaire } from "@mostra/kit/questionnaire";
import { defineArtifact } from "@mostra/react";
import { Button } from "@/components/ui/button";

export const artifact = defineArtifact({
  title: "A page with a questionnaire",
  kit: { theme: "studio" },
});

/**
 * #242: a questionnaire with a title inside a Page, and a lone button in the Page's column; a link
 * card there still spans it (Opus review of WP-19, finding 8).
 */
export default function Questions() {
  return (
    <Page title="Quarterly review" description="Three questions, then send the summary.">
      <Section title="Context">
        <p>Answer for the quarter that just ended.</p>
      </Section>
      <Questionnaire id="review" title="Your answers">
        <Question id="pace" title="How was the pace?">
          <Choice value="slow">Too slow</Choice>
          <Choice value="right">About right</Choice>
          <Choice value="fast">Too fast</Choice>
        </Question>
      </Questionnaire>
      <Button variant="outline">Send the summary</Button>
      <a href="#last-quarter" className="block rounded-(--radius) border border-border p-4">
        Last quarter's answers
      </a>
    </Page>
  );
}
