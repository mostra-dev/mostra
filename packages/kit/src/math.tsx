"use client";

/**
 * Mathematics with KaTeX (D26): an agent writes TeX and this typesets it, inline in a sentence or
 * as a display on its own line, in the page's text colour and at its size, with KaTeX's own fonts
 * served from the page's origin (no third-party request). TeX KaTeX can't read shows in place and
 * on the console, so `verify` reports it. Screen readers get KaTeX's MathML. Takes `className`;
 * `mostra add mostra-math` copies it (D68).
 */

import { cn } from "cn";
import katex from "katex";
import "katex/dist/katex.min.css";
import * as React from "react";

/** {@link Formula}'s props. */
export interface FormulaProps extends Omit<React.HTMLAttributes<HTMLElement>, "children"> {
  /** The formula, in TeX (`\\frac{a}{b}`, `E = mc^2`). */
  readonly tex: string;
  /** On a line of its own, centred, at display size. Default inline in the text. */
  readonly display?: boolean;
  /** Macros the formula uses (`{ "\\R": "\\mathbb{R}" }`). */
  readonly macros?: Readonly<Record<string, string>>;
}

/**
 * A formula typeset by KaTeX, inline or on its own line.
 *
 * ```tsx
 * <p>The rate is <Formula tex="r = \frac{\Delta y}{\Delta x}" />.</p>
 * <Formula display tex="\int_0^1 x^2 \, dx = \frac{1}{3}" />
 * ```
 */
export function Formula({
  tex,
  display = false,
  macros,
  className,
  ...props
}: FormulaProps): React.JSX.Element {
  const rendered = React.useMemo(() => {
    try {
      return {
        html: katex.renderToString(tex, {
          displayMode: display,
          throwOnError: true,
          output: "htmlAndMathml",
          ...(macros ? { macros: { ...macros } } : {}),
        }),
      };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  }, [tex, display, macros]);
  React.useEffect(() => {
    if (rendered.error !== undefined) {
      console.error(`KaTeX couldn't typeset the formula: ${rendered.error}`);
    }
  }, [rendered.error]);
  const attributes = {
    "data-slot": "formula",
    ...(props as React.HTMLAttributes<HTMLElement>),
  };
  if (rendered.error !== undefined) {
    const shown = { role: "alert", className: cn("font-mono text-destructive", className) };
    return display ? (
      <div {...attributes} {...shown}>
        {tex}
      </div>
    ) : (
      <span {...attributes} {...shown}>
        {tex}
      </span>
    );
  }
  // KaTeX's own output: the formula, escaped, as HTML and MathML.
  const html = { __html: rendered.html };
  return display ? (
    <div
      {...attributes}
      className={cn("my-4 block overflow-x-auto text-center", className)}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: KaTeX escapes the TeX it is given.
      dangerouslySetInnerHTML={html}
    />
  ) : (
    <span
      {...attributes}
      className={cn("inline", className)}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: KaTeX escapes the TeX it is given.
      dangerouslySetInnerHTML={html}
    />
  );
}
