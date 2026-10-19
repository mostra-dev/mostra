/**
 * verify's pure judgements in the supervisor (AU-05, AX-04, AX-05, D138): field-ID lint over the
 * static scan and the probe, regressions against the baseline, `tsc`'s output, and the screenshot
 * token estimates of the providers' published rules.
 */
import { estimateImageTokens, type ProbedField } from "@mostra/protocol";
import { describe, expect, it } from "vitest";
import type { FieldCoverage, VersionRegistry } from "../../src/builder/index.ts";
import { probedFieldLint, staticFieldLint, unstableFieldLint } from "../../src/verify/fields.ts";
import {
  ariaRegression,
  contractRegressions,
  pixelRegression,
  removedControls,
} from "../../src/verify/regression.ts";
import { parseTscOutput, reportedByBuild, unexplainedExit } from "../../src/verify/typecheck.ts";

const at = (line: number) => ({ file: "index.tsx", line, column: 3 });
const coverage = (entries: FieldCoverage["entries"]): FieldCoverage => ({
  open: false,
  openReasons: [],
  entries,
});
const probed = (id: string, extra: Partial<ProbedField> = {}): ProbedField => ({
  id,
  scope: "viewer",
  hook: "useField",
  initialType: "string",
  mounts: 1,
  conflicts: [],
  ...extra,
});

describe("field-ID lint (AU-05, D138 item 3)", () => {
  it("reports one literal ID used by two hooks or two scopes as an error, never one used twice the same way", () => {
    const found = staticFieldLint(
      coverage([
        { id: "notes", hook: "useField", location: at(1) },
        { id: "notes", hook: "useField", location: at(2) },
        { id: "review.pick.choice", hook: "useChoice", location: at(3) },
        { id: "review.pick.choice", hook: "useField", location: at(4) },
        { id: "tasks", hook: "useField", scope: "artifact", location: at(5) },
        { id: "tasks", hook: "useField", location: at(6) },
        { template: ["reply.", ""], hook: "useField", location: at(7) },
      ]),
    );
    expect(found.map((d) => [d.code, d.severity])).toEqual([
      ["MOSTRA_FIELD_DUPLICATE_ID", "error"],
      ["MOSTRA_FIELD_DUPLICATE_ID", "error"],
    ]);
    expect(found[0]?.message).toContain("review.pick.choice");
    expect(found[1]?.message).toContain("tasks");
  });

  it("makes the page's conflicting mounts errors and a deliberately shared value a hint", () => {
    const found = probedFieldLint(
      [
        probed("amount", { conflicts: ["initial values of types string and number"] }),
        probed("shared", { mounts: 2 }),
        probed("single"),
      ],
      "desktop",
    );
    expect(found.map((d) => [d.code, d.severity])).toEqual([
      ["MOSTRA_FIELD_DUPLICATE_ID", "error"],
      ["MOSTRA_FIELD_SHARED", "hint"],
    ]);
  });

  it("finds IDs that differ between two boots, but never a literal ID or a stable template", () => {
    const scan = coverage([{ id: "name", hook: "useField", location: at(1) }]);
    expect(
      unstableFieldLint(
        [probed("name"), probed("reply.m1")],
        [probed("name"), probed("reply.m1")],
        scan,
        "desktop",
      ),
    ).toEqual([]);
    const found = unstableFieldLint(
      [probed("name"), probed("note-0.123")],
      [probed("name"), probed("note-0.987")],
      scan,
      "desktop",
    );
    expect(found.map((d) => [d.code, d.severity])).toEqual([["MOSTRA_FIELD_ID_UNSTABLE", "error"]]);
    expect(found[0]?.message).toContain("note-0.123");
    // A literal ID the page mounts only sometimes is a component's presence, not a changing ID.
    expect(unstableFieldLint([probed("name")], [], scan, "desktop")).toEqual([]);
  });
});

const registry = (overrides: Partial<VersionRegistry>): VersionRegistry => ({
  schemaVersion: 1,
  entry: "index.tsx",
  actions: [],
  liveSources: [],
  pages: [],
  terminals: [],
  demos: [],
  fields: coverage([]),
  ...overrides,
});

