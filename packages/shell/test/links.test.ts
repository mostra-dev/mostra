import { describe, expect, it } from "vitest";
import { openLink } from "../src/links.ts";
import { describeAccess, describeLink, prefersOffered } from "../src/messages.ts";

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

  it("says whose each link is, so a share's link and a personal one never read the same (#184)", () => {
    const scopes = ["draft", "submit", "view"];
    const shared = describeLink({ scopes, personal: false });
    const sams = describeLink({ scopes, personal: true, name: "Sam Okafor" });
    expect(shared).toBe("A shared link. Can view, save answers and submit.");
    expect(sams).toBe("A personal link, for Sam Okafor. Can view, save answers and submit.");
    expect(sams).not.toBe(shared);
    expect(describeLink({ scopes, personal: true })).toBe(
      "A personal link. Can view, save answers and submit.",
    );
    // A gateway from before #184 says nothing of whose: the words are what they were.
    expect(describeLink({ scopes })).toBe(describeAccess({ scopes }));
  });

  it("puts a personal link first only over a link that names nobody (#184)", () => {
    const shared = { personal: false };
    const personal = { personal: true };
    expect(prefersOffered({ current: shared, offered: personal })).toBe(true);
    expect(prefersOffered({ current: {}, offered: personal })).toBe(true);
    expect(prefersOffered({ current: personal, offered: personal })).toBe(false);
    expect(prefersOffered({ current: personal, offered: shared })).toBe(false);
    expect(prefersOffered({ current: shared, offered: shared })).toBe(false);
    expect(prefersOffered({ current: shared, offered: {} })).toBe(false);
  });
});
