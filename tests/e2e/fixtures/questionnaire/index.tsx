import { defineArtifact } from "@mostra/react";
import {
  Choice,
  Other,
  Question,
  Questionnaire,
  Rank,
  Scale,
  Section,
  TextAnswer,
} from "@mostra/kit/questionnaire";

export const artifact = defineArtifact({ title: "Sidebar redesign" });

export default function Page() {
  return (
    <main className="mx-auto w-full max-w-(--page-width) px-6 py-(--page-pad)">
      <Questionnaire id="intake" title="Sidebar redesign" description="Six questions.">
        <Section title="Layout">
          <Question id="layout" title="Which layout fits best?" required comments>
            <Choice value="left" recommended description="Matches the current navigation">
              Left rail
            </Choice>
            <Choice value="top">Top bar</Choice>
          </Question>
          <Question id="density" title="How dense should it be?">
            <Scale min={1} max={5} labels={["Airy", "Dense"]} />
          </Question>
          <Question id="extras" title="Which sections should it show?" multiple>
            <Choice value="search">Search</Choice>
            <Choice value="recents" recommended>
              Recents
            </Choice>
            <Other />
          </Question>
        </Section>
        <Section title="Priorities">
          <Question id="order" title="Put these in order">
            <Rank items={["Search", "Recents", "Pins"]} />
          </Question>
          <Question id="team" title="Who reviews it first?">
            <Choice value="design">Design</Choice>
            <Choice value="eng">Engineering</Choice>
          </Question>
          <Question id="notes" title="Anything else?">
            <TextAnswer />
          </Question>
        </Section>
      </Questionnaire>
    </main>
  );
}
