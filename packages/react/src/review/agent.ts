/// <reference lib="dom" />
/**
 * The page's review agent (WP-20, ROUND-3 §8): what the shell's review overlay asks the page over
 * the bridge, answered from the page's own DOM. `hitTest` describes what is under a point, in
 * every anchor layer; `locate` finds an anchor again; `track` keeps reporting where anchors are as
 * the page scrolls, resizes and changes. The overlay itself is the shell's (RV-04): what the page
 * answers places pins and fills anchors, never shows, hides or makes a thread.
 *
 * Frames inside the page: a frame Mostra serves carries the injected agent (`answerParent`), which
 * answers the nested protocol (`NESTED`) from inside it, so its content anchors semantically; a
 * frame of the page's own origin is read directly; any other frame is opaque, and the anchor keeps
 * its coordinates, its frame's selector and the crop.
 */
import type { AnchorLayer, AnchorRect, ReviewAnchor } from "@mostra/protocol";
import { cssPath, describe, resolveAnchor } from "./anchors.ts";
import { anchorProviders } from "./registry.ts";

/** The nested review protocol's message key: `{ [NESTED]: "hitTest" | "resolve" | "answer", id, … }`. */
export const NESTED = "mostra-review";
/** How long a nested frame has to answer before it counts as not speaking the protocol. */
const NESTED_MS = 400;
/** An opaque frame's anchor box around the point. */
const OPAQUE_BOX = 48;

/** A hit: the anchor, and its box in the document's viewport. */
export interface Hit {
  readonly anchor?: ReviewAnchor;
  readonly rect?: AnchorRect;
}

/** Where an anchor is now, in the document's viewport, and which layer found it. */
export interface Located {
  readonly rect?: AnchorRect;
  readonly layer: AnchorLayer;
}

/**
 * Whether a frame is one Mostra serves: its address is the page's own origin's, so it carries the
 * injected agent, whether it runs there or in an opaque origin the artifact's `sandbox` gives it.
 * Only such a frame is asked about a point or an anchor (WP-20's review, finding 7): a widget of
 * another site the artifact embeds answers for nothing and is told nothing of the anchor.
 */
function servedFrame(frame: HTMLIFrameElement): boolean {
  const view = frame.ownerDocument.defaultView;
  if (!view) return false;
  const src = frame.getAttribute("src");
  if (src === null || src === "" || frame.hasAttribute("srcdoc")) return false;
  try {
    return new URL(src, frame.ownerDocument.baseURI).origin === view.location.origin;
  } catch {
    return false;
  }
}

let asked = 0;
/**
 * Asks a frame Mostra serves over the nested protocol; `undefined` when it isn't one, or doesn't
 * answer in time. An answer counts only from the frame's own window at the page's origin, or at the
 * opaque origin its sandbox gives it (`"null"`), never from a frame of another site (finding 7).
 */
function askFrame<T>(
  frame: HTMLIFrameElement,
  message: Record<string, unknown>,
): Promise<T | undefined> {
  const target = frame.contentWindow;
  const own = frame.ownerDocument.defaultView?.location.origin;
  if (!target || !servedFrame(frame)) return Promise.resolve(undefined);
  asked += 1;
  const id = `${Date.now()}-${asked}`;
  return new Promise((resolve) => {
    const view = frame.ownerDocument.defaultView;
    const done = (value: T | undefined): void => {
      view?.removeEventListener("message", listener);
      clearTimeout(timer);
      resolve(value);
    };
    const listener = (event: MessageEvent): void => {
      if (event.source !== target) return;
      if (event.origin !== own && event.origin !== "null") return;
      const data = event.data as { [NESTED]?: string; id?: string; answer?: T } | null;
      if (data?.[NESTED] === "answer" && data.id === id) done(data.answer);
    };
    const timer = setTimeout(() => done(undefined), NESTED_MS);
    view?.addEventListener("message", listener);
    // A nested frame's origin isn't known in advance (it may be opaque); what is sent names no
    // secret: a point, or an anchor the page already knows.
    target.postMessage({ ...message, [NESTED]: message["type"], id }, "*");
  });
}

