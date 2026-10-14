import { describe, expect, it } from "vitest";
import { openLink } from "../src/links.ts";
import { describeAccess } from "../src/messages.ts";

describe("ui/open-link (D98 item 7)", () => {
  it("opens web, mail and phone links in a new tab without an opener", () => {
    for (const url of [
      "https://example.com/a?b#c",
      "http://127.0.0.1:9/",
      "mailto:a@b.c",
      "tel:+1",
    ]) {
      const opened: unknown[][] = [];
      expect(openLink(url, (...args) => opened.push(args))).toEqual({});
      expect(opened).toEqual([[new URL(url).href, "_blank", "noopener,noreferrer"]]);
    }
  });

  it("refuses schemes that would run or show content in the shell, and non-URLs", () => {
    for (const url of [
      "javascript:alert(1)",
      " JavaScript:alert(1)",
      "data:text/html,<script>1</script>",
      "blob:http://127.0.0.1/x",
      "file:///etc/passwd",
      "about:blank",
      "/relative",
      "not a url",
    ]) {
      const opened: unknown[] = [];
      expect(
        openLink(url, (...args) => opened.push(args)),
        url,
      ).toEqual({ isError: true });
      expect(opened, url).toEqual([]);
    }
  });
});

describe("the choice between two links (D98 item 8)", () => {
  it("says what each link allows in plain words", () => {
    expect(describeAccess({ scopes: ["view"] })).toBe("Can view.");
    expect(describeAccess({ scopes: ["view", "review"], version: 2 })).toBe(
      "Can view and comment and choose, version 2 only.",
    );
    expect(
      describeAccess({ scopes: ["action:*", "draft", "review", "signal", "submit", "view"] }),
    ).toBe(
      "Can view, save answers, submit, comment and choose, notify the agent and run every action.",
    );
    expect(describeAccess({ scopes: ["view", "action:send"] })).toBe("Can view and run send.");
  });
});
