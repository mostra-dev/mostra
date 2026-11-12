/// <reference lib="dom" />
/**
 * A team form answered by five people (J14; WP-31, D168) in Chromium, Firefox and WebKit through
 * the real gateway and shell: five personal links act as five people (CO-01); each page shows who
 * answered from `useRespondents`, and the hook, the host protocol and the CLI agree (CO-03);
 * cursors pass between the pages from `usePresence`, and a viewer who stops sharing is no longer
 * seen (CO-04); a shared field says who changed it (CO-05); and the agent's `submitted:all` wait
 * wakes when the fifth answer arrives, with all five submissions to read (CO-02).
 */
import { execFile } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { type BrowserContext, expect, type FrameLocator, type Page, test } from "@playwright/test";
import { openInShell, publishOwn, saved } from "../support/client.ts";
import { CLI, Client, readRun, SCRATCH, WIN_HELPER, WINDOWS } from "../support/mostra.ts";

const run = readRun();

const NAMES = ["Ada", "Grace", "Edsger", "Barbara", "Alan"];

interface Person {
  readonly name: string;
  readonly context: BrowserContext;
  readonly page: Page;
  readonly frame: FrameLocator;
}

/** `mostra roster get <artifact> --json` against the run's home, as an agent runs it. */
async function cliRoster(
  artifactId: string,
): Promise<{ respondents: { ref: string; status: string }[] }> {
  const scratch = mkdtempSync(join(SCRATCH, "team-cli-"));
  try {
    const windows: NodeJS.ProcessEnv = WINDOWS
      ? {
          ...Object.fromEntries(
            ["SystemRoot", "SystemDrive", "windir", "ComSpec", "PATHEXT", "LOCALAPPDATA", "APPDATA"]
              .filter((name) => process.env[name] !== undefined)
              .map((name) => [name, process.env[name] as string]),
          ),
          MOSTRA_WIN_HELPER: WIN_HELPER,
          USERPROFILE: scratch,
          TEMP: scratch,
          TMP: scratch,
        }
      : {};
    const { stdout } = await promisify(execFile)(
      process.execPath,
      [CLI, "roster", "get", artifactId, "--json"],
      {
        env: {
          PATH: process.env["PATH"] ?? "",
          HOME: scratch,
          MOSTRA_HOME: run.home,
          MOSTRA_CONFIG_DIR: join(scratch, "config"),
          TMPDIR: scratch,
          ...windows,
        },
      },
    );
    return (JSON.parse(stdout) as { result: never }).result;
  } finally {
    rmSync(scratch, { recursive: true, force: true, maxRetries: 5 });
  }
}

/** Each respondent's status as one page's `useRespondents` shows it. */
async function statuses(frame: FrameLocator): Promise<Record<string, string>> {
  const items = frame.getByTestId("respondent");
  const count = await items.count();
  const shown: Record<string, string> = {};
  for (let index = 0; index < count; index++) {
    const item = items.nth(index);
    shown[(await item.getAttribute("data-name")) ?? ""] =
      (await item.getAttribute("data-status")) ?? "";
  }
  return shown;
}

