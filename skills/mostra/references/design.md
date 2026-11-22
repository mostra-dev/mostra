# Design: pages people answer and work in

An artifact is a working page: someone reads it, decides, answers, acts. It succeeds when they understand it in five seconds and finish without help. Design is your choice entirely; nothing here is enforced. These are the defaults that make a page look considered, and the checks to run on its screenshots.

## Contents

- Start from the person's job
- Themes
- The kit's parts
- Type
- Color
- Layout and spacing
- Components and states
- Forms and answers
- Numbers, tables and charts
- Motion
- Accessibility
- Words on the page
- Phones
- Reading your screenshots

## Start from the person's job

Before markup, write down:

1. **Who opens it and what they do.** "Ada picks one of two checkout layouts and says why."
2. **The one question the page answers**, and the block that answers it. That block is the largest and comes first.
3. **The real content.** Real names, numbers, units and dates from the task, with totals that add up. Placeholder names (Acme, John Doe), lorem ipsum and round invented figures make a page read as a mock-up.
4. **The look the subject asks for.** A finance review, a design critique and a team retro want different pages. When neither you nor the person has a design system in mind, wear one of Mostra's themes and build from the kit's parts: that is the look most pages should have. When the person's own brand or a design you're asked to match applies, build that instead; nothing here holds you to the kit.

## Themes

Every page wears a **theme stack**, named in its manifest. Each entry layers over the ones before it:

```tsx
export const artifact = defineArtifact({
  title: "Q3 hiring plan",
  kit: { theme: "studio" },                    // one theme
  // kit: { theme: ["arcata", "./brand.css"] }, // a theme, then your own layer over it
  // kit: { theme: "none" },                    // no theme: only Tailwind's defaults
});
```

| Theme | Looks like | Pick it for |
|---|---|---|
| `studio` | An editorial page: white grounds, black rules, square edges, large Jost headings, a red accent for what is recommended | Decisions, plans, reports, questionnaires: pages read closely |
| `arcata` | Flat fields of colour on round shapes, bold Jost, every choice filling with blue as it's made | Dashboards, sign-ups, quick polls: pages used at a glance, or anything that should feel friendly |

Both follow the person's light or dark setting and Mostra's switch, carry their own fonts (Figtree, Jost, Spline Sans Mono; no CDN), and meet WCAG 2.2 AA in both. A page that names no stack wears `studio`, and verify's output says so: name the theme you chose, so the next edit keeps it.

- **Try one without editing.** `mostra verify <dir> --theme arcata --screenshots always`, then look at both screenshots. `mostra theme list` lists the themes a page can wear, plugins' included.
- **See what a theme sets.** `mostra theme show studio` prints every token in light and dark; `mostra theme show <dir>` shows what the artifact wears; `--css` prints the stylesheet itself.
- **Your own layer.** A CSS file named in the stack (`"./brand.css"`) is read by the page's Tailwind run, so it can set any token and use `@theme`, `@apply` and `@variant`:

  ```css
  :root {
    --primary: oklch(0.52 0.16 152);
    --card-radius: 1rem;
    @variant dark {
      --primary: oklch(0.74 0.15 152);
    }
  }
  ```

  Check the screenshots after a layer: verify's accessibility check reports text it leaves below contrast. A stylesheet that uses `@theme` or `@apply` but is neither in the stack nor starts with `@import "tailwindcss";` does nothing, and verify says so (`MOSTRA_KIT_CSS_UNPROCESSED`).
- **Inside a chat app or a host's window** the page keeps its theme and follows the host's light or dark. Add `"host"` to the stack (`["studio", "host"]`) to take the host's own colors, corners and fonts as well.
- **Other themes** come from plugins ([plugins.md](plugins.md)).

## The kit's parts

shadcn's components, restyled by the theme, import with nothing installed:

