/**
 * Viewing: capability links the host mints, and the gateway's hygiene against strangers (H-07,
 * H-14, HY-01, HY-03), then the shell and its bridge in a real browser (D108, SH-02).
 */
import { FORM, FORM_V2 } from "../fixtures.ts";
import { check, NotApplicable, type Scenario, same } from "../scenario.ts";
import { OpenError, parseLink, send, Viewer } from "../viewer.ts";

/** H-07, H-14: publish answers a durable receipt with a link; links are scoped, revoked, rotated. */
export const links: Scenario = {
  id: "viewing.links",
  title:
    "Publish returns a durable receipt with the artifact's link; view/url mints scoped links, a link without submit can't submit, and revoked or rotated links answer 410",
  covers: ["HO-05", "H-07", "H-14", "HY-03"],
  async run(context) {
    await context.start();
    const receipt = await context.published(FORM);
    check(receipt.url && receipt.tokenId, "the publish receipt has no link (H-07)");
    check(/^\d+$/.test(receipt.cursor), `the receipt's cursor (${receipt.cursor})`);
    const viewOnly = await context.viewer(receipt.artifactId, { link: { scopes: ["view"] } });
    const written = await viewOnly.write({ name: "x" });
    same(
      [written.status, written.json<{ code?: string }>().code],
      [403, "MOSTRA_HYGIENE_SCOPE_DENIED"],
      "a view-only link's write",
    );
    const minted = await context.host.call<{ url: string; tokenId: string }>("view/url", {
      artifact: { artifactId: receipt.artifactId },
    });
    await context.host.call("view/revoke", { tokenId: minted.tokenId });
    const revoked = await Viewer.open(minted.url).then(
      () => undefined,
      (error: unknown) => error,
    );
    check(revoked instanceof OpenError, "a revoked link still opened");
    same([revoked.status, revoked.code], [410, "MOSTRA_HYGIENE_TOKEN_REVOKED"], "a revoked link");
    const rotated = await context.host.call<{ url: string }>("view/rotate", {
      tokenId: receipt.tokenId,
    });
    const old = await Viewer.open(receipt.url).then(
      () => undefined,
      (error: unknown) => error,
    );
    check(
      old instanceof OpenError && old.status === 410,
      "the default link still opens after its rotation",
    );
    await Viewer.open(rotated.url);
    // A link that names a version opens that version, also after a newer one.
    context.rewrite(receipt.dir, FORM_V2);
    await context.publish(receipt.dir);
    const pinned = await context.viewer(receipt.artifactId, { link: { version: 1 } });
    same(pinned.ticket.version.number, 1, "the version a pinned link opens");
    same(pinned.ticket.latest.number, 2, "the latest version it reports");
  },
};

/** HY-01: the gateway refuses strangers: wrong Host, wrong Origin, no token, no CSRF token. */
export const hygiene: Scenario = {
  id: "viewing.hygiene",
  title:
    "The host's instance refuses requests from strangers: an unknown Host (421), a foreign Origin (403), a wrong token (401), a mutation without its CSRF token (403)",
  covers: ["HO-05", "HY-01"],
  async run(context) {
    await context.start();
    const receipt = await context.published(FORM);
    const link = parseLink(await context.link(receipt.artifactId));
    const exchange = `${link.origin}/a/${link.artifactId}/_mostra/session`;
    const post = (headers: Record<string, string>, body: unknown) =>
      send({
        method: "POST",
        url: exchange,
        headers: {
          "content-type": "application/json",
          "sec-fetch-site": "same-origin",
          origin: link.origin,
          ...headers,
        },
        body: JSON.stringify(body),
      });
    const host = await post({ host: "evil.example" }, { token: link.secret });
    same(host.status, 421, "an unknown Host");
    const origin = await post({ origin: "http://evil.example" }, { token: link.secret });
    same(origin.status, 403, "a foreign Origin");
    const token = await post({}, { token: "A".repeat(26) });
    same(token.status, 401, "a wrong token");
    const viewer = await Viewer.open(await context.link(receipt.artifactId));
    const noCsrf = await viewer.browser.ask({
      method: "POST",
      url: `${viewer.ticket.artifactOrigin}/_mostra/v/2026-10-15/signal`,
      headers: {
        "content-type": "application/json",
        origin: viewer.ticket.artifactOrigin,
        "sec-fetch-site": "same-origin",
      },
      body: JSON.stringify({ viewId: viewer.viewId, name: "ping" }),
    });
    same(noCsrf.status, 403, "a mutation without its CSRF token");
    for (const answer of [host, origin, token, noCsrf]) {
      check(
        !Object.keys(answer.headers).some((name) => name.startsWith("access-control-")),
        "a refusal carries a CORS header",
      );
    }
  },
};

