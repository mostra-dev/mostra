/** The registry is what the generator makes from the pinned shadcn items, byte for byte. */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it("the committed registry is current with the pinned items and the kit's changes", () => {
  const script = fileURLToPath(new URL("../scripts/generate.ts", import.meta.url));
  const run = spawnSync(process.execPath, [script, "--check"], { encoding: "utf8" });
  expect(`${run.stdout}${run.stderr}`).toMatch(/files current/);
  expect(run.status).toBe(0);
}, 60_000);
