import { Page, Section } from "@mostra/kit/layout";
import { Choice, Question, Questionnaire } from "@mostra/kit/questionnaire";
import { defineArtifact } from "@mostra/react";

export const artifact = defineArtifact({ title: "An older copy of the layout" });

// The artifact holds the layout as Mostra 0.20.0's `mostra add mostra-layout` copied it, before
// the questionnaire read whether it sits in a Page (#242; Opus review of WP-19, finding 3).
export default function OlderLayout() {
  return (
    <Page title="Retro">
      <Section title="This week">
        <Questionnaire id="retro" title="Your answers">
          <Question id="pace" title="How was the pace?">
            <Choice value="slow">Slow</Choice>
            <Choice value="right">Right</Choice>
          </Question>
        </Questionnaire>
      </Section>
    </Page>
  );
}
