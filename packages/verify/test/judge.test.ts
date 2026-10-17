/**
 * The runner's judgements (D72, D138 items 2 and 3): what the page reported becomes errors,
 * warnings or hints, faults verify's own refusal caused are attributed to it, and screenshots are
 * compared pixel by pixel.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import {
  ariaSummary,
  compareImages,
  dedupe,
  judge,
  type RecordedEntry,
  uniform,
} from "../src/index.ts";

const entry = (kind: RecordedEntry["kind"], text: string, codes: string[] = []): RecordedEntry => ({
  seq: 1,
  kind,
  text,
  codes,
});

const load = { kind: "load" } as const;

describe("judging what the page reported (D138 items 2, 3)", () => {
  it("makes the page's own faults errors and its warnings hints", () => {
    const found = judge(
      [
        entry("error", "boom"),
        entry("uncaught", "TypeError: x is undefined"),
        entry("rejection", "Error: nope"),
        entry("warn", "deprecated"),
      ],
      load,
      [],
      "desktop",
    );
    expect(found.map((d) => [d.code, d.severity])).toEqual([
      ["MOSTRA_CONSOLE_ERROR", "error"],
      ["MOSTRA_RUNTIME_PAGE_ERROR", "error"],
      ["MOSTRA_RUNTIME_PAGE_ERROR", "error"],
      ["MOSTRA_CONSOLE_WARNING", "hint"],
    ]);
  });

  it("drops a rejection that is verify's refusal, and demotes faults whose cause chain is it", () => {
    const found = judge(
      [
        {
          ...entry("rejection", "MostraError: Skipped", ["MOSTRA_VERIFY_ACTION_SKIPPED"]),
          dropped: true,
        },
        entry("uncaught", "Error: wrapped", ["MOSTRA_APP", "MOSTRA_VERIFY_ACTION_SKIPPED"]),
      ],
      load,
      [],
      "desktop",
    );
    expect(found.map((d) => [d.code, d.severity])).toEqual([
      ["MOSTRA_VERIFY_SKIP_CONSEQUENCE", "hint"],
    ]);
  });

  it("demotes a text-only console error in a moment when verify skipped an action, naming it", () => {
    const found = judge(
      [entry("error", "Save failed"), entry("uncaught", "Error: unrelated")],
      { kind: "interaction", control: 'button "Send"' },
      ["actions.ts#send"],
      "desktop",
    );
    expect(found.map((d) => d.code)).toEqual([
      "MOSTRA_VERIFY_SKIP_CONSEQUENCE",
      "MOSTRA_RUNTIME_PAGE_ERROR",
    ]);
    expect(found[0]?.message).toContain("actions.ts#send");
    expect(found[0]?.message).toContain('button "Send"');
  });

  it("reports a missing secret as the environment's, a warning", () => {
    const found = judge(
      [entry("rejection", "no key", ["MOSTRA_SECRET_MISSING"])],
      load,
      [],
      "mobile",
    );
    expect(found.map((d) => [d.code, d.severity])).toEqual([
      ["MOSTRA_VERIFY_SECRET_MISSING", "warning"],
    ]);
  });

  it("folds identical findings into one with a count", () => {
    const one = judge([entry("error", "boom")], load, [], "desktop");
    expect(dedupe([...one, ...one, ...one])).toEqual([{ ...one[0], count: 3 }]);
  });
});

describe("pictures and snapshots", () => {
  const dir = mkdtempSync(join(tmpdir(), "mostra-verify-"));
  const png = (width: number, height: number, paint: (x: number, y: number) => number): string => {
    const image = new PNG({ width, height });
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const offset = (y * width + x) * 4;
        const value = paint(x, y);
        image.data[offset] = value;
        image.data[offset + 1] = value;
        image.data[offset + 2] = value;
        image.data[offset + 3] = 255;
      }
    }
    const file = join(dir, `${Math.random()}.png`);
    writeFileSync(file, PNG.sync.write(image));
    return file;
  };

  it("tells a one-color screenshot from one with anything on it", () => {
    const blank = PNG.sync.write(Object.assign(new PNG({ width: 4, height: 4 }), {}));
    expect(uniform(blank)).toBe(true);
    const image = new PNG({ width: 4, height: 4 });
    image.data[0] = 255;
    expect(uniform(PNG.sync.write(image))).toBe(false);
  });

  it("measures the share of pixels that differ, and a change of size as all of them", async () => {
    const a = png(100, 100, () => 255);
    const b = png(100, 100, (_x, y) => (y < 10 ? 0 : 255));
    expect((await compareImages({ a, b: a, diff: join(dir, "same.png") })).ratio).toBe(0);
    const changed = await compareImages({ a, b, diff: join(dir, "diff.png") });
    expect(changed.ratio).toBeCloseTo(0.1, 2);
    expect(changed.sizeChanged).toBe(false);
    const other = await compareImages({
      a,
      b: png(100, 50, () => 255),
      diff: join(dir, "size.png"),
    });
    expect(other).toEqual({ ratio: 1, sizeChanged: true });
  });

  it("summarizes an ARIA snapshot by headings, controls and landmarks", () => {
    const snapshot = [
      "- main:",
      '  - heading "Plan" [level=1]',
      '  - button "Save"',
      '  - button "Send"',
      '  - textbox "Name"',
    ].join("\n");
    expect(ariaSummary(snapshot)).toBe("1 heading, 2 buttons, 1 textbox, landmarks: main");
  });
});
