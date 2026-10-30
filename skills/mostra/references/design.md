# Design: pages people answer and work in

An artifact is a working page: someone reads it, decides, answers, acts. It succeeds when they understand it in five seconds and finish without help. Design is your choice entirely; nothing here is enforced. These are the defaults that make a page look considered, and the checks to run on its screenshots.

## Contents

- Start from the person's job
- The baseline stylesheet
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
4. **The look the subject asks for.** A finance review, a design critique and a team retro want different pages. Pick deliberately; the baseline below is quiet on purpose and a fine choice when nothing else is called for.

## The baseline stylesheet

Copy [`../assets/studio.css`](../assets/studio.css) into the artifact as `styles.css` and `import "./styles.css";` in the entry. It starts with `@import "tailwindcss";`, defines light and dark colors with shadcn's token names, and maps them to Tailwind utilities:

| Utility | Use |
|---|---|
| `bg-background`, `text-foreground` | The page |
| `bg-card`, `border` | Panels |
| `bg-muted`, `text-muted-foreground` | Secondary surfaces and text |
| `bg-primary`, `text-primary-foreground` | The one main action |
| `text-destructive`, `text-success`, `text-warning` | Status, in text |
| `bg-answer` | Marks what the person answered or chose (never text color) |
| `border-input`, `ring-ring` | Inputs and focus |
| `fill-chart-1` … `fill-chart-6`, `var(--chart-1)` | Chart series, in this order |

Three complete examples that pass verify use it, and are worth copying from: [`../assets/examples/decision/`](../assets/examples/decision/) (a choice with a reason), [`../assets/examples/inbox/`](../assets/examples/inbox/) (drafts with real Send actions) and [`../assets/examples/dashboard/`](../assets/examples/dashboard/) (live data and a shared list).

A stylesheet that defines `@theme` must start with `@import "tailwindcss";`, or its utilities silently don't exist and verify still passes; check the screenshot. Change any value, or replace the file with your own theme.

## Type

- One family is enough: the system sans the page already has, or one face you load from `public/` with `@font-face`. A second face only for code or figures (`font-mono`).
- Four to six sizes per page. For a working page: title `text-2xl` to `text-3xl` (24 to 30 px), section headings `text-base` to `text-lg` with `font-medium`, body `text-base` (16 px) or `text-sm` (14 px) for dense data, labels and meta `text-sm`. Titles on a working page stay modest; a 60 px headline makes it read as a landing page.
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
- Dark mode: the baseline follows the system's setting. Check both if the person may use either.
- Defaults that make a page look generated: a purple or indigo gradient, glowing buttons, glass panels, cream paper with a serif and a terracotta accent, neon on black, a colored icon in a tinted circle on every card. Use them only when the subject calls for exactly that.

## Layout and spacing

- Spacing on a 4 px grid (Tailwind's scale): tight inside a group (`gap-2`, `gap-3`), clear between groups (`gap-6`, `gap-8`), more space above a heading than below it.
- One left edge. Content in a centered column: `max-w-2xl` or `max-w-3xl` for a form or a decision, `max-w-5xl` to `max-w-6xl` for a dashboard, with `px-6` on the sides.
- Group with space and alignment first, a border second, a shadow rarely. A border or a shadow, never both. No cards inside cards.
- Cards in one row share their height. Pick the column count from the number of items: four figures in a row of four, not in a three-column grid with an orphan.
- One radius family (the baseline's `rounded-md` and `rounded-lg`); pills only for small buttons and tags.
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
- A figure is label above value: `text-sm text-muted-foreground` then `text-2xl font-semibold`. Several figures share one bordered strip with dividers rather than one card each.
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
