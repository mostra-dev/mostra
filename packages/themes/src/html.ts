/**
 * HTML built as text, safe by construction: `html` is a tagged template whose interpolations are
 * escaped unless they are already `SafeHtml`, so a tenant's name, an operator's message or a
 * provider's label always lands as text (ARCHITECTURE §15.6). The only way to make `SafeHtml` is
 * this template, so markup can't come from data.
 */

const SAFE: unique symbol = Symbol("SafeHtml");

/** Markup this package or its caller wrote, with every interpolated value escaped. */
export interface SafeHtml {
  /** The brand only `html` sets. */
  readonly [SAFE]: true;
  /** The markup, ready to send. */
  readonly value: string;
}

/** What `html` accepts between its parts: text (escaped), markup, lists of either, or nothing. */
export type HtmlValue =
  | string
  | number
  | SafeHtml
  | readonly HtmlValue[]
  | null
  | undefined
  | false;

/** Escapes text for an HTML element's content or a quoted attribute. */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);
}

/** Whether a value is markup made by `html`. */
export function isSafeHtml(value: unknown): value is SafeHtml {
  return typeof value === "object" && value !== null && (value as { [SAFE]?: true })[SAFE] === true;
}

function render(value: HtmlValue): string {
  if (value === null || value === undefined || value === false) return "";
  if (typeof value === "string") return escapeHtml(value);
  if (typeof value === "number") return escapeHtml(String(value));
  if (isSafeHtml(value)) return value.value;
  return value.map(render).join("");
}

function safe(value: string): SafeHtml {
  return Object.freeze({ [SAFE]: true as const, value });
}

/** Markup with escaped interpolations: html`<p>${name}</p>`. */
export function html(strings: TemplateStringsArray, ...values: readonly HtmlValue[]): SafeHtml {
  let out = strings[0] ?? "";
  values.forEach((value, index) => {
    out += render(value) + (strings[index + 1] ?? "");
  });
  return safe(out);
}

/** Text as markup, escaped: a helper for a value that is sometimes text and sometimes markup. */
export function text(value: HtmlValue): SafeHtml {
  return safe(render(value));
}
