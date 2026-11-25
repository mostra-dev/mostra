# Review: candidates, comments and choices

Use a review set when the person should compare candidates and pick one, and read their comments when they point at something on the page. Comments need nothing from you: Mostra's frame around your page has a **Comment** button, and the person pins a comment on anything they see.

## Review sets

```tsx
import { defineArtifact } from "@mostra/react";
import { Candidate, ReviewSet } from "@mostra/kit/review";

export const artifact = defineArtifact({ title: "Sidebar: which one ships?", family: "review" });

export default function Page() {
  return (
    <ReviewSet id="sidebar" layout="compare" choose>
      <Candidate id="dense" label="Dense"><SidebarDense /></Candidate>
      <Candidate id="airy" label="Airy"><SidebarAiry /></Candidate>
      <Candidate id="roomy" label="Roomy"><SidebarRoomy /></Candidate>
    </ReviewSet>
  );
}
```

| `layout` | What the person sees |
|---|---|
| `gallery` (default) | Every candidate in a grid |
| `focus` | One candidate at a time, with a switcher |
| `compare` | Two to four side by side, scrolled together, with a **Difference** view that shows where two candidates differ, pixel by pixel |

- `choose` asks for Mostra's trusted **Choose** button for the candidate in view. The choice is the field `review.<id>.choice` and arrives in results' `choices` with its label.
- Give every candidate a stable `id` and a short `label`: the button reads "Choose Airy", and a phone shortens a long label.
- Mark the parts people will talk about with `data-review-id` (`<h2 data-review-id="sidebar.title">`). A comment on them names that ID, which is the handle you act on.

Your own review set without the kit: `useChoice(id, { candidates, current })` for the choice ([answers.md](answers.md)) and `useReviewSurface({ id, layout, candidates, current })` so comments record the candidate.

## Reading the review

`mostra results <dir>` lists the comments with everything else the person sent. For the review alone, with every comment's place and a picture of it:

```bash
mostra review export <dir> --out ./review
```

It writes `review/review.md` (or `review.json` with `--format json`) and `review/crops/<thread>.png`. Each comment says where it points, finest first:

| Layer | Example | Use it to |
|---|---|---|
| Review ID | `review ID header.title` | Find the element you marked |
| Data point | `chart-datum` Revenue, March | Find the series and point of a chart |
| Candidate | `sidebar`/`airy` | Know which candidate the comment is about |
| Selectors | CSS path, quoted text | Find an element you didn't mark |
| Selected words | `the selected words "…"` (`selection: true`) | Know exactly which of your words the person answered |
| Box | x, y, width, height at the viewport's size | Find a place on a canvas, an image or an embedded page |
| Crop | `crops/<thread>.png` | Look at exactly what the person saw (open it) |

Open the crops before you change anything: they show the place, outlined in blue. A comment's crop can be `pending` for a few seconds after it was made, and a submission waits for its crops. Without `--submission`, export shows the threads as they stand now; with it, the review that submission carried.

Mentions (`@Grace`) reach hosts as `review.mentioned` events, which a host can route to the person mentioned. Mostra itself notifies nobody.

## Anchoring your own content

A chart drawn with the kit's chart part already anchors comments to its series and data point. For content of your own whose places the page can name better than a box (a map's region, a table's cell range, a seat), register an anchor provider once, at the top of a module:

```tsx
import { registerAnchorProvider } from "@mostra/react";

registerAnchorProvider({
  id: "seat",
  kind: "seat",
  matches: ({ target }) => target.closest("[data-seat]") !== null,
  serialize: ({ target }) => {
    const seat = target.closest("[data-seat]")?.getAttribute("data-seat");
    return seat ? { anchor: { seat }, label: `Seat ${seat}` } : undefined;
  },
  resolve: ({ anchor, root }) => {
    const element = root.querySelector(`[data-seat="${String(anchor.seat)}"]`);
    return element ? { element } : undefined;
  },
});

function SeatMap() {
  return (
    <div className="grid grid-cols-4 gap-2">
      {["A1", "A2", "A3", "A4"].map((seat) => (
        <button key={seat} type="button" data-seat={seat} className="rounded border p-2">
          {seat}
        </button>
      ))}
    </div>
  );
}
```
