"use client";

/**
 * Review sets (ROUND-3 §2, D23, RV-03): candidates a person compares, comments on and chooses
 * between. A `<ReviewSet>` lays its `<Candidate>`s out as a gallery (every candidate in a grid), a
 * focus view (one at a time) or a compare view (two to four side by side, scrolled together, with
 * a difference view that shows, pixel by pixel, where two candidates differ). With `choose`, the
 * shell draws its trusted Choose for the candidate in view, outside the page (D06, D113), and the
 * choice is the field `review.<id>.choice`, delivered with the submission. Each candidate is marked
 * for the shell's review overlay, so a comment on it records the set and the candidate.
 *
 * Ordinary React on the theme's tokens, the same in either base; every part takes `className`, and
 * `mostra add mostra-review` copies it into the artifact for editing (D68, KT-10).
 */

import { useChoice, useReviewSurface } from "@mostra/react";
import { cn } from "cn";
import * as React from "react";

/** How a review set lays its candidates out. */
export type ReviewLayout = "gallery" | "focus" | "compare";

interface CandidateInfo {
  readonly id: string;
  readonly label?: string;
}

interface SetContext {
  readonly layout: ReviewLayout;
  /** The candidates shown: one in focus, two to four in compare, every one in a gallery. */
  readonly shown: readonly string[];
  /** The candidate in view: the one the trusted Choose names. */
  readonly current?: string;
  readonly chosen?: string;
  /** Makes a candidate the one in view: a click inside it, or the focus moving into it. */
  readonly look: (candidate: string) => void;
  /** Whether each candidate shows its name above it: side by side, never stacked for the difference. */
  readonly captions: boolean;
}

const ReviewSetContext = React.createContext<SetContext | null>(null);

/** {@link Candidate}'s props. */
export interface CandidateProps extends Omit<React.ComponentProps<"section">, "id"> {
  /** The candidate's ID: the choice's value, stable across versions. */
  readonly id: string;
  /** Its name for people: what Choose says ("Choose Airy"), and what results name. */
  readonly label?: string;
}

/** One candidate of a review set: its content, marked for comments. */
export function Candidate({
  id,
  label,
  className,
  children,
  onPointerDownCapture,
  onFocusCapture,
  ...props
}: CandidateProps): React.JSX.Element | null {
  const set = React.useContext(ReviewSetContext);
  if (set === null) throw new Error("<Candidate> belongs inside a <ReviewSet>.");
  if (!set.shown.includes(id)) return null;
  const chosen = set.chosen === id;
  const current = set.current === id && set.layout !== "focus";
  return (
    <section
      data-slot="review-candidate"
      data-mostra-candidate={id}
      data-chosen={chosen ? "" : undefined}
      data-current={current ? "" : undefined}
      aria-label={label ?? id}
      className={cn(
        "relative min-w-0 overflow-auto rounded-(--radius) border border-border bg-card",
        current && "border-primary",
        chosen && "ring-2 ring-(--answer)",
        className,
      )}
      onPointerDownCapture={(event) => {
        set.look(id);
        onPointerDownCapture?.(event);
      }}
      onFocusCapture={(event) => {
        set.look(id);
        onFocusCapture?.(event);
      }}
      {...props}
    >
      {set.captions && (
        // The candidate's name, which its section already gives assistive technology.
        <div
          aria-hidden="true"
          data-slot="review-candidate-label"
          className="sticky top-0 z-10 flex items-center gap-2 border-b border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground"
        >
          {label ?? id}
          {chosen && <span className="size-2 rounded-full bg-(--answer)" />}
        </div>
      )}
      {children}
    </section>
  );
}

/** The candidates among a review set's children, in order, through fragments. */
function candidatesOf(children: React.ReactNode): CandidateInfo[] {
  const found: CandidateInfo[] = [];
  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child)) return;
    if (child.type === Candidate) {
      const { id, label } = child.props as CandidateProps;
      found.push(label !== undefined ? { id, label } : { id });
    } else if (child.type === React.Fragment) {
      found.push(...candidatesOf((child.props as { children?: React.ReactNode }).children));
    }
  });
  return found;
}

/** The candidate elements among a review set's children, by ID. */
function elementsOf(children: React.ReactNode): Map<string, React.ReactElement> {
  const found = new Map<string, React.ReactElement>();
  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child)) return;
    if (child.type === Candidate) found.set((child.props as CandidateProps).id, child);
    else if (child.type === React.Fragment) {
      for (const [id, element] of elementsOf(
        (child.props as { children?: React.ReactNode }).children,
      ))
        found.set(id, element);
    }
  });
  return found;
}

/** {@link ReviewSet}'s props. */
export interface ReviewSetProps extends Omit<React.ComponentProps<"div">, "id"> {
  /** The set's ID (letters, digits, `-` and `_`): the choice is the field `review.<id>.choice`. */
  readonly id: string;
  /** `gallery` (every candidate in a grid), `focus` (one at a time), or `compare` (two to four). */
  readonly layout?: ReviewLayout;
  /** Ask the shell for its trusted Choose, for the candidate in view. */
  readonly choose?: boolean;
  /** The candidates compared at first, in `compare` (default the first two). */
  readonly compare?: readonly string[];
}

/** The most candidates compared side by side. */
const COMPARE_MAX = 4;

