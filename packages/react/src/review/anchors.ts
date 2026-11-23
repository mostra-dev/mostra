/// <reference lib="dom" />
/**
 * Anchors in the page (WP-20, D23, RV-01, RV-02): what the viewer pointed at, described in every
 * layer that applies, and found again later. Pure DOM: the client runtime's review agent and the
 * agent Mostra injects into frames it serves both use it.
 *
 * Layers, finest first, which is also the order {@link resolveAnchor} tries them in:
 * 1. an anchor provider's data (a chart's datum, a slide, a timeline's time);
 * 2. the nearest `data-review-id`, the semantic layer agents act on;
 * 3. W3C selectors: a CSS selector of the element, refined by a quote of its text;
 * 4. the quote alone, found anywhere in the page's text;
 * 5. the box, in document coordinates, scaled when the viewport's width changed.
 */
import type { AnchorLayer, AnchorRect, AnchorSelector, ReviewAnchor } from "@mostra/protocol";

/** An anchor provider, as the contract defines it (`@mostra/contract-anchor-provider`). */
export interface PageAnchorProvider {
  readonly id: string;
  readonly kind: string;
  matches?(input: { target: Element; point?: { x: number; y: number } }, context: unknown): boolean;
  serialize(
    input: { target: Element; point?: { x: number; y: number }; selection?: Range },
    context: unknown,
  ): { anchor: Record<string, unknown>; label?: string } | undefined;
  resolve(
    input: { anchor: Record<string, unknown>; root: Element },
    context: unknown,
  ): { element?: Element; rect?: AnchorRect; label?: string } | undefined;
}

const QUOTE_MAX = 160;
/** Surfaces whose insides the DOM can't name: a comment points at a place on them. */
const POINTED: ReadonlySet<string> = new Set([
  "canvas",
  "img",
  "video",
  "svg",
  "picture",
  "object",
  "embed",
]);
/** Half the side of the box around a point on such a surface, in CSS pixels. */
const POINT_BOX = 32;

/** A box around a point, kept inside a surface's box. */
function pointBox(
  surface: AnchorRect,
  point: { readonly x: number; readonly y: number },
): AnchorRect {
  const width = Math.min(POINT_BOX * 2, surface.width);
  const height = Math.min(POINT_BOX * 2, surface.height);
  return {
    x: Math.min(Math.max(point.x - width / 2, surface.x), surface.x + surface.width - width),
    y: Math.min(Math.max(point.y - height / 2, surface.y), surface.y + surface.height - height),
    width,
    height,
  };
}
const CONTEXT_MAX = 32;

/** A CSS string literal. */
function literal(value: string): string {
  return `"${value.replace(/["\\]/g, "\\$&").replace(/\n/g, "\\a ")}"`;
}

function escapeIdent(value: string): string {
  return typeof CSS !== "undefined" && CSS.escape ? CSS.escape(value) : value;
}

/**
 * A CSS selector that names `element` alone in its document: its ID when that is unique, else a
 * path of `tag:nth-of-type()` steps from the nearest ancestor with a unique ID or `data-review-id`.
 */
export function cssPath(element: Element): string {
  const doc = element.ownerDocument;
  const unique = (selector: string): boolean => {
    try {
      return doc.querySelectorAll(selector).length === 1;
    } catch {
      return false;
    }
  };
  const steps: string[] = [];
  let current: Element | null = element;
  while (current && current !== doc.documentElement) {
    const id = current.getAttribute("id");
    if (id && unique(`#${escapeIdent(id)}`)) {
      steps.unshift(`#${escapeIdent(id)}`);
      return steps.join(" > ");
    }
    const reviewId = current.getAttribute("data-review-id");
    if (reviewId && unique(`[data-review-id=${literal(reviewId)}]`)) {
      steps.unshift(`[data-review-id=${literal(reviewId)}]`);
      return steps.join(" > ");
    }
    const tag = current.localName;
    const parent: Element | null = current.parentElement;
    if (!parent) {
      steps.unshift(tag);
      break;
    }
    const same = [...parent.children].filter((child) => child.localName === tag);
    steps.unshift(same.length > 1 ? `${tag}:nth-of-type(${same.indexOf(current) + 1})` : tag);
    current = parent;
  }
  return steps.length > 0 ? `html > ${steps.join(" > ")}` : "html";
}

/** The visible text of an element, its spaces folded. */
function textOf(element: Element): string {
  const text = (element as HTMLElement).innerText ?? element.textContent ?? "";
  return text.replace(/\s+/g, " ").trim();
}

/** The whole page's text, its spaces folded, for quotes. */
function pageText(doc: Document): string {
  return (doc.body?.textContent ?? "").replace(/\s+/g, " ");
}

