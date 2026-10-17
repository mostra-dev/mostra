/**
 * `verify` through the real host protocol (WP-09: AX-02, AX-04, AX-05, AU-05, VR-09): a real
 * `mostra-runtime daemon` builds, type-checks and renders artifacts in its verify runner's
 * Chromium, inside a sandbox, and gates its publishes on the verdict (D41, D138).
 *
 * Every check that reports something has a negative here too: WP-03's fixtures, correct code,
 * raise no error or warning (EVAL-01: false positives make agents break working code).
 */
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ArtifactId, VerifyVerdict } from "@mostra/protocol";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  connectTo,
  type DaemonStatus,
  initializeParams,
  type LineClient,
  type Message,
  type RuntimeProcess,
  startDaemon,
  type TestHome,
  tempDir,
  verifiedHome,
} from "../support.ts";

const FIXTURES = fileURLToPath(new URL("../fixtures/artifacts/", import.meta.url));
const VERIFY_MS = 300_000;

let home: TestHome;
let daemon: RuntimeProcess & { status: DaemonStatus };
let client: LineClient;

const result = (message: Message): unknown => {
  if (message.error) throw new Error(`${message.error.data.code}: ${message.error.data.message}`);
  return message.result;
};

/** A copy of a fixture, so tests never write into the repository. */
function copy(fixture: string): string {
  const dir = join(tempDir(`verify-${fixture}`), fixture);
  cpSync(join(FIXTURES, fixture), dir, { recursive: true });
  return dir;
}

/** An artifact directory with these files. */
function artifact(name: string, files: Record<string, string>): string {
  const dir = join(tempDir(`verify-${name}`), name);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  return dir;
}

async function verify(path: string, extra: Record<string, unknown> = {}): Promise<VerifyVerdict> {
  const message = await client.call("artifact/verify", { source: { path }, ...extra }, VERIFY_MS);
  return VerifyVerdict.parse(result(message));
}

async function publish(path: string, extra: Record<string, unknown> = {}): Promise<Message> {
  return client.call("artifact/publish", { source: { path }, ...extra }, VERIFY_MS);
}

/** The codes of a verdict's diagnostics at one severity. */
const codes = (verdict: VerifyVerdict, severity: "error" | "warning" | "hint"): string[] =>
  verdict.diagnostics.filter((d) => d.severity === severity).map((d) => d.code);

const find = (verdict: VerifyVerdict, code: string) =>
  verdict.diagnostics.filter((d) => d.code === code);

/** How many children of a kind the supervisor started, from its log. */
const started = (kind: string): number => {
  const dir = join(home.home, "logs");
  return readdirSync(dir)
    .flatMap((name) => readFileSync(join(dir, name), "utf8").split("\n"))
    .filter(
      (line) => line.includes('"event":"process.started"') && line.includes(`"kind":"${kind}"`),
    ).length;
};