/** A set of candidates to compare, comment on and choose between. */
export function ReviewSet({
  id,
  layout = "gallery",
  choose = false,
  compare,
  className,
  children,
  ...props
}: ReviewSetProps): React.JSX.Element {
  const candidates = candidatesOf(children);
  const ids = candidates.map((candidate) => candidate.id);
  const [looked, setLooked] = React.useState<string | undefined>(ids[0]);
  const [compared, setCompared] = React.useState<readonly string[]>(() =>
    (compare ?? ids.slice(0, 2)).filter((entry) => ids.includes(entry)).slice(0, COMPARE_MAX),
  );
  const [difference, setDifference] = React.useState(false);
  const shown =
    layout === "focus"
      ? looked !== undefined && ids.includes(looked)
        ? [looked]
        : ids.slice(0, 1)
      : layout === "compare"
        ? compared
        : ids;
  // The candidate in view: the one the viewer last looked at, among those shown.
  const current = looked !== undefined && shown.includes(looked) ? looked : shown[0];
  const choice = useChoice(
    id,
    choose ? { candidates, ...(current !== undefined ? { current } : {}) } : undefined,
  );
  useReviewSurface({ id, layout, candidates, ...(current !== undefined ? { current } : {}) });
  const differing = layout === "compare" && difference && compared.length === 2;
  const value: SetContext = {
    layout,
    shown,
    captions: layout !== "focus" && !differing,
    ...(current !== undefined ? { current } : {}),
    ...(choice.choice !== undefined ? { chosen: choice.choice } : {}),
    look: setLooked,
  };
  const labelOf = (candidate: string): string =>
    candidates.find((entry) => entry.id === candidate)?.label ?? candidate;

  // Compared candidates scroll together: one scrolled moves the others to the same place.
  const grid = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const root = grid.current;
    if (!root || layout !== "compare") return;
    const panes = [...root.querySelectorAll<HTMLElement>("[data-mostra-candidate]")];
    let syncing = false;
    const stops = panes.map((pane) => {
      const listener = (): void => {
        if (syncing) return;
        syncing = true;
        for (const other of panes) {
          if (other !== pane) {
            other.scrollTop = pane.scrollTop;
            other.scrollLeft = pane.scrollLeft;
          }
        }
        requestAnimationFrame(() => {
          syncing = false;
        });
      };
      pane.addEventListener("scroll", listener, { passive: true });
      return () => pane.removeEventListener("scroll", listener);
    });
    return () => {
      for (const stop of stops) stop();
    };
  });

  const elements = elementsOf(children);
  return (
    <ReviewSetContext.Provider value={value}>
      <div
        data-slot="review-set"
        data-mostra-review-set={id}
        data-layout={layout}
        className={cn("flex flex-col gap-3", className)}
        {...props}
      >
        {(layout !== "gallery" || choose) && ids.length > 1 && (
          <div
            role="toolbar"
            aria-label="Candidates"
            data-slot="review-set-toolbar"
            className="flex flex-wrap items-center gap-2"
          >
            {ids.map((candidate) => {
              const on =
                layout === "compare" ? compared.includes(candidate) : current === candidate;
              return (
                <button
                  key={candidate}
                  type="button"
                  aria-pressed={on}
                  data-review-candidate={candidate}
                  className={cn(
                    "rounded-full border px-3 py-1 text-sm transition-colors",
                    on
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-card hover:bg-muted",
                  )}
                  onClick={() => {
                    if (layout === "compare") {
                      setCompared((now) =>
                        now.includes(candidate)
                          ? now.length > 1
                            ? now.filter((entry) => entry !== candidate)
                            : now
                          : [...now, candidate].slice(-COMPARE_MAX),
                      );
                    }
                    setLooked(candidate);
                  }}
                >
                  {labelOf(candidate)}
                  {choice.choice === candidate && <span className="sr-only"> (chosen)</span>}
                  {choice.choice === candidate && (
                    <span
                      aria-hidden="true"
                      className="ml-1.5 inline-block size-2 rounded-full bg-(--answer)"
                    />
                  )}
                </button>
              );
            })}
            {layout === "compare" && compared.length === 2 && (
              <button
                type="button"
                aria-pressed={difference}
                data-review-difference=""
                className={cn(
                  "ml-auto rounded-full border px-3 py-1 text-sm",
                  difference
                    ? "border-foreground bg-foreground text-background"
                    : "border-border bg-card hover:bg-muted",
                )}
                onClick={() => setDifference(!difference)}
              >
                Difference
              </button>
            )}
          </div>
        )}
        <div
          ref={grid}
          data-review-grid=""
          data-difference={differing ? "" : undefined}
          className={cn(
            layout === "gallery" &&
              "grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(min(100%,18rem),1fr))]",
            layout === "focus" && "grid",
            layout === "compare" &&
              !differing &&
              "grid gap-4 md:[grid-template-columns:repeat(var(--compared),minmax(0,1fr))]",
            // The difference view: the two candidates stacked in one cell, the second blended by
            // difference, so where they agree is black and where they differ shows.
            differing && "isolate grid bg-black [&>*]:[grid-area:1/1] [&>*+*]:mix-blend-difference",
          )}
          style={{ "--compared": String(Math.max(1, compared.length)) } as React.CSSProperties}
        >
          {layout === "compare"
            ? compared.map((candidate) => (
                <React.Fragment key={candidate}>{elements.get(candidate)}</React.Fragment>
              ))
            : children}
        </div>
      </div>
    </ReviewSetContext.Provider>
  );
}
