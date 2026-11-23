/**
 * An anchor's layers and the order they resolve in (RV-02, D183 item 6), in a real browser: a
 * comment's anchor keeps every layer that applies, and each layer taken away leaves the next to
 * find the place: an anchor provider's data, the `data-review-id`, the CSS selector checked by its
 * text quote, the text quote alone, then the box.
 */
import type { ReviewAnchor } from "@mostra/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { describe as describeAnchor, resolveAnchor } from "../../src/review/anchors.ts";
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
