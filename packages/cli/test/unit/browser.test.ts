/** How `mostra open` hands a launch URL to a browser (D140 item 15, Opus review findings 4, 7). */
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { browserCommands, launchPage, splitCommand, writeLaunchPage } from "../../src/browser.ts";

describe("the browser command (Opus review finding 7)", () => {
  it("reads $BROWSER as xdg-open does: a : list, %s replaced, else the target appended", () => {
    expect(browserCommands("/p.html", { BROWSER: "firefox" }, "linux")).toEqual([
      ["firefox", "/p.html"],
    ]);
    expect(browserCommands("/p.html", { BROWSER: "firefox --new-window %s" }, "linux")).toEqual([
      ["firefox", "--new-window", "/p.html"],
    ]);
    expect(
      browserCommands("/p.html", { BROWSER: "w3m:'/opt/My Browser/run' %s %%" }, "linux"),
    ).toEqual([
      ["w3m", "/p.html"],
      ["/opt/My Browser/run", "/p.html", "%"],
    ]);
    expect(browserCommands("/p.html", {}, "darwin")).toEqual([["open", "/p.html"]]);
    expect(browserCommands("/p.html", { BROWSER: " " }, "linux")).toEqual([
      ["xdg-open", "/p.html"],
    ]);
  });

  it("splits words and quotes without a shell", () => {
    expect(splitCommand(`a "b c" 'd e' f\\ g`)).toEqual(["a", "b c", "d e", "f g"]);
    expect(splitCommand(`x ""`)).toEqual(["x", ""]);
    expect(splitCommand("$(rm -rf ~) ; ls")).toEqual(["$(rm", "-rf", "~)", ";", "ls"]);
  });
});

const bases: string[] = [];
const freshBase = (): string => {
  const base = mkdtempSync(join(tmpdir(), "mostra-open-test-"));
  bases.push(base);
  return base;
};
afterAll(() => {
  for (const base of bases) rmSync(base, { recursive: true, force: true });
});

describe("the launch page (Opus review finding 4)", () => {
  it("is mode 0600 in a fresh 0700 directory, and nothing in the URL escapes its quoting", () => {
    const base = freshBase();
    const url = 'http://127.0.0.1:20000/a/art_X#l=ABC"</script><b>';
    const file = writeLaunchPage(url, base);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(statSync(dirname(file)).mode & 0o777).toBe(0o700);
    const text = readFileSync(file, "utf8");
    expect(text).toBe(launchPage(url));
    expect(text).not.toContain("</script><b>");
    expect(text).toContain("\\u003c/script>");
    expect(text).toContain("&quot;&lt;/script&gt;&lt;b&gt;");
  });

  it("removes an earlier launch's page once its ticket has expired, never a recent one", () => {
    const base = freshBase();
    const old = writeLaunchPage("http://127.0.0.1:1/a/x#l=1", base, Date.now());
    const recent = writeLaunchPage("http://127.0.0.1:1/a/x#l=2", base, Date.now());
    expect(statSync(old).isFile()).toBe(true);
    writeLaunchPage("http://127.0.0.1:1/a/x#l=3", base, Date.now() + 3 * 60_000);
    expect(() => statSync(old)).toThrow();
    expect(() => statSync(recent)).toThrow();
    const fresh = writeLaunchPage("http://127.0.0.1:1/a/x#l=4", base, Date.now());
    writeLaunchPage("http://127.0.0.1:1/a/x#l=5", base, Date.now());
    expect(statSync(fresh).isFile()).toBe(true);
  });
});
