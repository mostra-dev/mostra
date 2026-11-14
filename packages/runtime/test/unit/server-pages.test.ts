/**
 * The server's own pages (D171), as data: the API origin's pages escape every name they're given
 * and run nothing; a refused navigation says what the shell would say for the same refusal, word
 * for word, so a person meets one voice whichever of the two drew the page.
 */
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import {
  defaultPages,
  PAGE_REFUSALS,
  refusalDocument,
  serverPages,
} from "../../src/gateway/index.ts";
import { createApiPages } from "../../src/server/pages.ts";

describe("the server's own pages (D171)", () => {
  const server = serverPages(undefined, { appearanceAction: "/_mostra/appearance" });
  const pages = createApiPages(server, server.name);
  const at = { path: "/device" };

  it("say what the shell says for the refusals a link can end on", async () => {
    // The shell is a browser package the runtime never imports: its words are read here only.
    const shell = (await import(
      pathToFileURL(join(import.meta.dirname, "..", "..", "..", "shell", "src", "messages.ts")).href
    )) as { explain(code: string): { title: string; detail: string } };
    for (const [code, words] of Object.entries(PAGE_REFUSALS)) {
      expect(shell.explain(code), code).toEqual(words);
    }
  });

  it("escape every name a provider, an app or a person gives, and run nothing", () => {
    const hostile = `<img src=x onerror=alert(1)>"'&`;
    const allow = pages.allow(
      at,
      { action: "/oauth/authorize/continue?authorize=a&b", csrf: "c" },
      { name: hostile, unverified: true },
      hostile,
      "client.example",
      true,
    );
    const device = pages.deviceForm(at, {
      code: hostile,
      message: hostile,
      signedIn: { name: hostile, csrf: hostile },
    });
    const signIn = pages.signIn(at, [{ id: "x", label: hostile }], "/next?a=1&b=2", hostile);
    for (const page of [allow, device, signIn, pages.problem(at, hostile)]) {
      expect(page).not.toContain("<img src=x");
      expect(page).not.toMatch(/<script/i);
      // No event handler in any tag: the hostile text lands escaped, as text or inside a quoted
      // attribute value, never as an attribute of its own.
      expect(page.replace(/"[^"]*"/g, '""')).not.toMatch(/<[^>]*\son[a-z]+=/i);
      expect(page).toMatch(/&(?:lt|#60|#x3c);img/i);
    }
    expect(allow).toContain('action="/oauth/authorize/continue?authorize=a&#38;b"');
    expect(signIn).toContain("next=%2Fnext%3Fa%3D1%26b%3D2");
  });

  it("name the server as configured, and only say Mostra when it is", () => {
    expect(pages.signIn(at, [], "/")).toContain("Sign in to Mostra");
    const acme = serverPages({ name: "Acme Pages" });
    expect(createApiPages(acme, acme.name).signIn(at, [], "/")).toContain("Sign in to Acme Pages");
    const nameless = serverPages({ name: null });
    const page = createApiPages(nameless, nameless.name).signIn(at, [], "/");
    expect(page).toContain("<h1");
    expect(page).toContain(">Sign in<");
    // Not dressed as Mostra, every page says what it runs on (D171 item 4).
    expect(page).toContain("Runs on Mostra");
  });

  it("keep a refusal's code in small print, and its words from the diagnostic otherwise", () => {
    const known = refusalDocument(defaultPages().pages, {
      title: "Developer words",
      detail: "Developer hint",
      code: "MOSTRA_REMOTE_HOME_MOVING",
    });
    expect(known).toContain("This page is moving");
    expect(known).not.toContain("Developer words");
    expect(known).toContain('<code translate="no">MOSTRA_REMOTE_HOME_MOVING</code>');
    const other = refusalDocument(defaultPages().pages, {
      title: "Something else went wrong",
      code: "MOSTRA_SOMETHING",
    });
    expect(other).toContain("Something else went wrong");
  });
});