test.describe("a team form five people answer (J14)", () => {
  test("five personal links, who answered, cursors, attribution, and one wake when the last answers", async ({
    browser,
  }, info) => {
    test.setTimeout(240_000);
    const client = await Client.connect(run.socket);
    const people: Person[] = [];
    try {
      const own = await publishOwn(client, run.home, info, { fixture: "team" });
      const refs = NAMES.map((name) => `${name.toLowerCase()}-${info.project.name}@example.com`);
      const added = await client.call<{
        links: { ref: string; link: { url: string } }[];
      }>("roster/add", {
        artifact: { artifactId: own.artifactId },
        respondents: NAMES.map((name, index) => ({ ref: refs[index], name })),
      });
      expect(added.links).toHaveLength(5);

      // Five people, five browsers' worth of contexts, each on their own link.
      for (const [index, name] of NAMES.entries()) {
        const context = await browser.newContext();
        const page = await context.newPage();
        const frame = await openInShell(page, added.links[index]?.link.url as string);
        people.push({ name, context, page, frame });
      }
      const [ada, grace, edsger] = people as [Person, Person, Person, ...Person[]];

      // Everyone sees the five, each drafting (their page is open), none answered yet.
      for (const person of people) {
        await expect(person.frame.getByTestId("answered")).toHaveText("0 of 5 answered");
      }

      // Ada answers through the trusted Submit; every other page learns it at once.
      await ada.frame.getByTestId("went").fill("The demo landed");
      await saved(ada.page);
      await ada.page.locator("#mostra-submit").click();
      await expect(ada.page.locator("#mostra-submit")).toHaveText("Submitted");
      for (const person of people) {
        await expect(person.frame.getByTestId("answered")).toHaveText("1 of 5 answered");
      }

      // The hook, the host protocol and the CLI agree on everyone's status (CO-03).
      const protocol = await client.call<{ respondents: { ref: string; status: string }[] }>(
        "roster/get",
        { artifact: { artifactId: own.artifactId } },
      );
      const fromCli = await cliRoster(own.artifactId);
      expect(fromCli.respondents.map((one) => [one.ref, one.status])).toEqual(
        protocol.respondents.map((one) => [one.ref, one.status]),
      );
      const fromHook = await statuses(grace.frame);
      expect(NAMES.map((name) => fromHook[name])).toEqual(
        protocol.respondents.map((one) => one.status),
      );
      expect(fromHook["Ada"]).toBe("submitted");

      // Cursors: Grace and Edsger move theirs; Ada sees both, by name, where they are (CO-04).
      const box = await grace.page.locator("iframe.mostra-frame").boundingBox();
      if (!box) throw new Error("no frame");
      await grace.page.mouse.move(box.x + 120, box.y + 300);
      await grace.page.mouse.move(box.x + 140, box.y + 320);
      await edsger.page.mouse.move(box.x + 200, box.y + 400);
      await edsger.page.mouse.move(box.x + 220, box.y + 420);
      const graceOnAda = ada.frame.locator('[data-testid="peer"][data-name="Grace"]');
      const edsgerOnAda = ada.frame.locator('[data-testid="peer"][data-name="Edsger"]');
      await expect(graceOnAda).toHaveAttribute("data-cursor", /^\d+,\d+$/, { timeout: 10_000 });
      await expect(edsgerOnAda).toHaveAttribute("data-cursor", /^\d+,\d+$/, { timeout: 10_000 });
      // Edsger stops sharing: Ada no longer sees his cursor, though he is still here.
      await edsger.frame.getByLabel("Share my cursor").uncheck();
      await expect(edsgerOnAda).toHaveAttribute("data-cursor", "", { timeout: 10_000 });

      // Attribution: Grace edits the shared list; Edsger's page says who changed it (CO-05).
      await grace.frame.getByTestId("actions").fill("Ship the CLI");
      await saved(grace.page);
      await expect(edsger.frame.getByTestId("changed-by")).toHaveText("Grace", { timeout: 10_000 });
      await expect(grace.frame.getByTestId("changed-by")).toHaveText("you");

      // The agent waits for everyone; the fifth answer wakes it once (CO-02).
      const waiting = client.call<{ status: string; event: { type: string } }>("wait", {
        artifact: { artifactId: own.artifactId },
        until: "submitted:all",
        timeoutMs: 120_000,
      });
      let woke = false;
      void waiting.then(() => {
        woke = true;
      });
      for (const person of people.slice(1)) {
        expect(woke).toBe(false);
        await person.frame.getByTestId("went").fill(`From ${person.name}`);
        await saved(person.page);
        await person.page.locator("#mostra-submit").click();
        await expect(person.page.locator("#mostra-submit")).toHaveText("Submitted");
      }
      const done = await waiting;
      expect(done).toMatchObject({ status: "satisfied", event: { type: "roster.completed" } });
      for (const person of people) {
        await expect(person.frame.getByTestId("answered")).toHaveText("5 of 5 answered");
      }
      const listed = await client.call<{ results: { answers: { went?: string } }[] }>(
        "results/list",
        { artifact: { artifactId: own.artifactId } },
      );
      expect(listed.results.map((one) => one.answers.went)).toEqual([
        "The demo landed",
        "From Grace",
        "From Edsger",
        "From Barbara",
        "From Alan",
      ]);
    } finally {
      for (const person of people) await person.context.close();
      client.close();
    }
  });
});