/** A PNG's width and height, from its header. */
function pngSize(path: string): { width: number; height: number } {
  const bytes = readFileSync(path);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

beforeAll(async () => {
  home = verifiedHome();
  daemon = await startDaemon(home);
  client = await connectTo(daemon.status.socket as string);
  // The explicit dependency policy (D43): a package outside the warm set is MOSTRA_DEP_MISSING,
  // so no test reaches a registry.
  result(
    await client.call(
      "mostra/initialize",
      initializeParams({ home: { dependencies: "explicit" } }),
    ),
  );
});

afterAll(async () => {
  await client?.call("mostra/shutdown", {});
  await daemon?.exited;
});

describe("WP-03's fixtures pass with no error or warning (AU-01, AU-02; the negatives)", () => {
  it(
    "passes a plain React page",
    async () => {
      const verdict = await verify(join(copy("single-tsx"), "page.tsx"));
      expect(codes(verdict, "error")).toEqual([]);
      expect(codes(verdict, "warning")).toEqual([]);
      expect(verdict.status).toBe("pass");
      // The smoke test used every option, and the one already chosen did change the page later.
      expect(verdict.smoke.interactions).toBeGreaterThanOrEqual(3);
      // A passing verdict hands over no images by default (AX-05): the ARIA text says what's there.
      expect(verdict.screenshots).toHaveLength(2);
      expect(verdict.screenshots.every((shot) => !shot.returned)).toBe(true);
    },
    VERIFY_MS,
  );

  it(
    "passes a single MDX page",
    async () => {
      const verdict = await verify(join(copy("single-mdx"), "page.mdx"));
      expect(codes(verdict, "error")).toEqual([]);
      expect(codes(verdict, "warning")).toEqual([]);
      expect(verdict.status).toBe("pass");
    },
    VERIFY_MS,
  );

  it(
    "passes a directory with pages, components, data, assets, server code and live sources",
    async () => {
      const verdict = await verify(copy("directory"));
      expect(codes(verdict, "error")).toEqual([]);
      expect(codes(verdict, "warning")).toEqual([]);
      expect(verdict.status).toBe("pass");
      // `archive` checks dryRun() through a helper: it ran, so nothing was skipped (D55).
      expect(verdict.smoke.skippedActions).toEqual([]);
    },
    VERIFY_MS,
  );

  it(
    "doesn't call a canvas-only page blank",
    async () => {
      const verdict = await verify(
        join(
          artifact("canvas", {
            "page.tsx": `import { useEffect, useRef } from "react";
export default function Page() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const context = ref.current?.getContext("2d");
    if (context) { context.fillStyle = "#336699"; context.fillRect(10, 10, 200, 100); }
  }, []);
  return <main><canvas ref={ref} width={400} height={200} aria-label="Chart" role="img" /></main>;
}
`,
          }),
          "page.tsx",
        ),
      );
      expect(codes(verdict, "error")).toEqual([]);
    },
    VERIFY_MS,
  );
});

/** The faults fixture: one page whose every part is one fault verify must name. */
function faults(markers: { sent: string; saved: string }): string {
  return artifact("faults", {
    "index.tsx": `import { Component, type ReactNode, useEffect, useState } from "react";
import { defineArtifact, useAction, useChoice, useField } from "@mostra/react";
import { save, send } from "./actions";

export const artifact = defineArtifact({ id: "${ArtifactId.create()}", title: "Faults" });

const wrong: number = "not a number";

function Amount() {
  const [value, setValue] = useField("amount", 0);
  return <input type="number" aria-label="Amount" value={value} onChange={(e) => setValue(Number(e.target.value))} />;
}
function AmountText() {
  const [value, setValue] = useField("amount", "");
  return <input aria-label="Amount as text" value={value} onChange={(e) => setValue(e.target.value)} />;
}
function Shared() {
  const [value] = useField("shared", "");
  return <span>{value}</span>;
}
function Note() {
  const [id] = useState(() => \`note-\${Math.random()}\`);
  const [value, setValue] = useField(id, "");
  return <textarea aria-label="Note" value={value} onChange={(e) => setValue(e.target.value)} />;
}
/** An error boundary around a part that throws while rendering: React reports the catch. */
class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  override render() { return this.state.failed ? <p>That part failed.</p> : this.props.children; }
}
function Broken(): ReactNode {
  throw new Error("Caught by a boundary in the faults fixture");
}
function Pick() {
  const { choice } = useChoice("pick");
  return <p>Picked: {choice ?? "nothing"}</p>;
}
function PickField() {
  const [value, setValue] = useField("review.pick.choice", "");
  return <input aria-label="Pick" value={value} onChange={(e) => setValue(e.target.value)} />;
}

export default function Page() {
  const sending = useAction(send);
  const saving = useAction(save);
  const [result, setResult] = useState("");
  useEffect(() => {
    console.error("Load-time failure in the faults fixture");
    console.warn("A deprecated prop in the faults fixture");
  }, []);
  return (
    <main>
      <h1>Faults {String(wrong)}</h1>
      <img src="/missing.png" alt="Missing" />
      <img src="http://127.0.0.1:9/external.png" alt="External" />
      <button type="button" onClick={() => setResult("icon")}><svg width="16" height="16" aria-hidden="true"><rect width="16" height="16" /></svg></button>
      <button type="button" onClick={() => {}}>Does nothing</button>
      <button type="button" onClick={() => { throw new Error("Crash on click"); }}>Crash</button>
      <input aria-label="Search" />
      <button type="button" onClick={() => { sending.run("ada").catch(() => console.error("Send failed")); }}>Send</button>
      <button type="button" onClick={() => { void saving.run("draft").then(setResult); }}>Save</button>
      <p>{result}</p>
      <Amount />
      <AmountText />
      <Shared />
      <Shared />
      <Note />
      <Pick />
      <PickField />
      <Boundary><Broken /></Boundary>
    </main>
  );
}
`,
    "actions.ts": `"use server";
import { appendFileSync } from "node:fs";
import { dryRun } from "@mostra/server";

/** Doesn't check dryRun(): verify must never run it (D55). */
export async function send(to: string): Promise<string> {
  appendFileSync(${JSON.stringify(markers.sent)}, \`sent to \${to}\\n\`);
  return "sent";
}

/** Opts in: verify runs it with dryRun() true. */
export async function save(value: string): Promise<string> {
  if (dryRun()) {
    appendFileSync(${JSON.stringify(markers.saved)}, "dry\\n");
    return "dry run";
  }
  appendFileSync(${JSON.stringify(markers.saved)}, \`real \${value}\\n\`);
  return "saved";
}
`,
  });
}

describe("the pipeline's stages each name their faults (AX-02, AU-05, D138)", () => {
  const markers = {
    sent: join(tempDir("verify-markers"), "sent.txt"),
    saved: join(tempDir("verify-markers"), "saved.txt"),
  };
  let verdict: VerifyVerdict;
  let source: string;

  beforeAll(async () => {
    source = faults(markers);
    verdict = await verify(source);
  }, VERIFY_MS);

  it("returns one verdict that validates, with every stage's timing", () => {
    expect(VerifyVerdict.safeParse(verdict).success).toBe(true);
    expect(verdict.status).toBe("fail");
    for (const stage of [
      "build",
      "typecheck",
      "lint",
      "boot",
      "render",
      "smoke",
      "regression",
      "total",
    ])
      expect(verdict.timingsMs[stage], stage).toBeGreaterThanOrEqual(0);
    // status is fail exactly because errors exist.
    expect(codes(verdict, "error").length).toBeGreaterThan(0);
  });

  it("compile: a type error, with its TypeScript code and location", () => {
    const [error] = find(verdict, "MOSTRA_TYPE_ERROR");
    expect(error?.severity).toBe("error");
    expect(error?.message).toContain("TS2322");
    expect(error?.location).toEqual({ file: "index.tsx", line: 7, column: 7 });
  });

  it("runtime and console: an uncaught error on click and a console error are errors; a warning is a hint", () => {
    expect(
      find(verdict, "MOSTRA_RUNTIME_PAGE_ERROR").some((d) => d.message.includes("Crash on click")),
    ).toBe(true);
    expect(find(verdict, "MOSTRA_RUNTIME_PAGE_ERROR")[0]?.message).toContain('button "Crash"');
    expect(
      find(verdict, "MOSTRA_CONSOLE_ERROR").some((d) => d.message.includes("Load-time failure")),
    ).toBe(true);
    expect(find(verdict, "MOSTRA_CONSOLE_WARNING")[0]?.severity).toBe("hint");
    // An error a React error boundary caught is still an error (D138 item 3): React reports it to
    // the root's onCaughtError, which logs it.
    const caught = verdict.diagnostics.filter((d) =>
      d.message.includes("Caught by a boundary in the faults fixture"),
    );
    expect(caught.length).toBeGreaterThan(0);
    expect(caught.every((d) => d.severity === "error")).toBe(true);
  });

  it("network: the page's own missing file is an error, another origin's failure a warning, favicon nothing", () => {
    const own = find(verdict, "MOSTRA_NETWORK_REQUEST_FAILED");
    expect(own.map((d) => d.message).join("\n")).toContain("/missing.png answered 404");
    expect(own.some((d) => d.message.includes("favicon"))).toBe(false);
    const external = find(verdict, "MOSTRA_NETWORK_EXTERNAL_FAILED");
    expect(external[0]?.severity).toBe("warning");
    expect(external[0]?.message).toContain("http://127.0.0.1:9/external.png");
    // Chrome's own "Failed to load resource" line never comes back as a console error.
    expect(
      find(verdict, "MOSTRA_CONSOLE_ERROR").some((d) =>
        d.message.includes("Failed to load resource"),
      ),
    ).toBe(false);
  });

  it("a11y: a button with no name is a serious finding, a warning", () => {
    const serious = find(verdict, "MOSTRA_A11Y_SERIOUS");
    expect(serious.some((d) => d.message.includes("button-name"))).toBe(true);
    expect(serious[0]?.severity).toBe("warning");
  });

  it("smoke: a control with no effect is a warning saying what was observed", () => {
    const dead = find(verdict, "MOSTRA_SMOKE_NO_EFFECT");
    expect(dead.map((d) => d.message)).toEqual([expect.stringContaining('button "Does nothing"')]);
    expect(dead[0]?.severity).toBe("warning");
    expect(dead[0]?.message).toMatch(/^Observed:/);
  });

  it("never invokes an action that didn't opt into dryRun(), and runs one that did with it true (D55)", () => {
    expect(existsSync(markers.sent)).toBe(false);
    expect(verdict.smoke.skippedActions).toEqual(["actions.ts#send"]);
    expect(find(verdict, "MOSTRA_VERIFY_ACTION_SKIPPED")[0]?.severity).toBe("hint");
    expect(readFileSync(markers.saved, "utf8")).toBe("dry\n");
    // The page's "Send failed" after the refusal is verify's doing: a hint naming the action.
    const consequence = find(verdict, "MOSTRA_VERIFY_SKIP_CONSEQUENCE");
    expect(consequence[0]?.message).toContain("actions.ts#send");
    expect(consequence[0]?.message).toContain("Send failed");
    expect(
      find(verdict, "MOSTRA_CONSOLE_ERROR").some((d) => d.message.includes("Send failed")),
    ).toBe(false);
    expect(verdict.smoke.interactions).toBeGreaterThan(5);
    expect(verdict.smoke.stateChanges).toBeGreaterThan(0);
  });

  it("fields (AU-05): conflicting and changing IDs are errors, a shared value and an unbound input hints", () => {
    const duplicate = find(verdict, "MOSTRA_FIELD_DUPLICATE_ID");
    expect(duplicate.every((d) => d.severity === "error")).toBe(true);
    // The page mounted "amount" with a number and a string; the scan saw two hooks name the choice.
    expect(duplicate.some((d) => d.message.includes('"amount"'))).toBe(true);
    expect(duplicate.some((d) => d.message.includes("review.pick.choice"))).toBe(true);
    const unstable = find(verdict, "MOSTRA_FIELD_ID_UNSTABLE");
    expect(unstable[0]?.severity).toBe("error");
    expect(unstable[0]?.message).toContain("note-");
    expect(find(verdict, "MOSTRA_FIELD_SHARED").map((d) => [d.severity, d.message])).toEqual([
      ["hint", expect.stringContaining('"shared"')],
    ]);
    const unbound = find(verdict, "MOSTRA_FIELD_UNBOUND");
    expect(unbound.map((d) => d.message)).toEqual([expect.stringContaining('"Search"')]);
    expect(unbound[0]?.severity).toBe("hint");
  });

  it("returns screenshots of a failing verdict, at DPR 1 with token estimates (AX-05)", () => {
    expect(verdict.screenshots.map((shot) => shot.viewport)).toEqual(["desktop", "mobile"]);
    for (const shot of verdict.screenshots) {
      expect(shot.returned).toBe(true);
      expect(pngSize(shot.path)).toEqual({ width: shot.width, height: shot.height });
    }
    expect(
      verdict.screenshots.map((shot) => [shot.width, shot.height, shot.tokensEstimate]),
    ).toEqual([
      [1280, 800, { claude: 1334, gpt: 1200, gemini: 1120 }],
      [390, 844, { claude: 434, gpt: 422, gemini: 1120 }],
    ]);
    expect(verdict.aria.map((entry) => entry.viewport)).toEqual(["desktop", "mobile"]);
    expect(readFileSync(verdict.aria[0]?.path as string, "utf8")).toContain('button "Send"');
  });

  it("touches nothing of the home's interaction data, and leaves no sandbox behind (D138 item 1)", async () => {
    const events = result(await client.call("events/read", {})) as { events: unknown[] };
    expect(events.events).toEqual([]);
    expect(readdirSync(join(home.home, "cache", "verify", "runs"))).toEqual([]);
    const instance = result(await client.call("instance/status", {})) as {
      deliveries: unknown[];
      gateway?: { artifacts: unknown[] };
    };
    expect(instance.deliveries).toEqual([]);
    expect(instance.gateway?.artifacts).toEqual([]);
  });

  it(
    "hands images over only when asked: never under `never`",
    async () => {
      const quiet = await verify(source, { screenshots: "never" });
      expect(quiet.status).toBe("fail");
      expect(quiet.screenshots.every((shot) => !shot.returned)).toBe(true);
    },
    VERIFY_MS,
  );
});

describe("the GPT review's smoke and probe findings, through a real page (GPT review findings 3 to 6)", () => {
  it(
    "finds a crash inside a dialog, counts a fetch as an effect, and sees a choice ID that changes",
    async () => {
      const dir = artifact("revealed", {
        "index.tsx": `import { useState } from "react";
import { useChoice } from "@mostra/react";

function Choice() {
  const [set] = useState(() => \`design-\${Math.random()}\`);
  const { choice } = useChoice(set);
  return <p>Chosen: {choice ?? "none"}</p>;
}

export default function Page() {
  const [open, setOpen] = useState(false);
  return (
    <main>
      <h1>Revealed</h1>
      <button type="button" onClick={() => setOpen(true)}>Open the dialog</button>
      {open && (
        <div role="dialog" aria-label="Dialog">
          <button type="button" onClick={() => { throw new Error("Crash inside the dialog"); }}>Crash inside</button>
        </div>
      )}
      <button type="button" onClick={() => { void fetch("/data.json"); }}>Ping</button>
      <Choice />
    </main>
  );
}
`,
        "public/data.json": '{ "ok": true }\n',
      });
      const verdict = await verify(dir);
      // 3: the dialog's button was used, and its crash is the page's error.
      expect(
        find(verdict, "MOSTRA_RUNTIME_PAGE_ERROR").some((d) =>
          d.message.includes("Crash inside the dialog"),
        ),
      ).toBe(true);
      // 4: a button whose effect is a request did something.
      expect(
        find(verdict, "MOSTRA_SMOKE_NO_EFFECT")
          .map((d) => d.message)
          .join("\n"),
      ).not.toContain("Ping");
      // 6: a review set named at mount changes between loads.
      expect(find(verdict, "MOSTRA_FIELD_ID_UNSTABLE")[0]?.message).toContain("review.design-");
    },
    VERIFY_MS,
  );

  it(
    "calls a page blank when a wrapper at opacity 0 hides all of it",
    async () => {
      const verdict = await verify(
        join(
          artifact("hidden", {
            "page.tsx": `export default function Page() {
  return <div style={{ opacity: 0 }}><main><h1>Here but hidden</h1><p>Nothing shows.</p></main></div>;
}
`,
          }),
          "page.tsx",
        ),
      );
      expect(find(verdict, "MOSTRA_RUNTIME_BLANK")[0]?.severity).toBe("error");
    },
    VERIFY_MS,
  );

  it(
    "doesn't call a hover-opened tooltip or the tab already selected ineffective (EVAL-01, D72)",
    async () => {
      const verdict = await verify(
        join(
          artifact("calibrated", {
            "page.tsx": `import { useState } from "react";
export default function Page() {
  const [tip, setTip] = useState(false);
  const [tab, setTab] = useState("one");
  return (
    <main>
      <h1>Calibration</h1>
      <span>
        <button type="button" data-slot="tooltip-trigger" onMouseEnter={() => setTip(true)} onMouseLeave={() => setTip(false)}>Help</button>
        {tip && <span role="tooltip">Shown on hover</span>}
      </span>
      <div role="tablist">
        <button type="button" role="tab" aria-selected={tab === "one"} onClick={() => setTab("one")}>One</button>
        <button type="button" role="tab" aria-selected={tab === "two"} onClick={() => setTab("two")}>Two</button>
      </div>
      <section role="tabpanel">Panel {tab}</section>
    </main>
  );
}
`,
          }),
          "page.tsx",
        ),
      );
      expect(find(verdict, "MOSTRA_SMOKE_NO_EFFECT")).toEqual([]);
      expect(codes(verdict, "error")).toEqual([]);
    },
    VERIFY_MS,
  );
});

describe("a type check that can't run fails the verdict (D138 item 8, GPT review finding 1)", () => {
  it(
    "reports a tsconfig.json the compiler refuses, instead of passing unchecked code",
    async () => {
      const dir = artifact("bad-config", {
        "index.tsx": "export default function Page() { return <main><h1>Config</h1></main>; }\n",
        "tsconfig.json": '{ "compilerOptions": { "baseUrl": "." } }\n',
      });
      const verdict = await verify(dir);
      expect(verdict.status).toBe("fail");
      const [error] = find(verdict, "MOSTRA_TYPE_ERROR");
      expect(error?.message).toContain("TS5102");
      expect(error?.location).toMatchObject({ file: "tsconfig.json" });
    },
    VERIFY_MS,
  );
});

describe("stages that end a run early (AX-02)", () => {
  it(
    "compile: a source that doesn't build stops before the browser",
    async () => {
      const verdict = await verify(
        join(
          artifact("broken", { "page.tsx": "export default function Page() { return <div>; }\n" }),
          "page.tsx",
        ),
      );
      expect(verdict.status).toBe("fail");
      expect(codes(verdict, "error")).toContain("MOSTRA_BUILD_FAILED");
      expect(verdict.screenshots).toEqual([]);
      expect(verdict.timingsMs["render"]).toBeUndefined();
    },
    VERIFY_MS,
  );

  it(
    "manifest: a manifest that isn't a literal is the verdict",
    async () => {
      const verdict = await verify(
        join(
          artifact("manifest", {
            "index.tsx": `import { defineArtifact } from "@mostra/react";
export const artifact = defineArtifact({ title: String(1) });
export default function Page() { return <main>Hi</main>; }
`,
          }),
          "index.tsx",
        ),
      );
      expect(verdict.status).toBe("fail");
      expect(codes(verdict, "error")).toEqual(["MOSTRA_MANIFEST_NOT_LITERAL"]);
    },
    VERIFY_MS,
  );

  it(
    "compile: a package outside the warm set under the explicit policy",
    async () => {
      const verdict = await verify(
        join(
          artifact("dependency", {
            "page.tsx": `import pad from "left-pad";\nexport default function Page() { return <main>{pad("x", 3)}</main>; }\n`,
          }),
          "page.tsx",
        ),
      );
      expect(codes(verdict, "error")).toEqual(["MOSTRA_DEP_MISSING"]);
    },
    VERIFY_MS,
  );

  it(
    "runtime: a page that renders nothing is blank; one that throws while loading is never ready",
    async () => {
      const blank = await verify(
        join(
          artifact("blank", { "page.tsx": "export default function Page() { return null; }\n" }),
          "page.tsx",
        ),
      );
      expect(codes(blank, "error")).toEqual(["MOSTRA_RUNTIME_BLANK"]);
      const thrown = await verify(
        join(
          artifact("throws", {
            "page.tsx": `throw new Error("Boom while loading");\nexport default function Page() { return <main>Never</main>; }\n`,
          }),
          "page.tsx",
        ),
      );
      expect(codes(thrown, "error")).toContain("MOSTRA_RUNTIME_NOT_READY");
      expect(
        find(thrown, "MOSTRA_RUNTIME_PAGE_ERROR").some((d) =>
          d.message.includes("Boom while loading"),
        ),
      ).toBe(true);
    },
    VERIFY_MS,
  );
});

/** The regression fixture's first version: what the last passing version showed. */
const regressionSource = (id: string, variant: "base" | "changed"): Record<string, string> => ({
  "index.tsx": `import { defineArtifact, useField } from "@mostra/react";
export const artifact = defineArtifact({ id: "${id}", title: "Inbox" });

${
  variant === "base"
    ? `function Email() {
  const [value, setValue] = useField("email", "");
  return <input aria-label="Email" value={value} onChange={(e) => setValue(e.target.value)} />;
}`
    : ""
}

export default function Page() {
  const [notes, setNotes] = useField("notes", "");
  return (
    <main style={{ fontFamily: "system-ui", padding: 24 }}>
      ${variant === "changed" ? `<div style={{ height: 320, background: "#1e293b", color: "white" }}>A new banner</div>` : ""}
      <h1>Inbox</h1>
      <textarea aria-label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
      ${variant === "base" ? "<Email />" : ""}
      ${variant === "base" ? `<button type="button" onClick={() => setNotes("sent")}>Send</button>` : ""}
      <button type="button" onClick={() => setNotes("archived")}>Archive</button>
    </main>
  );
}
`,
});

describe("regressions against the last passing version (AX-04)", () => {
  const id = ArtifactId.create();
  let dir: string;
  let baseline: string;

  beforeAll(async () => {
    dir = artifact("regression", regressionSource(id, "base"));
    const receipt = result(await publish(dir)) as { versionId: string };
    baseline = receipt.versionId;
  }, VERIFY_MS);

  it(
    "finds nothing when the source is what passed",
    async () => {
      const verdict = await verify(dir);
      expect(verdict.regressions.against).toBe(baseline);
      expect(verdict.diagnostics.filter((d) => d.code.startsWith("MOSTRA_REGRESSION_"))).toEqual(
        [],
      );
    },
    VERIFY_MS,
  );

  it(
    "detects a removed control, a layout shift and a missing field, as warnings",
    async () => {
      writeFileSync(join(dir, "index.tsx"), regressionSource(id, "changed")["index.tsx"] as string);
      const verdict = await verify(dir);
      expect(verdict.status).toBe("pass");
      expect(verdict.regressions.against).toBe(baseline);
      expect(find(verdict, "MOSTRA_REGRESSION_ARIA")[0]?.message).toContain('button "Send"');
      expect(verdict.regressions.aria).toContain('button "Send"');
      expect(find(verdict, "MOSTRA_REGRESSION_PIXELS").map((d) => d.location)).toEqual([
        { viewport: "desktop" },
        { viewport: "mobile" },
      ]);
      expect(verdict.regressions.pixels?.every((entry) => entry.ratio > 0.01)).toBe(true);
      expect(find(verdict, "MOSTRA_REGRESSION_FIELD_REMOVED")[0]?.message).toContain('"email"');
      expect(verdict.regressions.contracts).toEqual(["field email"]);
      expect(
        verdict.diagnostics
          .filter((d) => d.code.startsWith("MOSTRA_REGRESSION_"))
          .every((d) => d.severity === "warning"),
      ).toBe(true);
    },
    VERIFY_MS,
  );
});

describe("publish's gate (VR-09, D41, D138 items 5, 7)", () => {
  it(
    "reuses the cached verdict and verify's build: no second build, no second render",
    async () => {
      const dir = artifact("gated", {
        "index.tsx": `import { defineArtifact } from "@mostra/react";
export const artifact = defineArtifact({ id: "${ArtifactId.create()}", title: "Gated" });
export default function Page() { return <main><h1>Ready</h1></main>; }
`,
      });
      const verdict = await verify(dir);
      expect(verdict.status).toBe("pass");
      const builds = started("builder");
      const runs = started("verify") + started("typecheck");
      const receipt = result(await publish(dir)) as {
        versionId: string;
        forcedDiagnostics?: string[];
      };
      expect(started("builder")).toBe(builds);
      expect(started("verify") + started("typecheck")).toBe(runs);
      expect(receipt.versionId).toBe(verdict.artifact.versionId);
      expect(receipt.forcedDiagnostics).toBeUndefined();
      const manifest = JSON.parse(
        readFileSync(join(home.home, "versions", receipt.versionId, "manifest.json"), "utf8"),
      ) as { verify?: { status: string }; forcedCodes: string[] };
      expect(manifest.verify?.status).toBe("pass");
      expect(manifest.forcedCodes).toEqual([]);
    },
    VERIFY_MS,
  );

  it(
    "runs verify when nothing is cached, refuses on errors, and records them with --force",
    async () => {
      const dir = artifact("typed", {
        "index.tsx": `import { defineArtifact } from "@mostra/react";
export const artifact = defineArtifact({ id: "${ArtifactId.create()}", title: "Typed" });
const count: number = "three";
export default function Page() { return <main><h1>Count {count}</h1></main>; }
`,
      });
      const refused = await publish(dir);
      expect(refused.error?.data.code).toBe("MOSTRA_PUBLISH_VERIFY_FAILED");
      expect(refused.error?.data.message).toContain("MOSTRA_TYPE_ERROR");
      const listed = result(await client.call("artifact/list", {})) as {
        artifacts: { title: string }[];
      };
      expect(listed.artifacts.map((entry) => entry.title)).not.toContain("Typed");

      const builds = started("builder");
      const forced = result(await publish(dir, { force: true })) as {
        artifactId: string;
        versionId: string;
        forcedDiagnostics?: string[];
      };
      // The refused publish's verdict was cached: the forced one reuses it and verify's build.
      expect(started("builder")).toBe(builds);
      expect(forced.forcedDiagnostics).toEqual(["MOSTRA_TYPE_ERROR"]);
      const detail = result(
        await client.call("artifact/get", { artifact: { artifactId: forced.artifactId } }),
      ) as { versions: { forcedDiagnostics?: string[] }[] };
      expect(detail.versions[0]?.forcedDiagnostics).toEqual(["MOSTRA_TYPE_ERROR"]);
      const manifest = JSON.parse(
        readFileSync(join(home.home, "versions", forced.versionId, "manifest.json"), "utf8"),
      ) as { verify?: { status: string }; forcedCodes: string[] };
      expect(manifest.forcedCodes).toEqual(["MOSTRA_TYPE_ERROR"]);
      expect(manifest.verify?.status).toBe("fail");
      // Published again unchanged, it is the same version, and its receipt still says what was
      // forced; with its directory damaged, the repair keeps the record too.
      const again = result(await publish(dir)) as { reused: boolean; forcedDiagnostics?: string[] };
      expect(again.reused).toBe(true);
      expect(again.forcedDiagnostics).toEqual(["MOSTRA_TYPE_ERROR"]);
      const versionDir = join(home.home, "versions", forced.versionId);
      chmodSync(join(versionDir, "client"), 0o755);
      chmodSync(join(versionDir, "client", "index.html"), 0o644);
      writeFileSync(join(versionDir, "client", "index.html"), "damaged");
      const repaired = result(await publish(dir)) as {
        reused: boolean;
        forcedDiagnostics?: string[];
      };
      expect(repaired.forcedDiagnostics).toEqual(["MOSTRA_TYPE_ERROR"]);
      const after = JSON.parse(readFileSync(join(versionDir, "manifest.json"), "utf8")) as {
        verify?: { status: string };
        forcedCodes: string[];
      };
      expect(after.forcedCodes).toEqual(["MOSTRA_TYPE_ERROR"]);
      expect(after.verify?.status).toBe("fail");
      expect(readFileSync(join(versionDir, "client", "index.html"), "utf8")).not.toBe("damaged");
      // A forced version never counts as passing: the next verify has no baseline.
      const next = await verify(dir);
      expect(codes(next, "hint")).toContain("MOSTRA_VERIFY_NO_BASELINE");
    },
    VERIFY_MS * 2,
  );

  it(
    "never publishes what didn't build, even with --force",
    async () => {
      const dir = artifact("unbuilt", {
        "page.tsx": "export default function Page() { return <div>; }\n",
      });
      const refused = await publish(join(dir, "page.tsx"), { force: true });
      expect(refused.error?.data.code).toBe("MOSTRA_BUILD_FAILED");
    },
    VERIFY_MS,
  );
});
