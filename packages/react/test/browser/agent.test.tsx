/**
 * The page's review agent and the frames inside a page (WP-20's review, findings 7 and 10), in a
 * real browser: a frame Mostra doesn't serve is never asked about a point, and nothing it answers
 * counts, and a frame's selector is a CSS selector that finds that frame.
 */
import { afterEach, describe, expect, it } from "vitest";
import { hitTest } from "../../src/review/agent.ts";

afterEach(() => {
  document.body.replaceChildren();
});

/** A frame that answers the nested protocol with an anchor of its own making, as a forger would. */
const FORGER = `<!doctype html><body style="margin:0"><div style="height:200px">widget</div><script>
  addEventListener("message", (event) => {
    const data = event.data;
    if (!data || typeof data["mostra-review"] !== "string") return;
    window.parent.postMessage(
      { "mostra-review": "answer", id: data.id, answer: { anchor: { reviewId: "forged" },
        rect: { x: 0, y: 0, width: 10, height: 10 } } },
      "*",
    );
  });
</script></body>`;

async function loaded(frame: HTMLIFrameElement): Promise<void> {
  await new Promise<void>((resolve) =>
    frame.addEventListener("load", () => resolve(), { once: true }),
  );
  // The frame's script has registered its listener.
  await new Promise((resolve) => setTimeout(resolve, 50));
}

describe("frames inside a page (findings 7, 10)", () => {
  it("never takes an anchor from a frame Mostra doesn't serve, and names each frame by a selector that finds it", async () => {
    document.body.innerHTML = `
      <main>
        <section><iframe title="first" style="width:200px;height:100px;border:0"></iframe></section>
        <section><p>Between</p><iframe id="widget" title="widget" sandbox="allow-scripts"
          style="width:300px;height:200px;border:0"></iframe></section>
      </main>`;
    const frame = document.getElementById("widget") as HTMLIFrameElement;
    frame.removeAttribute("id");
    const ready = loaded(frame);
    frame.srcdoc = FORGER;
    await ready;
    const box = frame.getBoundingClientRect();
    const hit = await hitTest(document, box.left + 20, box.top + 20);
    // The widget's own answer counts for nothing: the anchor is an opaque frame's.
    expect(hit.anchor?.reviewId).toBeUndefined();
    expect(hit.anchor?.frames?.[0]?.served).toBe(false);
    // Its selector is CSS that finds this frame, not the second frame of the document.
    const selector = hit.anchor?.frames?.[0]?.selector ?? "";
    expect(document.querySelector(selector)).toBe(frame);
    expect(document.querySelectorAll(selector)).toHaveLength(1);
  });
});