/** The frame's document, when it is the page's own origin's and readable. */
function sameOriginDocument(frame: HTMLIFrameElement): Document | undefined {
  try {
    const doc = frame.contentDocument;
    return doc?.body ? doc : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The CSS selector of a frame element in its document: a unique path, as CSS reads it, which an
 * agent reading results can use as it is (WP-20's review, finding 10).
 */
function frameSelector(frame: HTMLIFrameElement): string {
  return cssPath(frame);
}

/**
 * The frame element a selector names. A bare `iframe:nth-of-type(N)` is how anchors before the
 * review named the N-th frame of the whole document, and is still read that way.
 */
function frameBySelector(doc: Document, selector: string): HTMLIFrameElement | undefined {
  const match = /^iframe:nth-of-type\((\d+)\)$/.exec(selector);
  if (match) {
    return doc.querySelectorAll("iframe")[Number(match[1]) - 1] as HTMLIFrameElement | undefined;
  }
  try {
    const element = doc.querySelector(selector);
    return element instanceof HTMLIFrameElement ? element : undefined;
  } catch {
    return undefined;
  }
}

/** The page's place for its own viewport: its size, DPR and scroll. */
function placeOf(view: Window): Pick<ReviewAnchor, "viewport" | "scroll"> {
  return {
    viewport: {
      width: view.innerWidth,
      height: view.innerHeight,
      dpr: view.devicePixelRatio || 1,
    },
    scroll: { x: view.scrollX, y: view.scrollY },
  };
}

/** What is at a point of this document's viewport, every layer, descending into frames. */
export async function hitTest(doc: Document, x: number, y: number): Promise<Hit> {
  const view = doc.defaultView;
  const target = doc.elementFromPoint(x, y);
  if (!target || !view) return {};
  if (target instanceof HTMLIFrameElement) {
    const box = target.getBoundingClientRect();
    const offset = { x: box.left + target.clientLeft, y: box.top + target.clientTop };
    const inner = { x: x - offset.x, y: y - offset.y };
    const selector = frameSelector(target);
    // A frame Mostra serves answers for itself; one of the page's origin is read here.
    const nested =
      (await askFrame<Hit>(target, { type: "hitTest", x: inner.x, y: inner.y })) ??
      (() => {
        const inside = sameOriginDocument(target);
        return inside ? hitTest(inside, inner.x, inner.y) : undefined;
      })();
    const answer = await nested;
    if (answer?.anchor && answer.rect) {
      const rect = { ...answer.rect, x: answer.rect.x + offset.x, y: answer.rect.y + offset.y };
      return {
        anchor: {
          ...answer.anchor,
          frames: [{ selector, served: true }, ...(answer.anchor.frames ?? [])],
          // The top page's own coordinates, so a crop finds the place without the frame's help.
          rect: { ...rect, x: rect.x + view.scrollX, y: rect.y + view.scrollY },
          point: { x: x + view.scrollX, y: y + view.scrollY },
          ...placeOf(view),
        },
        rect,
      };
    }
    // An opaque frame: its coordinates, its selector and the crop say where.
    const rect = {
      x: Math.max(box.left, x - OPAQUE_BOX / 2),
      y: Math.max(box.top, y - OPAQUE_BOX / 2),
      width: Math.min(OPAQUE_BOX, box.width),
      height: Math.min(OPAQUE_BOX, box.height),
    };
    return {
      anchor: {
        selectors: [{ type: "CssSelector", value: selector }],
        frames: [{ selector, served: false }],
        rect: { ...rect, x: rect.x + view.scrollX, y: rect.y + view.scrollY },
        point: { x: x + view.scrollX, y: y + view.scrollY },
        ...placeOf(view),
        label: target.title ? `embedded page "${target.title.slice(0, 60)}"` : "an embedded page",
      },
      rect,
    };
  }
  const anchor = describe(target, { x, y }, anchorProviders());
  const rect = anchor.rect
    ? { ...anchor.rect, x: anchor.rect.x - view.scrollX, y: anchor.rect.y - view.scrollY }
    : (() => {
        const box = target.getBoundingClientRect();
        return { x: box.left, y: box.top, width: box.width, height: box.height };
      })();
  return { anchor, rect };
}

/** Where an anchor is in this document's viewport now, descending into served frames. */
export async function locate(doc: Document, anchor: ReviewAnchor): Promise<Located> {
  const view = doc.defaultView;
  if (!view) return { layer: "none" };
  const [outer, ...rest] = anchor.frames ?? [];
  if (outer) {
    const frame = frameBySelector(doc, outer.selector);
    if (frame && outer.served) {
      const box = frame.getBoundingClientRect();
      const offset = { x: box.left + frame.clientLeft, y: box.top + frame.clientTop };
      // The frame finds its part by its own layers; the outer page's coordinates are left out.
      const {
        rect: _rect,
        point: _point,
        viewport: _viewport,
        scroll: _scroll,
        ...layers
      } = anchor;
      const inner: ReviewAnchor = { ...layers, frames: rest };
      const answer =
        (await askFrame<Located>(frame, { type: "resolve", anchor: inner })) ??
        (await (async () => {
          const inside = sameOriginDocument(frame);
          return inside ? locate(inside, inner) : undefined;
        })());
      if (answer?.rect && answer.layer !== "none" && answer.layer !== "rect") {
        return {
          rect: { ...answer.rect, x: answer.rect.x + offset.x, y: answer.rect.y + offset.y },
          layer: answer.layer,
        };
      }
    }
    // The frame is opaque or its content didn't answer: the anchor's box, if the frame is there.
    if (!anchor.rect) return { layer: "none" };
    return {
      rect: { ...anchor.rect, x: anchor.rect.x - view.scrollX, y: anchor.rect.y - view.scrollY },
      layer: "rect",
    };
  }
  const found = resolveAnchor(doc, anchor, anchorProviders());
  if (!found.rect) return { layer: found.layer };
  return {
    rect: { ...found.rect, x: found.rect.x - view.scrollX, y: found.rect.y - view.scrollY },
    layer: found.layer,
  };
}

/** Scrolls an anchor's place to the middle of the viewport; answers whether it was found. */
export async function scrollTo(doc: Document, anchor: ReviewAnchor): Promise<Located> {
  const view = doc.defaultView;
  const placed = await locate(doc, anchor);
  if (!view || !placed.rect || placed.layer === "none") return placed;
  const top =
    placed.rect.y + view.scrollY - Math.max(0, (view.innerHeight - placed.rect.height) / 2);
  const left =
    placed.rect.x + view.scrollX - Math.max(0, (view.innerWidth - placed.rect.width) / 2);
  view.scrollTo({ top: Math.max(0, top), left: Math.max(0, left), behavior: "instant" });
  return locate(doc, anchor);
}

/**
 * Keeps telling `report` where each tracked anchor is in the viewport, as the page scrolls,
 * resizes and changes, at most once per animation frame. Returns the function that stops.
 */
export function trackAnchors(
  doc: Document,
  anchors: readonly { readonly id: string; readonly anchor: ReviewAnchor }[],
  report: (positions: { id: string; rect?: AnchorRect; layer: AnchorLayer }[]) => void,
): () => void {
  const view = doc.defaultView;
  if (!view || anchors.length === 0) {
    report([]);
    return () => undefined;
  }
  let scheduled = false;
  let stopped = false;
  let last = "";
  const measure = async (): Promise<void> => {
    scheduled = false;
    if (stopped) return;
    const positions = await Promise.all(
      anchors.map(async ({ id, anchor }) => {
        const placed = await locate(doc, anchor);
        return { id, ...(placed.rect ? { rect: rounded(placed.rect) } : {}), layer: placed.layer };
      }),
    );
    const text = JSON.stringify(positions);
    if (stopped || text === last) return;
    last = text;
    report(positions);
  };
  const schedule = (): void => {
    if (scheduled || stopped) return;
    scheduled = true;
    view.requestAnimationFrame(() => void measure());
  };
  const observer = new MutationObserver(schedule);
  observer.observe(doc.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    characterData: true,
  });
  view.addEventListener("scroll", schedule, { passive: true, capture: true });
  view.addEventListener("resize", schedule);
  // Frames and images that load late move what follows them.
  const timer = view.setInterval(schedule, 1000);
  schedule();
  return () => {
    stopped = true;
    observer.disconnect();
    view.removeEventListener("scroll", schedule, { capture: true });
    view.removeEventListener("resize", schedule);
    view.clearInterval(timer);
  };
}

/** A rectangle in whole CSS pixels. */
function rounded(rect: AnchorRect): AnchorRect {
  return {
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  };
}

/**
 * Answers the nested protocol for this document's parent page: the agent Mostra injects into
 * every HTML page it serves inside an artifact (a served frame) runs it. Only the parent window is
 * answered, at the origin it wrote from.
 */
export function answerParent(): () => void {
  if (window.parent === window) return () => undefined;
  const listener = (event: MessageEvent): void => {
    if (event.source !== window.parent) return;
    const data = event.data as {
      [NESTED]?: string;
      id?: string;
      x?: number;
      y?: number;
      anchor?: ReviewAnchor;
    } | null;
    if (!data || typeof data[NESTED] !== "string" || typeof data.id !== "string") return;
    const reply = (answer: unknown): void =>
      window.parent.postMessage(
        { [NESTED]: "answer", id: data.id, answer },
        event.origin === "null" ? "*" : event.origin,
      );
    if (data[NESTED] === "hitTest" && typeof data.x === "number" && typeof data.y === "number") {
      void hitTest(document, data.x, data.y).then(reply);
    } else if (data[NESTED] === "resolve" && data.anchor) {
      void locate(document, data.anchor).then(reply);
    }
  };
  window.addEventListener("message", listener);
  return () => window.removeEventListener("message", listener);
}