describe("regressions against the last passing version (AX-04)", () => {
  it("names the field IDs, server functions, live sources and pages the source drops, as warnings", () => {
    const before = registry({
      fields: coverage([
        { id: "email", hook: "useField", location: at(1) },
        { id: "notes", hook: "useField", location: at(2) },
      ]),
      actions: [{ id: "actions.ts#send", module: "actions.ts", export: "send", dryRun: false }],
      liveSources: [{ key: "inbox" }],
      pages: [
        { path: "/", file: "pages/index.tsx" },
        { path: "/settings", file: "pages/settings.tsx" },
      ],
    });
    const after = registry({
      fields: coverage([{ id: "notes", hook: "useField", location: at(2) }]),
      pages: [{ path: "/", file: "pages/index.tsx" }],
    });
    const found = contractRegressions(before, after, (id) => (id === "email" ? 3 : 0));
    expect(found.diagnostics.map((d) => [d.code, d.severity])).toEqual([
      ["MOSTRA_REGRESSION_FIELD_REMOVED", "warning"],
      ["MOSTRA_REGRESSION_ACTION_REMOVED", "warning"],
      ["MOSTRA_REGRESSION_LIVE_REMOVED", "warning"],
      ["MOSTRA_REGRESSION_PAGE_REMOVED", "warning"],
    ]);
    expect(found.diagnostics[0]?.message).toContain("3 saved answers");
    expect(found.summary).toEqual([
      "field email",
      "action actions.ts#send",
      "live source inbox",
      "page /settings",
    ]);
  });

  it("reports nothing when the source keeps the contracts, or covers every ID", () => {
    const before = registry({
      fields: coverage([{ id: "email", hook: "useField", location: at(1) }]),
    });
    expect(contractRegressions(before, before, () => 0).diagnostics).toEqual([]);
    const open: VersionRegistry = registry({
      fields: { open: true, openReasons: [{ reason: "x" }], entries: [] },
    });
    expect(contractRegressions(before, open, () => 0).diagnostics).toEqual([]);
  });

  it("finds removed controls and landmarks, not changed counters or added ones", () => {
    const before = [
      "- main:",
      '  - button "Send"',
      '  - button "Archive 3"',
      '  - heading "Inbox"',
    ].join("\n");
    const counted = [
      "- main:",
      '  - button "Send"',
      '  - button "Archive 4"',
      '  - button "New"',
    ].join("\n");
    expect(removedControls(before, counted)).toEqual([]);
    const without = ["- main:", '  - button "Archive 4"'].join("\n");
    expect(removedControls(before, without)).toEqual(['button "Send"']);
    expect(ariaRegression(before, without, "desktop")?.diagnostic.code).toBe(
      "MOSTRA_REGRESSION_ARIA",
    );
    expect(ariaRegression(before, counted, "desktop")).toBeUndefined();
  });

  it("reports a viewport past 1 % of changed pixels, or of another size", () => {
    expect(pixelRegression(0.004, false, "desktop", "d.png")).toBeUndefined();
    expect(pixelRegression(0.2, false, "desktop", "d.png")?.code).toBe("MOSTRA_REGRESSION_PIXELS");
    expect(pixelRegression(1, true, "mobile", "d.png")?.severity).toBe("warning");
  });
});

describe("the type check's output (D138 item 8)", () => {
  it("keeps errors in the artifact's files, makes TS7016 a warning, and drops imports already reported", () => {
    const found = parseTscOutput(
      [
        "source/index.tsx(4,7): error TS2322: Type 'string' is not assignable to type 'number'.",
        "  The expected type comes from here.",
        "source/lib.ts(1,20): error TS7016: Could not find a declaration file for module 'left-pad'.",
        "source/lib.ts(2,20): error TS2307: Cannot find module 'missing-pkg' or its corresponding type declarations.",
        ".mostra-check/assets.d.ts(1,1): error TS1000: not the artifact's.",
        "source/node_modules/x/index.ts(1,1): error TS1000: not the artifact's either.",
      ],
      (specifier) => specifier === "missing-pkg",
    );
    expect(found.map((d) => [d.code, d.severity, d.location])).toEqual([
      ["MOSTRA_TYPE_ERROR", "error", { file: "index.tsx", line: 4, column: 7 }],
      ["MOSTRA_TYPE_UNTYPED_PACKAGE", "warning", { file: "lib.ts", line: 1, column: 20 }],
    ]);
    expect(found[0]?.message).toContain("TS2322");
    expect(found[0]?.message).toContain("The expected type comes from here.");
  });
});

