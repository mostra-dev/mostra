/**
 * The page's frame (KT-10's "a beautiful result without design skill"): the page with its title,
 * its sections and a row of figures, each drawn from the theme's tokens (`--page-width`,
 * `--stack-gap`, `--section-*`, `--figure*`), so a page that composes these looks like its theme
 * in every theme, and a theme's change reaches it. Ordinary React on plain elements, the same in
 * either base; every part takes `className`, and `mostra add mostra-layout` copies it into the
 * artifact for editing, where the copy then wins (D68).
 */

import { cn } from "cn";
import type * as React from "react";

/* -------------------------------------------------------------------------------------------- */
/* The page                                                                                      */

/** How wide a page's column is. */
export type PageWidth = "form" | "wide" | "full";

/** {@link Page}'s props. */
export interface PageProps extends Omit<React.ComponentProps<"main">, "title"> {
  /** The page's title: what it is ("Checkout: which layout ships?"). */
  readonly title?: React.ReactNode;
  /** One line under the title: what the page needs, and by when. */
  readonly description?: React.ReactNode;
  /** A small line above the title: who sent it, when it was updated. */
  readonly meta?: React.ReactNode;
  /**
   * Its column: `form` (the theme's measure, for answering and deciding), `wide` (for a dashboard
   * or a table) or `full`. Default `form`.
   */
  readonly width?: PageWidth;
}

const WIDTHS: Readonly<Record<PageWidth, string>> = {
  form: "max-w-(--page-width)",
  wide: "max-w-6xl",
  full: "max-w-none",
};

/** The page: its title and description, then its blocks, spaced as the theme spaces them. */
export function Page({
  title,
  description,
  meta,
  width = "form",
  className,
  children,
  ...props
}: PageProps): React.JSX.Element {
  return (
    <main
      data-slot="page"
      className={cn(
        "mx-auto flex w-full flex-col gap-(--stack-gap) px-5 py-(--page-pad) sm:px-8",
        WIDTHS[width],
        className,
      )}
      {...props}
    >
      {(title !== undefined || description !== undefined || meta !== undefined) && (
        <PageHeader title={title} description={description} meta={meta} />
      )}
      {children}
    </main>
  );
}

/** {@link PageHeader}'s props. */
export interface PageHeaderProps extends Omit<React.ComponentProps<"header">, "title"> {
  readonly title?: React.ReactNode;
  readonly description?: React.ReactNode;
  readonly meta?: React.ReactNode;
}

/** A page's title block, for a page laid out without {@link Page}. */
export function PageHeader({
  title,
  description,
  meta,
  className,
  children,
  ...props
}: PageHeaderProps): React.JSX.Element {
  return (
    <header data-slot="page-header" className={cn("flex flex-col gap-3", className)} {...props}>
      {meta !== undefined && <div className="text-sm text-muted-foreground">{meta}</div>}
      {title !== undefined && <h1>{title}</h1>}
      {description !== undefined && (
        <p className="max-w-[60ch] text-[1.0625rem] text-pretty text-muted-foreground">
          {description}
        </p>
      )}
      {children}
    </header>
  );
}

/* -------------------------------------------------------------------------------------------- */
/* Sections                                                                                      */

/** {@link Section}'s props. */
export interface SectionProps extends Omit<React.ComponentProps<"section">, "title"> {
  /** Its heading. */
  readonly title: React.ReactNode;
  /** A line under the heading. */
  readonly description?: React.ReactNode;
  /** Its number, for sections that are steps in order. */
  readonly index?: number;
}

/** One block of a page under its heading, as the theme marks sections (a rule, a panel). */
export function Section({
  title,
  description,
  index,
  className,
  children,
  ...props
}: SectionProps): React.JSX.Element {
  return (
    <section
      data-slot="section"
      className={cn(
        "flex flex-col gap-8 rounded-(--section-radius) bg-(--section-bg) p-(--section-pad) shadow-(--section-shadow) [border-top:var(--section-rule)]",
        className,
      )}
      {...props}
    >
      <header className="flex flex-col gap-1.5">
        <h2 className="flex items-center gap-[0.6em]">
          {index !== undefined && (
            <span
              data-slot="section-index"
              aria-hidden
              className="grid size-(--section-index-size) shrink-0 place-items-center rounded-full bg-(--section-index-bg) text-[0.8em] text-(--section-index-color) tabular-nums"
            >
              {index}
            </span>
          )}
          <span>{title}</span>
        </h2>
        {description !== undefined && (
          <p className="max-w-prose text-pretty text-muted-foreground">{description}</p>
        )}
      </header>
      {children}
    </section>
  );
}

/* -------------------------------------------------------------------------------------------- */
/* Figures                                                                                       */

/** {@link Figures}' props. */
export type FiguresProps = React.ComponentProps<"div">;

/** A row of figures: two to a row on a phone, all of them in one row from 40rem. */
export function Figures({ className, children, ...props }: FiguresProps): React.JSX.Element {
  return (
    <div
      data-slot="figures"
      className={cn(
        "grid grid-cols-2 gap-(--figures-gap) divide-(--figures-divider) overflow-hidden rounded-card bg-(--figures-bg) shadow-(--figures-shadow) sm:auto-cols-fr sm:grid-flow-col sm:grid-cols-none sm:divide-x",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

/** How a figure's change reads: better, worse, or only different. */
export type FigureTone = "good" | "bad" | "neutral";

/** {@link Figure}'s props. */
export interface FigureProps extends React.ComponentProps<"div"> {
  /** What it measures ("Signups"). */
  readonly label: React.ReactNode;
  /** The number, formatted ("642", "€84,210"). */
  readonly value: React.ReactNode;
  /** Its change against a named baseline ("+5.1% vs last week"). */
  readonly change?: React.ReactNode;
  /** Whether the change is good, bad or neither: said in colour beside the words. Default `neutral`. */
  readonly tone?: FigureTone;
}

const TONES: Readonly<Record<FigureTone, string>> = {
  good: "text-success",
  bad: "text-destructive",
  neutral: "text-muted-foreground",
};

/** One figure: its label above its value, and its change. */
export function Figure({
  label,
  value,
  change,
  tone = "neutral",
  className,
  ...props
}: FigureProps): React.JSX.Element {
  return (
    <div
      data-slot="figure"
      className={cn(
        "flex flex-col gap-1.5 rounded-(--figure-radius) bg-(--figure-bg) p-(--figure-pad)",
        className,
      )}
      {...props}
    >
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="font-(family-name:--figure-font) text-[2rem] leading-none font-(--figure-weight) tracking-tight tabular-nums">
        {value}
      </span>
      {change !== undefined && (
        <span className={cn("text-sm tabular-nums", TONES[tone])}>{change}</span>
      )}
    </div>
  );
}
