/**
 * A server's own pages in its operator's theme and name (D171), through the real server: the API
 * origin's pages and every refused navigation load one stylesheet, the faces and the marks from
 * their own origin and run nothing; a person's light-or-dark choice is a host-only cookie a form of
 * the API origin sets, and only that origin's; the server's `appearance` names it, dresses it and
 * picks the default, and a logo or a footer link it can't use stops it before it serves; a page
 * that isn't dressed as Mostra always says it runs on Mostra.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Answer, send } from "../browser-client.ts";
import {
  freePort,
  type RunningServer,
  startServer,
  stopServer,
  testConfig,
} from "../server-support.ts";
import { tempDir } from "../support.ts";

const header = (answer: Answer, name: string): string => answer.headers[name]?.join(", ") ?? "";

/** A person's navigation: what a browser sends for a page. */
const page = (url: string, headers: Record<string, string> = {}): Promise<Answer> =>
  send({ url, headers: { accept: "text/html", "sec-fetch-dest": "document", ...headers } });

describe("a server's own pages (D171)", () => {
  let port: number;
  let server: RunningServer;
  let api: string;

  beforeAll(async () => {
    port = await freePort();
    server = await startServer({ data: tempDir("pages-data"), port });
    api = `http://api.localhost:${port}`;
  }, 60_000);

  afterAll(async () => {
    await stopServer(server);
  });

  it("draws the device page in Studio, with its files from its own origin and no script", async () => {
    const device = await page(`${api}/device?user_code=WXYZ-2345`);
    expect(device.status).toBe(200);
    expect(device.body).toContain("Link this machine");
    expect(device.body).toContain('value="WXYZ-2345"');
    expect(device.body).not.toMatch(/<script/i);
    expect(device.body).not.toMatch(/\sstyle=/);
    const csp = header(device, "content-security-policy");
    expect(csp).toContain("style-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain("unsafe-inline");
    // Not dressed as Mostra: it says what it runs on, linking to Mostra.
    expect(device.body).toContain("Runs on Mostra");
    const sheet = /href="(\/_mostra\/theme\/pages-studio-[0-9a-z]+\.css)"/.exec(device.body)?.[1];
    expect(sheet, device.body).toBeDefined();
    const css = await send({ url: `${api}${sheet}` });
    expect(css.status).toBe(200);
    expect(header(css, "content-type")).toContain("text/css");
    expect(header(css, "cache-control")).toContain("immutable");
    const face = /url\("([^"]*figtree-latin-wght-normal\.woff2)"\)/.exec(css.body)?.[1];
    expect(face, css.body.slice(0, 400)).toBeDefined();
    const font = await send({ url: new URL(face as string, `${api}${sheet}`).href });
    expect(font.status).toBe(200);
    expect(header(font, "content-type")).toBe("font/woff2");
    const mark = await send({ url: `${api}/_mostra/theme/marks/mark-colour.svg` });
    expect(mark.status).toBe(200);
    // An SVG opened on its own runs nothing.
    expect(header(mark, "content-security-policy")).toContain("sandbox");
    expect((await send({ url: `${api}/_mostra/theme/nothing.css` })).status).toBe(404);
  });

  it("keeps a person's light or dark choice, set only by its own origin's form", async () => {
    const chosen = await send({
      method: "POST",
      url: `${api}/_mostra/appearance`,
      headers: { origin: api, "content-type": "application/x-www-form-urlencoded" },
      body: "appearance=dark&next=%2Fdevice%3Fuser_code%3DWXYZ-2345",
    });
    expect(chosen.status).toBe(303);
    expect(header(chosen, "location")).toBe("/device?user_code=WXYZ-2345");
    const cookie = header(chosen, "set-cookie");
    expect(cookie).toMatch(/^mostra-appearance=dark; Path=\/; Max-Age=31536000; SameSite=Lax$/);
    const dark = await page(`${api}/device`, { cookie: "mostra-appearance=dark" });
    expect(dark.body).toContain('data-appearance="dark"');
    // Another origin's form sets nothing; a `next` elsewhere comes back here.
    const foreign = await send({
      method: "POST",
      url: `${api}/_mostra/appearance`,
      headers: {
        origin: "https://evil.example",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: "appearance=dark&next=%2Fdevice",
    });
    expect(header(foreign, "set-cookie")).toBe("");
    const away = await send({
      method: "POST",
      url: `${api}/_mostra/appearance`,
      headers: { origin: api, "content-type": "application/x-www-form-urlencoded" },
      body: "appearance=light&next=%2F%2Fevil.example",
    });
    expect(header(away, "location")).toBe("/");
  });

  it("answers an unknown host's navigation with a page in the theme, and anything else with JSON", async () => {
    const refused = await page(`http://elsewhere.localhost:${port}/`);
    expect(refused.status).toBe(421);
    expect(refused.body).toContain("MOSTRA_HYGIENE_HOST_REFUSED");
    expect(refused.body).toContain("/_mostra/theme/pages-studio-");
    expect(refused.body).not.toMatch(/<script/i);
    expect(header(refused, "content-security-policy")).not.toContain("unsafe-inline");
    const json = await send({
      url: `http://elsewhere.localhost:${port}/`,
      headers: { accept: "application/json" },
    });
    expect(json.status).toBe(421);
    expect(JSON.parse(json.body)).toMatchObject({ code: "MOSTRA_HYGIENE_HOST_REFUSED" });
  });

  it("dresses a hosted link's refused navigation the same way", async () => {
    const gone = await page(`http://content.localhost:${port}/a/rte_01JB8Z3QF6S7W3N8D5K2C4V9ZZ`);
    expect(gone.status).toBeGreaterThanOrEqual(400);
    expect(gone.body).not.toMatch(/<script/i);
  });
});

describe("a server's appearance (D171 item 4)", () => {
  it("names the server, dresses it as Mostra and opens dark by default", async () => {
    const port = await freePort();
    const server = await startServer({
      data: tempDir("pages-brand"),
      port,
      config: testConfig(port, {
        appearance: {
          theme: "mostra",
          name: "Acme Pages",
          stageLine: "Pages from Acme.",
          default: "dark",
          footer: [{ href: "https://acme.example/terms", text: "Terms" }],
        },
      }),
    });
    try {
      const device = await page(`http://api.localhost:${port}/device`);
      expect(device.body).toContain("pages-mostra-");
      expect(device.body).toContain("Pages from Acme.");
      expect(device.body).toContain('data-appearance="dark"');
      expect(device.body).toContain('href="https://acme.example/terms"');
      // Dressed as Mostra, it needs no "Runs on Mostra".
      expect(device.body).not.toContain("Runs on Mostra");
    } finally {
      await stopServer(server);
    }
  });

  it("serves an operator's own logo and says it runs on Mostra", async () => {
    const port = await freePort();
    const dir = tempDir("pages-logo");
    const logo = join(dir, "acme.svg");
    writeFileSync(
      logo,
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>',
    );
    const server = await startServer({
      data: tempDir("pages-logo-data"),
      port,
      config: testConfig(port, {
        appearance: {
          name: "Acme Pages",
          logo: { file: logo, alt: "Acme", width: 24, height: 24 },
        },
      }),
    });
    try {
      const device = await page(`http://api.localhost:${port}/device`);
      expect(device.body).toContain('src="/_mostra/theme/logo.svg"');
      expect(device.body).toContain("Runs on Mostra");
      const served = await send({ url: `http://api.localhost:${port}/_mostra/theme/logo.svg` });
      expect(served.status).toBe(200);
      expect(header(served, "content-type")).toBe("image/svg+xml");
    } finally {
      await stopServer(server);
    }
  });

  it("stops before serving on a logo or a footer link it can't use", async () => {
    const port = await freePort();
    for (const appearance of [
      { logo: { file: "/nowhere/acme.svg", alt: "Acme", width: 24, height: 24 } },
      { logo: { file: "/nowhere/acme.gif", alt: "Acme", width: 24, height: 24 } },
      { footer: [{ href: "javascript:alert(1)", text: "Terms" }] },
      { name: "Acme\u202ePages" },
    ]) {
      const server = await startServer({
        data: tempDir("pages-bad"),
        port,
        config: testConfig(port, { appearance }),
      });
      expect(server.status, JSON.stringify(appearance)).toMatchObject({
        status: "failed",
        diagnostic: { code: "MOSTRA_REMOTE_CONFIG_INVALID" },
      });
      expect(server.status.diagnostic?.message).toContain("appearance");
      await server.exited;
    }
  });
});
