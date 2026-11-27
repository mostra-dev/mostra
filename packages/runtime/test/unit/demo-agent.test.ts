/**
 * Where Mostra writes the review agent into a demo's documents (D185 item 5): first in its head,
 * never before its doctype, which would put the demo in quirks mode in its version and in every
 * export (review of WP-24, finding 13).
 */
import { describe, expect, it } from "vitest";
import { withHeadTag } from "../../src/demos/index.ts";

const TAG = "<script>agent()</script>";

describe("a demo's review agent", () => {
  it("goes first in the head, or after <html>, or after the doctype, never before it", () => {
    expect(withHeadTag("<!doctype html><html><head><title>x</title></head></html>", TAG)).toBe(
      `<!doctype html><html><head>${TAG}<title>x</title></head></html>`,
    );
    expect(withHeadTag('<!DOCTYPE html><html lang="en"><body>x</body></html>', TAG)).toBe(
      `<!DOCTYPE html><html lang="en">${TAG}<body>x</body></html>`,
    );
    expect(withHeadTag("<!doctype html><p>x</p>", TAG)).toBe(`<!doctype html>${TAG}<p>x</p>`);
    expect(withHeadTag("<p>x</p>", TAG)).toBe(`${TAG}<p>x</p>`);
  });
});