/**
 * D108, SH-02, SH-04: the shell and the page in a real browser. The trusted Submit carries the
 * label the page asked for (`mostra/controls.request`), lists the required answer by label
 * (`mostra/fields`) and focuses it in the page (`mostra/field.focus`), submits only after the page
 * flushed its saves, the defaults it showed included (`mostra/flush`, D110), and a new version
 * shows the trusted banner (`mostra/version.available`).
 */
export const shellBridge: Scenario = {
  id: "viewing.shell-bridge",
  title:
    "In a browser, the shell and the page speak the bridge: a labelled trusted Submit, blockers by label that focus the field, a flush before submit, and the new-version banner",
  covers: ["HO-05", "SH-02", "SH-04", "H-05"],
  async run(context) {
    let chromium: typeof import("playwright-core").chromium;
    try {
      ({ chromium } = await import("playwright-core"));
    } catch {
      throw new NotApplicable("playwright-core isn't installed");
    }
    const browser = await chromium.launch().catch((error: unknown) => {
      throw new NotApplicable(
        `no browser to run the shell in (${(error as Error).message.split("\n")[0]})`,
      );
    });
    try {
      await context.start();
      const receipt = await context.published(FORM);
      const page = await browser.newPage();
      await page.goto(await context.link(receipt.artifactId));
      await page.waitForSelector('html[data-shell="ready"]', { timeout: 60_000 });
      const frame = page.frameLocator("iframe");
      const submit = page.locator("#mostra-submit");
      await submit.waitFor();
      check(
        (await submit.textContent())?.includes("Send answers"),
        "the trusted Submit's label isn't the one the page asked for",
      );
      // The required answer is listed by label, and picking it focuses the field in the page.
      await page.waitForTimeout(600);
      await submit.click();
      const blocker = page.locator("[data-mostra-blocker=name]");
      await blocker.waitFor({ timeout: 10_000 });
      same((await blocker.textContent())?.trim(), "Your name", "the blocker's label");
      await blocker.click();
      await frame.getByLabel("Your name").waitFor();
      await context.eventually(
        "picking the blocker focuses the field in the page (mostra/field.focus)",
        () =>
          frame
            .locator('[name="name"]')
            .evaluate(
              (element: { ownerDocument: { activeElement: unknown } }) =>
                element === element.ownerDocument.activeElement,
            ),
        10_000,
      );
      await frame.getByLabel("Your name").fill("Ada");
      await context.eventually("the trusted Submit submits", async () => {
        if ((await submit.textContent())?.includes("Submitted")) return true;
        await submit.click().catch(() => undefined);
        return (await submit.textContent())?.includes("Submitted");
      });
      const read = await context.results(receipt.artifactId);
      same(read["submission"].channel, "shell", "the trusted Submit's channel");
      // The page flushed first: the answer typed, and the default it showed for "comment".
      same(read["answers"], { name: "Ada", comment: "" }, "the answers, defaults included (D110)");
      context.rewrite(receipt.dir, FORM_V2);
      await context.publish(receipt.dir);
      await page.locator('[data-mostra-banner="2"]').waitFor({ timeout: 15_000 });
    } finally {
      await browser.close();
    }
  },
};

/** The viewing scenarios. */
export const VIEWING_SCENARIOS: readonly Scenario[] = [links, hygiene, shellBridge];