/** A quote of the element's text with a little of what surrounds it (W3C TextQuoteSelector). */
export function textQuote(element: Element): AnchorSelector | undefined {
  const exact = textOf(element).slice(0, QUOTE_MAX);
  if (exact === "") return undefined;
  const all = pageText(element.ownerDocument);
  const at = all.indexOf(exact);
  if (at < 0) return { type: "TextQuoteSelector", exact };
  const prefix = all.slice(Math.max(0, at - CONTEXT_MAX), at);
  const suffix = all.slice(at + exact.length, at + exact.length + CONTEXT_MAX);
  return {
    type: "TextQuoteSelector",
    exact,
    ...(prefix !== "" ? { prefix } : {}),
    ...(suffix !== "" ? { suffix } : {}),
  };
}

/** What an element is, for people: a control's name, a heading, an image's alternative. */
export function labelOf(element: Element): string | undefined {
  const named =
    element.getAttribute("aria-label") ??
    (element as HTMLImageElement).alt ??
    element.getAttribute("title");
  const text = named && named.trim() !== "" ? named.trim() : textOf(element);
  if (text === "") return element.localName;
  const short = text.length > 60 ? `${text.slice(0, 59)}…` : text;
  const role = element.getAttribute("role") ?? element.localName;
  return `${role} "${short}"`;
}

/** The element's box in its document's coordinates. */
export function documentRect(element: Element): AnchorRect {
  const box = element.getBoundingClientRect();
  const view = element.ownerDocument.defaultView;
  return {
    x: box.left + (view?.scrollX ?? 0),
    y: box.top + (view?.scrollY ?? 0),
    width: box.width,
    height: box.height,
  };
}

/** The meaningful element at a point: skips the page's own wrappers that fill the screen. */
function meaningful(element: Element): Element {
  let current: Element | null = element;
  while (current && current !== current.ownerDocument.body) {
    const box = current.getBoundingClientRect();
    const view = current.ownerDocument.defaultView;
    const fills =
      view !== null && box.width >= view.innerWidth * 0.95 && box.height >= view.innerHeight * 0.95;
    if (!fills) return current;
    current = current.parentElement;
  }
  return element;
}

/** Describes `target` (at `point`, in the document's viewport coordinates) in every layer. */
export function describe(
  target: Element,
  point: { readonly x: number; readonly y: number } | undefined,
  providers: readonly PageAnchorProvider[],
): ReviewAnchor {
  const doc = target.ownerDocument;
  const view = doc.defaultView;
  const element = meaningful(target);
  const reviewId = element.closest("[data-review-id]")?.getAttribute("data-review-id") ?? undefined;
  const candidate = element.closest("[data-mostra-candidate]");
  const set = candidate?.closest("[data-mostra-review-set]");
  let provider: ReviewAnchor["provider"];
  for (const entry of providers) {
    try {
      const input = { target, ...(point ? { point } : {}) };
      if (entry.matches && !entry.matches(input, providerContext)) continue;
      const made = entry.serialize(input, providerContext);
      if (!made) continue;
      if (JSON.stringify(made.anchor).length > 16 * 1024) continue;
      provider = {
        id: entry.id,
        kind: entry.kind,
        data: made.anchor,
        ...(made.label !== undefined ? { label: made.label.slice(0, 256) } : {}),
      };
      break;
    } catch (error) {
      console.warn(`Mostra: the anchor provider ${entry.id} failed.`, error);
    }
  }
  const quote = textQuote(element);
  const box = documentRect(element);
  // On a surface whose insides the DOM can't name (a canvas, an image, a video, a drawing), the
  // place is the point, in a small box inside the surface; the element's selector says which one.
  const surface =
    POINTED.has(element.localName) && (box.width > POINT_BOX * 2 || box.height > POINT_BOX * 2);
  const rect =
    surface && point && view
      ? pointBox(box, { x: point.x + view.scrollX, y: point.y + view.scrollY })
      : box;
  const selectors: AnchorSelector[] = [
    { type: "CssSelector", value: cssPath(element).slice(0, 2048) },
  ];
  if (quote) selectors.push(quote);
  const slide = element.closest("[data-slide-index]");
  const time = element.closest("[data-timeline-time]");
  return {
    ...(reviewId !== undefined ? { reviewId: reviewId.slice(0, 256) } : {}),
    selectors,
    rect,
    ...(point && view ? { point: { x: point.x + view.scrollX, y: point.y + view.scrollY } } : {}),
    ...(view
      ? {
          viewport: {
            width: view.innerWidth,
            height: view.innerHeight,
            dpr: view.devicePixelRatio || 1,
          },
          scroll: { x: view.scrollX, y: view.scrollY },
        }
      : {}),
    ...(set ? { reviewSetId: set.getAttribute("data-mostra-review-set") ?? undefined } : {}),
    ...(candidate
      ? { candidateId: candidate.getAttribute("data-mostra-candidate") ?? undefined }
      : {}),
    ...(provider ? { provider } : {}),
    label: (provider?.label ?? labelOf(element) ?? "").slice(0, 256),
    ...(slide
      ? {
          slide: {
            index: Number(slide.getAttribute("data-slide-index")) || 0,
            step: Number(slide.getAttribute("data-slide-step")) || 0,
          },
        }
      : {}),
    ...(time ? { time: Math.max(0, Number(time.getAttribute("data-timeline-time")) || 0) } : {}),
  } as ReviewAnchor;
}

