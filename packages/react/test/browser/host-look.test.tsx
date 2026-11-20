/**
 * The host's look on a page (D179 item 5, KT-04), in a real browser: the host's light or dark
 * always applies; its variables reach the page's tokens only where the page's stack names
 * `"host"`, over everything when it is last and under the page's own layers when they follow it.
 */
import { afterEach, describe, expect, it } from "vitest";
import { applyHostContext } from "../../src/runtime/mcp-theme.ts";

const root = document.documentElement;

/** The page's own theme, as a build's stylesheet declares it (`:where(:root)`), and its table. */
function page(look: "over" | "under" | undefined, own?: string): void {
  const theme = document.createElement("style");
  theme.id = "theme";
  theme.textContent = `:where(:root) { --background: rgb(255, 255, 255); --radius: 2px; }${own ?? ""}`;
  document.head.append(theme);
  const table = document.createElement("script");
  table.type = "application/json";
  table.id = "mostra-host-tokens";
  table.textContent = JSON.stringify({
    "--background": ["--color-background-primary"],
    "--radius": ["--border-radius-md"],
  });
  document.head.append(table);
  if (look !== undefined) root.dataset["hostLook"] = look;
}

const token = (name: string): string => getComputedStyle(root).getPropertyValue(name).trim();

const HOST = {
  theme: "dark",
  styles: {
    variables: {
      "--color-background-primary": "rgb(10, 20, 30)",
      "--border-radius-md": "12px",
      "--color-text-primary": "red; } body { display: none",
    },
  },
};

afterEach(() => {
  for (const id of ["theme", "mostra-host-tokens", "mostra-host-look"]) {
    document.getElementById(id)?.remove();
  }
  root.removeAttribute("style");
  delete root.dataset["hostLook"];
  delete root.dataset["appearance"];
});

describe("a host's look (D179 item 5)", () => {
  it("leaves a page that doesn't name host in its own theme, and still follows light or dark", () => {
    page(undefined);
    applyHostContext(HOST);
    expect(token("--background")).toBe("rgb(255, 255, 255)");
    expect(token("--radius")).toBe("2px");
    expect(root.dataset["appearance"]).toBe("dark");
  });

  it("puts the host's values over the page's theme where host is last", () => {
    page("over", ":root { --radius: 4px; }");
    applyHostContext(HOST);
    expect(token("--background")).toBe("rgb(10, 20, 30)");
    // Over the page's own rules too: last in the stack.
    expect(token("--radius")).toBe("12px");
    // A value that would end the declaration is no value.
    expect(token("--color-text-primary")).toBe("");
    // A variable the host no longer gives goes back to the page's own.
    applyHostContext({ styles: { variables: {} } });
    expect(token("--background")).toBe("rgb(255, 255, 255)");
  });

  it("puts them under the page's own layers where those follow host", () => {
    page("under", ":root { --radius: 4px; }");
    applyHostContext(HOST);
    expect(token("--background")).toBe("rgb(10, 20, 30)");
    expect(token("--radius")).toBe("4px");
    expect(document.getElementById("mostra-host-look")?.textContent).not.toContain("display");
  });
});
