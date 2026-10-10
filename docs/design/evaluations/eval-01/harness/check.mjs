// Checker for the base evaluation. Usage: node check.mjs <projectDir> <port>
// Prints one JSON verdict: typecheck, build, render errors, interaction errors, dead triggers,
// and cross-base idioms found in the agent's code.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const dir = path.resolve(process.argv[2]);
const port = Number(process.argv[3] ?? 4900);
const base = JSON.parse(fs.readFileSync(path.join(dir, "components.json"), "utf8")).style.startsWith("base") ? "base" : "radix";
const verdict = { base, typecheck: null, build: null, render: null, interaction: null, idioms: null };

function run(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: dir, encoding: "utf8", timeout: 180000 });
  return { ok: r.status === 0, out: ((r.stdout ?? "") + (r.stderr ?? "")).slice(-4000) };
}

const tc = run("npx", ["tsc", "-b"]);
verdict.typecheck = { ok: tc.ok, errors: (tc.out.match(/error TS\d+/g) ?? []).length, excerpt: tc.ok ? "" : tc.out.slice(0, 1500) };
const b = run("npx", ["vite", "build"]);
verdict.build = { ok: b.ok, excerpt: b.ok ? "" : b.out.slice(0, 1500) };

// Agent-written source (outside components/ui): idioms that belong to the other base.
const srcFiles = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { if (!p.includes(`${path.sep}components${path.sep}ui`)) walk(p); }
    else if (/\.(tsx?|jsx?)$/.test(e.name)) srcFiles.push(p);
  }
})(path.join(dir, "src"));
const code = srcFiles.map((f) => fs.readFileSync(f, "utf8")).join("\n");
verdict.idioms = {
  asChild: (code.match(/\basChild\b/g) ?? []).length,
  renderProp: (code.match(/\brender=\{/g) ?? []).length,
  radixImports: (code.match(/from ["'](@radix-ui\/|radix-ui)/g) ?? []).length,
  baseUiImports: (code.match(/from ["']@base-ui\//g) ?? []).length,
};

if (b.ok) {
  const server = spawn("npx", ["vite", "preview", "--port", String(port), "--strictPort", "--host", "127.0.0.1"], { cwd: dir, stdio: "ignore" });
  try {
    await new Promise((r) => setTimeout(r, 2500));
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push({ phase: "page", msg: String(e).slice(0, 300) }));
    page.on("console", (m) => { if (m.type() === "error") errors.push({ phase: "console", msg: m.text().slice(0, 300) }); });
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "networkidle" }).catch((e) => errors.push({ phase: "nav", msg: String(e) }));
    await page.waitForTimeout(800);
    const bodyText = (await page.locator("body").innerText().catch(() => "")).trim();
    verdict.render = { ok: errors.length === 0 && bodyText.length > 20, errors: [...errors], textLength: bodyText.length };

    // Interaction: click every visible trigger-like element, look for something opening or changing.
    const before = errors.length;
    const openSel = '[role=dialog],[role=alertdialog],[role=menu],[role=listbox],[data-state=open],[data-open],[data-popup-open]';
    const triggers = page.locator('[data-slot$="-trigger"],[aria-haspopup],[role=tab],[role=combobox],[role=switch],[role=checkbox]');
    const n = Math.min(await triggers.count(), 40);
    let clicked = 0, dead = 0;
    const deadList = [];
    for (let i = 0; i < n; i++) {
      const t = triggers.nth(i);
      if (!(await t.isVisible().catch(() => false))) continue;
      const slot = (await t.getAttribute("data-slot").catch(() => null)) ?? (await t.getAttribute("role").catch(() => null));
      // An already-active tab or selected item correctly does nothing when clicked: not a dead trigger.
      const alreadyActive = await t.evaluate((el) => el.getAttribute("aria-selected") === "true" || el.getAttribute("data-state") === "active" || el.hasAttribute("data-active") || el.hasAttribute("data-selected")).catch(() => false);
      if (alreadyActive) continue;
      const openBefore = await page.locator(openSel).count();
      const attrsBefore = await t.evaluate((el) => ["aria-expanded","aria-checked","aria-selected","aria-pressed","data-state","data-checked","data-unchecked","data-selected","data-active","data-popup-open","data-pressed","data-open","data-panel-open"].map((a) => a + "=" + el.getAttribute(a)).join("|")).catch(() => "");
      const isContext = slot === "context-menu-trigger";
      const isHover = slot === "tooltip-trigger" || slot === "hover-card-trigger";
      if (isHover) { await t.hover({ timeout: 2000 }).catch(() => {}); await page.waitForTimeout(1200); }
      else { await (isContext ? t.click({ button: "right", timeout: 2000 }) : t.click({ timeout: 2000 })).catch(() => {}); await page.waitForTimeout(350); }
      const openAfter = await page.locator(openSel).count();
      const attrsAfter = await t.evaluate((el) => ["aria-expanded","aria-checked","aria-selected","aria-pressed","data-state","data-checked","data-unchecked","data-selected","data-active","data-popup-open","data-pressed","data-open","data-panel-open"].map((a) => a + "=" + el.getAttribute(a)).join("|")).catch(() => attrsBefore);
      clicked++;
      if (openAfter === openBefore && attrsAfter === attrsBefore) { dead++; deadList.push(slot); }
      await page.keyboard.press("Escape").catch(() => {});
      await page.mouse.move(1, 1).catch(() => {});
      await page.waitForTimeout(120);
    }
    verdict.interaction = { ok: errors.length === before && dead === 0, clicked, dead, deadList, errors: errors.slice(before) };
    await browser.close();
  } finally {
    server.kill("SIGTERM");
  }
}
verdict.pass = !!(verdict.typecheck?.ok && verdict.build?.ok && verdict.render?.ok && verdict.interaction?.ok);
console.log(JSON.stringify(verdict));
