/**
 * An anchor's layers and the order they resolve in (RV-02, D183 item 6), in a real browser: a
 * comment's anchor keeps every layer that applies, and each layer taken away leaves the next to
 * find the place: an anchor provider's data, the `data-review-id`, the CSS selector checked by its
 * text quote, the text quote alone, then the box.
 */
import type { ReviewAnchor } from "@mostra/protocol";
import { afterEach, describe, expect, it } from "vitest";
import {
  describe as describeAnchor,
  describeSelection,
  resolveAnchor,
} from "../../src/review/anchors.ts";
import { BUILT_IN_PROVIDERS } from "../../src/review/providers.ts";

afterEach(() => {
  document.body.replaceChildren();
});

/** A small page: a section with a review ID around a heading and two paragraphs. */
function page(): HTMLElement {
  document.body.innerHTML = `
    <main>
      <section data-review-id="plan">
        <h2>Spring plan</h2>
        <p id="first">The sidebar keeps its pins above the fold.</p>
        <p>Recents move under projects.</p>
      </section>
      <div data-seat="B2" style="width: 120px; height: 40px">Seat B2</div>
    </main>`;
  return document.getElementById("first") as HTMLElement;
}

describe("an anchor's layers (RV-02)", () => {
  it("records every layer that applies", () => {
    const target = page();
    const anchor = describeAnchor(target, { x: 10, y: 10 }, BUILT_IN_PROVIDERS);
    expect(anchor.reviewId).toBe("plan");
    expect(anchor.selectors?.map((selector) => selector.type)).toEqual(
      expect.arrayContaining(["CssSelector", "TextQuoteSelector"]),
    );
    expect(anchor.rect?.width).toBeGreaterThan(0);
    expect(anchor.viewport?.width).toBe(window.innerWidth);
    expect(anchor.point).toEqual({ x: 10, y: 10 });
  });

  it("resolves in order, each layer taken away leaving the next", () => {
    const target = page();
    const anchor = describeAnchor(target, undefined, BUILT_IN_PROVIDERS);
    const seats = {
      id: "seats",
      kind: "seat",
      serialize: () => undefined,
      resolve: ({ anchor: data, root }: { anchor: Record<string, unknown>; root: Element }) => {
        const seat = root.querySelector(`[data-seat="${String(data["seat"])}"]`);
        return seat ? { element: seat } : undefined;
      },
    };
    const withProvider: ReviewAnchor = {
      ...anchor,
      provider: { id: "seats", kind: "seat", data: { seat: "B2" } },
    };

    // 1. The provider's data, first.
    const byProvider = resolveAnchor(document, withProvider, [seats]);
    expect(byProvider.layer).toBe("provider");
    expect(byProvider.element?.getAttribute("data-seat")).toBe("B2");

    // 2. Its provider gone: the review ID finds the section.
    const byId = resolveAnchor(document, withProvider, []);
    expect(byId.layer).toBe("reviewId");
    expect(byId.element?.getAttribute("data-review-id")).toBe("plan");

    // 3. The review ID gone from the page: the CSS selector, its text quote agreeing.
    document.querySelector("[data-review-id]")?.removeAttribute("data-review-id");
    const bySelector = resolveAnchor(document, anchor, []);
    expect(bySelector.layer).toBe("selector");
    expect(bySelector.element).toBe(target);

    // 4. The paragraph moved (another element at its selector): the text quote finds it.
    const moved = document.createElement("p");
    moved.textContent = "A new first paragraph.";
    target.before(moved);
    target.removeAttribute("id");
    moved.id = "first";
    const byQuote = resolveAnchor(document, anchor, []);
    expect(byQuote.layer).toBe("text");
    expect(byQuote.element).toBe(target);

    // 5. Its words changed too: the box the comment was made on.
    target.textContent = "Something else entirely.";
    const byRect = resolveAnchor(document, anchor, []);
    expect(byRect.layer).toBe("rect");
    expect(byRect.rect?.width).toBeCloseTo(anchor.rect?.width ?? 0, 0);

    // 6. Nothing left: no place, and the thread stays listed by the shell.
    const { rect: _rect, ...bare } = { ...anchor, selectors: [] };
    expect(resolveAnchor(document, { ...bare, reviewId: "gone" }, []).layer).toBe("none");
  });
});

/** Selects the words `words` inside `element`'s first text. */
function select(element: Element, words: string): void {
  const node = element.firstChild as Text;
  const start = node.data.indexOf(words);
  const range = document.createRange();
  range.setStart(node, start);
  range.setEnd(node, start + words.length);
  const selection = document.getSelection() as Selection;
  selection.removeAllRanges();
  selection.addRange(range);
}

describe("selected words (WP-20, after Mirza's review)", () => {
  it("anchor as the words themselves, found again as those words, inside their element or anywhere", () => {
    const target = page();
    select(target, "keeps its pins");
    const anchor = describeSelection(document) as ReviewAnchor;
    expect(anchor.selection).toBe(true);
    expect(anchor.reviewId).toBe("plan");
    const quote = anchor.selectors?.find((selector) => selector.type === "TextQuoteSelector");
    expect(quote).toMatchObject({
      exact: "keeps its pins",
      prefix: expect.stringContaining("sidebar"),
    });
    // The box is the words', narrower than their paragraph.
    const paragraph = target.getBoundingClientRect();
    expect(anchor.rect?.width).toBeLessThan(paragraph.width);
    expect(anchor.rect?.width).toBeGreaterThan(0);
    // Found again as those words: their own box, before the review ID's section.
    const again = resolveAnchor(document, anchor, BUILT_IN_PROVIDERS);
    expect(again.layer).toBe("selector");
    expect(Math.round(again.rect?.width ?? 0)).toBe(Math.round(anchor.rect?.width ?? -1));
    // Words moved to another element, whitespace changed: still found, as text in the page.
    document.body.innerHTML = `<main><p>Our   sidebar
      keeps its pins above the fold, the plan says.</p></main>`;
    const moved = resolveAnchor(document, anchor, BUILT_IN_PROVIDERS);
    expect(moved.layer).toBe("text");
    expect(moved.rect?.width).toBeGreaterThan(0);
    // The words in two places: the one whose context matches.
    document.body.innerHTML = `<main><p id="a">Other keeps its pins too.</p>
      <p id="b">The sidebar keeps its pins above the fold.</p></main>`;
    const twice = resolveAnchor(document, anchor, BUILT_IN_PROVIDERS);
    expect(twice.element?.closest("p")?.id).toBe("b");
  });

  it("describe nothing without a selection", () => {
    page();
    document.getSelection()?.removeAllRanges();
    expect(describeSelection(document)).toBeUndefined();
  });
});
