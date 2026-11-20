import { Page } from "@mostra/kit/layout";
import { Choice, Question, Questionnaire, TextAnswer } from "@mostra/kit/questionnaire";
import { defineArtifact, useSubmitControl } from "@mostra/react";

export const artifact = defineArtifact({
  title: "Checkout: which layout ships?",
  description:
    "Two layouts passed review. Pick the one to ship on Monday and tell me what to change; I need your answer by Friday.",
  family: "proposal",
  submission: { policy: "once" },
  kit: { theme: "studio" },
});

const LAYOUTS = [
  {
    id: "single-page",
    name: "Single page",
    summary:
      "Address, delivery and payment on one scrolling page. Median time in the test: 1 min 48 s.",
    facts: "9 of 40 gave up in the test",
  },
  {
    id: "three-steps",
    name: "Three steps",
    summary:
      "One screen each for address, delivery and payment, with a summary at the side. Median time in the test: 2 min 05 s.",
    facts: "5 of 40 gave up in the test",
    recommended: "Fewer people gave up in the test",
  },
] as const;

export default function Decision() {
  useSubmitControl({ label: "Send my decision" });
  return (
    <Page>
      <Questionnaire
        id="decision"
        title={artifact.title}
        description={artifact.description}
        progress={false}
      >
        <Question id="layout" title="Which layout ships?" label="Layout to ship" required>
          {LAYOUTS.map((layout) => (
            <Choice
              key={layout.id}
              value={layout.id}
              description={layout.summary}
              meta={layout.facts}
              {...("recommended" in layout ? { recommended: layout.recommended } : {})}
            >
              {layout.name}
            </Choice>
          ))}
        </Question>
        <Question
          id="changes"
          title="What should change before it ships?"
          label="Changes before shipping"
          description="Optional. Anything you want different in the layout you picked."
        >
          <TextAnswer
            multiline
            placeholder="For example: keep the order summary visible on phones…"
          />
        </Question>
      </Questionnaire>
    </Page>
  );
}
