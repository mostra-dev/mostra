/**
 * The open server holds no operating layer (RM-03, D165 item 11, ARCHITECTURE §15.10): plans,
 * quotas, billing, abuse scoring, placement, backup automation, domain moves, webhooks and mail come
 * through the operator ports from a module outside the core, never from code in it. Two audits:
 * the server's and the owner link's code (comments aside) names none of those concerns, and the
 * packages they import are exactly the ones this test lists, so a payment, mail or scoring SDK can't
 * arrive unnoticed. `tools/audit/host-neutral.ts` and dependency-cruiser keep `ee/` and host code out
 * the same way.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = fileURLToPath(new URL("../../src", import.meta.url));
const MODULES = ["server", "link"];

/** Every source file of a module, with its comments removed. */
function sources(module: string): { file: string; code: string }[] {
  const dir = join(SRC, module);
  return readdirSync(dir, { recursive: true })
    .map(String)
    .filter((name) => name.endsWith(".ts"))
    .map((name) => {
      const text = readFileSync(join(dir, name), "utf8");
      const code = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
      return { file: `${module}/${name}`, code };
    });
}

/** The concerns the operating layer owns (D165 item 11), as code would name them. */
const OPERATING_LAYER =
  /\b(billing|invoice|payment|subscription|entitlement|stripe|paddle|smtp|mailer|sendmail|nodemailer|webhook|abuseScore|scoring|placement|backupSchedule|geoip)\b/i;

/** What the server and the owner's link may import from outside the runtime (REPO_STANDARDS §3). */
const ALLOWED_PACKAGES = new Set([
  "@hono/node-server",
  "@mostra/mcp",
  "@mostra/protocol",
  // The look of the server's own pages (UX-01, D171): themes as data and a page template.
  "@mostra/themes",
  "openid-client",
  "ws",
  "zod",
]);

describe("the open server holds no operating layer (RM-03, D165 item 11)", () => {
  it("names none of the operating layer's concerns in its code", () => {
    const found = MODULES.flatMap(sources).flatMap(({ file, code }) =>
      code
        .split("\n")
        .map((line, index) => ({ line, index }))
        .filter(({ line }) => OPERATING_LAYER.test(line))
        .map(({ line, index }) => `${file}:${index + 1}: ${line.trim()}`),
    );
    expect(found).toEqual([]);
  });

  it("imports only the packages this audit names", () => {
    const imported = new Set<string>();
    for (const { code } of MODULES.flatMap(sources)) {
      for (const match of code.matchAll(/\bfrom\s+"([^"]+)"|\bimport\(\s*"([^"]+)"\s*\)/g)) {
        const specifier = (match[1] ?? match[2]) as string;
        if (specifier.startsWith(".") || specifier.startsWith("node:")) continue;
        const name = specifier.startsWith("@")
          ? specifier.split("/").slice(0, 2).join("/")
          : (specifier.split("/")[0] as string);
        imported.add(name);
      }
    }
    expect([...imported].filter((name) => !ALLOWED_PACKAGES.has(name)).sort()).toEqual([]);
  });

  it("goes red on a seeded concern (the audit itself)", () => {
    expect(OPERATING_LAYER.test("const invoice = await stripe.charge(account);")).toBe(true);
    expect(OPERATING_LAYER.test("await operator.limit({ operation: 'share' });")).toBe(false);
  });
});