```tsx
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Figure, Figures, Section } from "@mostra/kit/layout";

function WeekInNumbers() {
  return (
    <Section title="This week">
      <Figures>
        <Figure label="Signups" value="642" change="+5.1% vs last week" tone="good" />
        <Figure label="Checkout errors" value="1.9%" change="+0.7 points" tone="bad" />
      </Figures>
      <Card>
        <CardHeader>
          <CardTitle>Checkout errors</CardTitle>
        </CardHeader>
        <CardContent>
          <Button variant="outline">See the failing requests</Button>
        </CardContent>
      </Card>
    </Section>
  );
}
```

- **`@/components/ui/<name>`**: accordion, alert, alert-dialog, avatar, badge (also `accent`, `success`, `warning`), breadcrumb, button, calendar, card, chart, checkbox, collapsible, combobox, command, context-menu, dialog, drawer, dropdown-menu, empty, field, hover-card, input, input-group, input-otp, item, kbd, label, menubar, native-select, navigation-menu, pagination, popover, progress, radio-group, resizable, scroll-area, select, separator, sheet, sidebar, skeleton, slider, spinner, switch, table, tabs, textarea, toggle, toggle-group, tooltip, and the rest of shadcn's list.
- **`@mostra/kit/layout`**: `Page` (the title, the description and the column: `width="form" | "wide" | "full"`), `Section` (a block under its heading, `index` for numbered steps), `Figures` and `Figure` (a row of numbers: `label`, `value`, `change`, `tone="good" | "bad"`). They space and mark a page the way its theme does.
- **`@mostra/kit/questionnaire`**: questions, choices, scales, rankings and text answers, each a field ([answers.md](answers.md#questionnaires)).
- **Base UI is the base.** Its parts compose with `render`: `<DialogTrigger render={<Button variant="outline" />}>Open</DialogTrigger>`. For Radix's `asChild`, set `kit: { base: "radix" }`; each artifact uses one base, and verify names the other base's idiom (`MOSTRA_KIT_WRONG_BASE`) with the fix.
- **Editing a part.** `mostra add button dialog` copies the parts into `components/ui/` (and `mostra add mostra-layout` into `components/mostra/`); from then on the page uses your copy, which you edit like any file.
- **Every part takes `className`**, so a one-off change needs no copy: `<Button className="w-full">`.

The theme's utilities, for your own markup:

| Utility | Use |
|---|---|
| `bg-background`, `text-foreground` | The page |
| `bg-card`, `rounded-card`, `shadow-card` | Panels, as the theme draws them |
| `bg-muted`, `text-muted-foreground` | Secondary surfaces and text |
| `bg-primary`, `text-primary-foreground` | The one main action |
| `text-highlight` | The theme's accent for a word that matters (what is recommended) |
| `text-destructive`, `text-success`, `text-warning` | Status, in text |
| `bg-answer` | Marks what the person answered or chose (never text color) |
| `rounded-control`, `rounded-button`, `rounded-choice`, `border-input`, `ring-ring` | Inputs, buttons, choices and focus |
| `font-display`, `font-heading`, `font-mono` | The theme's display, heading and code faces |
| `fill-chart-1` … `fill-chart-6`, `var(--chart-1)` | Chart series, in this order |

Four complete examples that pass verify, worth copying from: [`../assets/examples/decision/`](../assets/examples/decision/) (a choice with a reason, in `studio`), [`../assets/examples/inbox/`](../assets/examples/inbox/) (drafts with real Send actions), [`../assets/examples/dashboard/`](../assets/examples/dashboard/) (live data and a shared list, in `arcata`) and [`../assets/examples/specimen/`](../assets/examples/specimen/) (every part on one page).

## Type

- The theme sets the faces and the headings: write plain `<h1>`, `<h2>` and `<h3>`, and they come out in the theme's sizes and its display face. One `<h1>` per page, the page's title.
- Without a theme, one family is enough: the system sans the page already has, or one face you load from `public/` with `@font-face`. A second face only for code or figures (`font-mono`).
- Four to six sizes per page: the theme's title and headings, body `text-base` (16 px) or `text-sm` (14 px) for dense data, labels and meta `text-sm`.
- Weights 400, 500 and 600; one heavier weight at most, for one thing.
- Body text at most about 70 characters per line (`max-w-prose`). Headings `text-balance`, paragraphs `text-pretty`.
- Secondary text is softer in color (`text-muted-foreground`), not smaller than 13 px and never lighter in weight.
- Sentence case for titles, labels and buttons. At most one small uppercase label per page.
- Use `…` for an ellipsis, curly quotes, and an en dash for ranges (9–5).

## Color

- Color goes on data, on status, on the selected answer and on one primary action. Everything else is neutral. On most good working pages only a few percent of the pixels are colored.
- One primary filled button per screen. Secondary actions are outlined or plain text.
- Status is said in words and shown in color: "Failed", in `text-destructive`, never a red dot alone.
- Every text color meets 4.5:1 contrast on its background (3:1 for large text), placeholders included. Disabled controls stay legible and say why they're disabled.
- Dark mode: a theme follows the person's setting and Mostra's switch. Check both if the person may use either.
- Defaults that make a page look generated: a purple or indigo gradient, glowing buttons, glass panels, cream paper with a serif and a terracotta accent, neon on black, a colored icon in a tinted circle on every card. Use them only when the subject calls for exactly that.

## Layout and spacing

- Spacing on a 4 px grid (Tailwind's scale): tight inside a group (`gap-2`, `gap-3`), clear between groups (`gap-6`, `gap-8`), more space above a heading than below it.
- One left edge. Content in a centered column: `Page` gives the theme's measure for a form or a decision and `width="wide"` for a dashboard; by hand, `max-w-3xl` or `max-w-6xl` with `px-6` on the sides.
- Group with space and alignment first, a border second, a shadow rarely. A border or a shadow, never both. No cards inside cards.
- Cards in one row share their height. Pick the column count from the number of items: four figures in a row of four, not in a three-column grid with an orphan.
- The theme's radii, one family: `rounded-card` for panels, `rounded-control` for inputs, `rounded-button` for buttons. The theme decides what is a pill.
- At 1280 × 800 the block that answers the question is visible without scrolling.

## Components and states

Build every state a person can meet, then look at each:

| State | Do |
|---|---|
| Loading | The final layout with gray blocks where values will be (`bg-muted`), no spinner over the page, no layout jump when data arrives |
| Empty | Keep the block and its heading; one sentence saying why it's empty and what to do ("No priorities yet. Add the first one below.") |
| Zero | Print it normally: `0`, `€0.00` |
| Missing | A dash `–` in muted text |
| Error | Inside the block that failed: what failed, when the data was last good, and a retry. Keep the person's input |
| Stale | "Updated 09:14" beside the data; a refresh button where it helps |
| Done | Say what happened ("Sent at 09:20"), and disable what can't happen twice |

Every control has hover, focus, active and disabled states. Buttons press slightly (`active:scale-[.97]`) and change color on hover; they don't lift or glow.

## Forms and answers

For questions, `@mostra/kit/questionnaire` does all of this ([answers.md](answers.md#questionnaires)). For a form of your own:

- The label sits above the field, always visible; a placeholder is an example, never the label. Inputs at least 40 px tall with `text-base` (16 px), which also keeps iOS from zooming.
- Group related fields under a `fieldset` with a `legend`. Choices among a few options are radio cards the person can see at once, not a dropdown.
- Say what's required and what format is expected before they type. Validate inline, next to the field, in plain words ("Enter a date after 1 November"), and tie the message with `aria-describedby`.
- Use `type="email"`, `inputMode="numeric"`, `autoComplete` and real `<label>`s, so phones and password managers help.
- Show the selected answer clearly (`has-checked:border-primary`, or `bg-answer` as a mark).
- One way to save: Mostra saves as they type, so add no Save button for answers. The trusted Submit is the only "done".
- A destructive action names its object and consequence ("Delete the 3 draft replies"), and asks to confirm, or offers undo.

## Numbers, tables and charts

- Numbers in tables, figures and anything that updates use `tabular-nums`, align right in columns, and keep a fixed number of decimals per measure. Format with `Intl.NumberFormat` and `Intl.DateTimeFormat`, in the person's locale.
- Every change names its baseline ("+12% vs last week"). Color says good or bad, not up or down.
- A figure is label above value, with its change beside its baseline: `Figures` and `Figure` from `@mostra/kit/layout` draw a row of them the theme's way. Several figures share one row rather than one card each.
- Tables: sentence-case headers in `text-sm text-muted-foreground`, thin row borders, no zebra stripes, the identifying column widest and never the one truncated. Truncate with an ellipsis and show the full text on hover or focus. Past about 50 rows, page or virtualize.
- Charts: one question per chart, one series in `var(--chart-1)` (more in the order of the chart colors, at most four), a few horizontal gridlines, labeled axes, a legend only for more than one series, no 3D, no gradients. Annotate the point the person should notice. A chart with three numbers is better as three numbers.

## Motion

- Motion is feedback: a press, a hover, a menu opening, a row arriving. A page people work in has no entrance animations.
- Durations: press 100 to 160 ms, hover and color 150 to 200 ms, menus and popovers 150 to 250 ms, dialogs and drawers 200 to 400 ms. Leaving takes a little less time than arriving.
- Ease out (`ease-out`, or `cubic-bezier(0.22, 1, 0.36, 1)`), no bounce. Animate `transform` and `opacity`, not size or position; list the properties (`transition-colors`, `transition-transform`), never `transition-all`.
- Popovers grow from their trigger, never from `scale(0)`. Things people do constantly (typing, keyboard shortcuts) don't animate at all.
- Respect `prefers-reduced-motion`: keep color and opacity changes, drop movement (`motion-safe:` and `motion-reduce:` in Tailwind, `useReducedMotion` in Motion).
- Hover effects behind `(hover: hover)` where a hover-only reveal would hide something on a phone.

## Accessibility

- Real elements: `<button>` for actions, `<a>` for navigation, `<label>` for every input, one `<h1>`, headings in order, `<main>`.
- Every icon-only button has `aria-label`; decorative icons have `aria-hidden`. Images have `alt`.
- Visible focus on everything focusable (`focus-visible:` ring; the baseline sets one). Everything works from the keyboard, in reading order.
- Live values and results that change announce politely (`aria-live="polite"`).
- Touch targets at least 44 × 44 px on phones.
- Verify runs axe on every render: critical and serious findings are warnings to fix.

## Words on the page

- The title says what the page is ("Checkout: which layout ships?"), not "Welcome". A one-line description under it says what you need and by when.
- Buttons say what they do, in a verb and an object: "Send my decision", "Approve the plan", "Add". Not "Submit", "OK" or "Click here".
- Use the task's own words for things, not "items" or "records". Say each thing once.
- No marketing words (seamless, effortless, unlock, supercharge) and no emoji as icons.

## Phones

- Check the 390 × 844 screenshot every time. One column; side padding `px-4` to `px-6`; nothing scrolls sideways.
- Rows of cards stack; tables become two-line rows (the identity and key number first, the rest smaller beneath) or scroll inside their own frame.
- The main action stays reachable without hunting.

## Reading your screenshots

Open both screenshots after every verify, and check:

1. Is the biggest, first thing the answer to the page's question?
2. Do the blocks share one left edge and one right edge? Any orphan card, ragged row or empty band?
3. Is color only on data, status, the chosen answer and one primary action?
4. Do numbers line up, add up, and name their baselines?
5. Does every empty, zero and loading value look like what it is?
6. Does each label, legend and caption match what it labels, with nothing colliding or cut off?
7. On the phone, does every block still work, with nothing sideways?

Fix the worst problems first, verify again, and look again. Two or three rounds are usually enough; stop when the screenshot shows what you meant.
