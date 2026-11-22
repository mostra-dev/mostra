# @mostra/kit

Mostra's kit: the parts an artifact's page is built from, in the theme its manifest names. Every
Mostra artifact has it with nothing installed (it is in the runtime's warm set), so a page just
imports what it uses:

```tsx
import { defineArtifact } from "@mostra/react";
import { Page, Section } from "@mostra/kit/layout";
import { Choice, Question, Questionnaire } from "@mostra/kit/questionnaire";
import { Button } from "@/components/ui/button";

export const artifact = defineArtifact({ title: "Sidebar redesign", kit: { theme: "studio" } });

export default function Sidebar() {
  return (
    <Page title="Sidebar redesign" description="Two questions, about a minute.">
      <Questionnaire id="sidebar">
        <Question id="layout" title="Which layout fits best?" required>
          <Choice value="left" recommended>Left rail</Choice>
          <Choice value="top">Top bar</Choice>
        </Question>
      </Questionnaire>
      <Section title="Before you answer">
        <Button variant="outline">See both layouts</Button>
      </Section>
    </Page>
  );
}
```

- **`@/components/ui/<name>`**: shadcn's components for the artifact's base (Base UI by default,
  Radix with `kit: { base: "radix" }`), restyled by the theme. `mostra add <name>` copies one into
  the artifact to edit; the copy then wins.
- **`@mostra/kit/questionnaire`**: questions with choices, scales, rankings and text, each answer a
  field, labelled in results.
- **`@mostra/kit/layout`**: the page, its sections and a row of figures.
- **Themes** (`kit: { theme }`) are `@mostra/themes`: `studio` and `arcata` ship, and plugins add
  more.

The Agent Skill's `design.md` is the guide (`mostra docs guide/design`).

Part of [Mostra](https://github.com/mostra-dev/mostra), the agent artifact runtime. Apache-2.0;
the registry's components are shadcn's (MIT), with their license in `registry/LICENSE.md`.