describe("a type check that couldn't run fails closed (D138 item 8, GPT review finding 1)", () => {
  it("reports what the compiler refused in the configuration as type errors", () => {
    const found = parseTscOutput(
      [
        "tsconfig.verify.json(1,40): error TS5102: Option 'baseUrl' has been removed. Please remove it from your configuration.",
        "source/tsconfig.json(2,15): error TS5109: Option 'moduleResolution' must be set to 'NodeNext'.",
        "error TS5023: Unknown compiler option 'nope'.",
      ],
      () => false,
      true,
    );
    expect(found.map((d) => [d.code, d.severity])).toEqual([
      ["MOSTRA_TYPE_ERROR", "error"],
      ["MOSTRA_TYPE_ERROR", "error"],
      ["MOSTRA_TYPE_ERROR", "error"],
    ]);
    expect(found[0]?.message).toContain("TS5102");
    expect(found[0]?.location).toEqual({ file: "tsconfig.json", line: 1, column: 1 });
    expect(found[1]?.location).toEqual({ file: "tsconfig.json", line: 2, column: 15 });
    expect(found[2]?.message).toContain("TS5023");
  });
  it("fails a check that exited unsuccessfully with nothing found, and calls a signal a crash", () => {
    const failed = { code: 1, signal: null, stderrTail: ["something went wrong"] };
    expect(unexplainedExit(failed, [], []).map((d) => d.code)).toEqual(["MOSTRA_TYPE_ERROR"]);
    expect(
      unexplainedExit({ code: null, signal: "SIGKILL", stderrTail: [] }, [], []).map((d) => d.code),
    ).toEqual(["MOSTRA_VERIFY_CRASHED"]);
    // A clean exit, or a failing one whose errors were found, adds nothing.
    expect(unexplainedExit({ code: 0, signal: null, stderrTail: [] }, [], [])).toEqual([]);
    const typeError = parseTscOutput(["source/index.tsx(3,7): error TS2322: Nope."], () => false);
    expect(unexplainedExit(failed, [], typeError)).toEqual([]);
  });
  it("lets an untyped package's TS7016 explain tsc's failing exit: a warning, never MOSTRA_TYPE_ERROR", () => {
    // tsc exits 1 for TS7016 alone; Mostra makes it the warning MOSTRA_TYPE_UNTYPED_PACKAGE (D138
    // item 8), so the verdict must not add an error for an exit only that warning explains.
    const lines = [
      "source/index.tsx(2,16): error TS7016: Could not find a declaration file for module 'ms'. '/h/deps/locks/x/node_modules/ms/index.js' implicitly has an 'any' type.",
    ];
    const found = parseTscOutput(lines, () => false);
    expect(found.map((d) => [d.code, d.severity])).toEqual([
      ["MOSTRA_TYPE_UNTYPED_PACKAGE", "warning"],
    ]);
    expect(unexplainedExit({ code: 1, signal: null, stderrTail: [] }, lines, found)).toEqual([]);
    // A TS2307 the build already reported is dropped, and still explains the exit.
    const missing = ["source/index.tsx(1,20): error TS2307: Cannot find module 'nope'."];
    expect(
      unexplainedExit(
        { code: 1, signal: null, stderrTail: [] },
        missing,
        parseTscOutput(missing, () => true),
      ),
    ).toEqual([]);
  });
});

describe("a module the build couldn't resolve is reported once (D138 item 8)", () => {
  const build = [
    {
      code: "MOSTRA_BUILD_UNRESOLVED",
      severity: "error",
      phase: "compile",
      message: 'Could not resolve "left-pad-nowhere" from index.tsx: it isn\'t in the warm set.',
      docs: "",
    },
  ] as const;
  it("matches the build's quoted specifier, and nothing else", () => {
    expect(reportedByBuild(build, "left-pad-nowhere")).toBe(true);
    expect(reportedByBuild(build, "left-pad")).toBe(false);
    expect(reportedByBuild(build, "react")).toBe(false);
    expect(reportedByBuild([], "left-pad-nowhere")).toBe(false);
  });
});

describe("screenshot token estimates (AX-05, D138 item 9)", () => {
  it("matches the providers' rules at the default viewports", () => {
    expect(estimateImageTokens(1280, 800)).toEqual({ claude: 1334, gpt: 1200, gemini: 1120 });
    expect(estimateImageTokens(390, 844)).toEqual({ claude: 434, gpt: 422, gemini: 1120 });
  });

  it("downscales larger images by each provider's rule", () => {
    // Claude's reference: a 1920×1080 screenshot fits its high-resolution tier unchanged.
    expect(estimateImageTokens(1920, 1080).claude).toBe(69 * 39);
    // A full-page shot past Claude's 4784-token budget is scaled down to fit it.
    const tall = estimateImageTokens(1280, 6000);
    expect(tall.claude).toBeLessThanOrEqual(4784);
    // GPT at detail high: 2048 px, then at most 2,500 patches, times 1.2.
    expect(estimateImageTokens(4096, 4096).gpt).toBeLessThanOrEqual(Math.ceil(2500 * 1.2));
    expect(estimateImageTokens(2048, 2048).gpt).toBe(3000);
  });
});