const providerContext = {
  mostraVersion: "0",
  log: (message: string) => console.info(`Mostra anchor provider: ${message}`),
};

/** An element's text, matched against a quote, so a selector that points elsewhere now fails. */
function quoteMatches(element: Element, quote: AnchorSelector | undefined): boolean {
  if (!quote || quote.type !== "TextQuoteSelector") return true;
  return textOf(element).startsWith(quote.exact.slice(0, 40));
}

/**
 * The element a quote names: among those whose text begins with it, one whose context (the text
 * before and after it in the page) matches, the innermost (shortest text) first.
 */
function findQuote(
  doc: Document,
  quote: AnchorSelector & { type: "TextQuoteSelector" },
): Element | undefined {
  const start = quote.exact.slice(0, 40);
  const all = pageText(doc);
  const contextAt = (at: number): boolean =>
    (quote.prefix === undefined ||
      all.slice(Math.max(0, at - quote.prefix.length), at) === quote.prefix) &&
    (quote.suffix === undefined ||
      all.slice(at + quote.exact.length, at + quote.exact.length + quote.suffix.length) ===
        quote.suffix);
  // Where the quote stands in the page's text with its context, when it still does.
  let contextual = -1;
  for (let at = all.indexOf(quote.exact); at >= 0; at = all.indexOf(quote.exact, at + 1)) {
    if (contextAt(at)) {
      contextual = at;
      break;
    }
  }
  let best: { element: Element; length: number } | undefined;
  const walker = doc.createTreeWalker(doc.body ?? doc.documentElement, NodeFilter.SHOW_ELEMENT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const element = node as Element;
    const text = textOf(element);
    if (!text.startsWith(start)) continue;
    if (contextual >= 0) {
      // The element must hold the quote where its context is: the page text before it ends with
      // the prefix.
      const before = textBefore(element);
      if (quote.prefix !== undefined && !before.endsWith(quote.prefix.trimEnd())) continue;
    }
    if (!best || text.length < best.length) best = { element, length: text.length };
  }
  return best?.element;
}

/** The page's text before an element, its spaces folded, trimmed at the end. */
function textBefore(element: Element): string {
  const doc = element.ownerDocument;
  const range = doc.createRange();
  range.setStart(doc.body ?? doc.documentElement, 0);
  range.setEndBefore(element);
  return range.toString().replace(/\s+/g, " ").trimEnd();
}

/** Where an anchor is in `doc` now, and which layer found it. */
export function resolveAnchor(
  doc: Document,
  anchor: ReviewAnchor,
  providers: readonly PageAnchorProvider[],
): { readonly element?: Element; readonly rect?: AnchorRect; readonly layer: AnchorLayer } {
  const root = doc.body ?? doc.documentElement;
  if (anchor.provider) {
    const provider = providers.find((entry) => entry.id === anchor.provider?.id);
    if (provider) {
      try {
        const found = provider.resolve(
          { anchor: anchor.provider.data as Record<string, unknown>, root },
          providerContext,
        );
        if (found?.element)
          return { element: found.element, rect: documentRect(found.element), layer: "provider" };
        if (found?.rect) return { rect: found.rect, layer: "provider" };
      } catch (error) {
        console.warn(`Mostra: the anchor provider ${provider.id} failed.`, error);
      }
    }
  }
  if (anchor.reviewId !== undefined) {
    const element = doc.querySelector(`[data-review-id=${literal(anchor.reviewId)}]`);
    if (element) return { element, rect: documentRect(element), layer: "reviewId" };
  }
  const css = anchor.selectors?.find((selector) => selector.type === "CssSelector");
  const quote = anchor.selectors?.find((selector) => selector.type === "TextQuoteSelector");
  if (css?.type === "CssSelector") {
    let element: Element | null = null;
    try {
      element = doc.querySelector(css.value);
    } catch {
      element = null;
    }
    if (element && quoteMatches(element, quote)) {
      const box = documentRect(element);
      // A point on a surface still inside it keeps its own box (a canvas's place).
      const point = anchor.point;
      if (
        POINTED.has(element.localName) &&
        anchor.rect &&
        point &&
        point.x >= box.x &&
        point.x <= box.x + box.width &&
        point.y >= box.y &&
        point.y <= box.y + box.height
      ) {
        return { element, rect: anchor.rect, layer: "selector" };
      }
      return { element, rect: box, layer: "selector" };
    }
  }
  if (quote?.type === "TextQuoteSelector") {
    const element = findQuote(doc, quote);
    if (element) return { element, rect: documentRect(element), layer: "text" };
  }
  if (anchor.rect) {
    const view = doc.defaultView;
    const scale =
      anchor.viewport && view && anchor.viewport.width > 0
        ? view.innerWidth / anchor.viewport.width
        : 1;
    return {
      rect: {
        x: anchor.rect.x * scale,
        y: anchor.rect.y,
        width: anchor.rect.width * scale,
        height: anchor.rect.height,
      },
      layer: "rect",
    };
  }
  return { layer: "none" };
}
