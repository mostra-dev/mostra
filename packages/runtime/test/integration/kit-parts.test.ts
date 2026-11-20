/**
 * The kit through `verify` and the real host protocol (WP-18): every part in both bases and both
 * built-in themes (KT-03, KT-04), a page with nothing of the kit (KT-10), and the kit's forms
 * (KT-05, #158). A suite of its own, apart from `verify.test.ts`, so neither group's machine runs
 * past its deadline (Windows arm64's `windows-verify` ran 14 minutes with them, REPO_STANDARDS §6).
 */
import { cpSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { VerifyVerdict } from "@mostra/protocol";
import { ARTIFACT_THEMES } from "@mostra/themes";
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
const SKILL_EXAMPLES = fileURLToPath(
  new URL("../../../../skills/mostra/assets/examples/", import.meta.url),
);
const VERIFY_MS = 300_000;

let home: TestHome;
let daemon: RuntimeProcess & { status: DaemonStatus };
let client: LineClient;

const result = (message: Message): unknown => {
  if (message.error) throw new Error(`${message.error.data.code}: ${message.error.data.message}`);
  return message.result;
};

/** An artifact directory with these files. */
function artifact(name: string, files: Record<string, string>): string {
  const dir = join(tempDir(`kit-${name}`), name);
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

/** The codes of a verdict's diagnostics at one severity. */
const codes = (verdict: VerifyVerdict, severity: "error" | "warning" | "hint"): string[] =>
  verdict.diagnostics.filter((d) => d.severity === severity).map((d) => d.code);

const find = (verdict: VerifyVerdict, code: string) =>
  verdict.diagnostics.filter((d) => d.code === code);

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

describe("every kit part through verify (KT-03, KT-04)", () => {
  // Every kit part in both bases (KT-03), in every theme an artifact can name (KT-04): the Skill's
  // specimen is the Base UI page, and its fixture twin the same page in Radix's idioms. Each
  // type-checks under verify's strict check, builds, renders and passes axe with nothing to say.
  for (const [base, specimen] of [
    ["base", join(SKILL_EXAMPLES, "specimen")],
    ["radix", join(FIXTURES, "specimen-radix")],
  ] as const) {
    for (const theme of Object.keys(ARTIFACT_THEMES)) {
      it(
        `renders every kit part in the ${base} base and the ${theme} theme`,
        async () => {
          const dir = join(tempDir(`verify-specimen-${base}-${theme}`), "specimen");
          cpSync(specimen, dir, { recursive: true });
          const verdict = await verify(dir, { theme });
          expect(codes(verdict, "error")).toEqual([]);
          expect(codes(verdict, "warning")).toEqual([]);
          expect(verdict.status).toBe("pass");
          expect(verdict.theme).toMatchObject({ stack: [theme] });
        },
        VERIFY_MS,
      );
    }
  }
});

describe("the kit's forms through verify (WP-18)", () => {
  it(
    "verifies a page that uses nothing of the kit cleanly, in the default theme or none (KT-10)",
    async () => {
      // Design freedom (D68): nothing enforces the kit. A page with its own markup and its own
      // stylesheet, which imports no part, passes with no warning, said to wear Studio by default;
      // with `theme: "none"` no theme is built at all.
      const page = (theme: string | undefined): Record<string, string> => ({
        "index.tsx": `import { defineArtifact } from "@mostra/react";
import "./own.css";

export const artifact = defineArtifact({ title: "Own look"${theme === undefined ? "" : `, kit: { theme: "${theme}" }`} });

export default function Page() {
  return (
    <main className="own">
      <h1>Own look</h1>
      <p className="mt-2 text-sm">Nothing here comes from the kit.</p>
    </main>
  );
}
`,
        "own.css": ".own { max-width: 40rem; margin: 3rem auto; font-family: Georgia, serif; }\n",
      });
      const plain = await verify(artifact("own-look", page(undefined)));
      expect(codes(plain, "error")).toEqual([]);
      expect(codes(plain, "warning")).toEqual([]);
      expect(plain.theme).toMatchObject({ stack: ["studio"], default: true });
      const bare = artifact("own-look-bare", page("none"));
      const none = await verify(bare);
      expect(codes(none, "error")).toEqual([]);
      expect(codes(none, "warning")).toEqual([]);
      expect(none.theme).toMatchObject({ stack: ["none"], default: false });
      const shown = result(
        await client.call("theme/show", { artifact: { path: bare }, css: true }),
      ) as { stack: string[]; css?: string };
      expect(shown.stack).toEqual(["none"]);
      expect(shown.css ?? "").toBe("");
    },
    VERIFY_MS,
  );

  it(
    "judges an input unbound only when its value changed and nothing saved (#158)",
    async () => {
      const dir = artifact("radios", {
        "index.tsx": `import { useState } from "react";
import { useField } from "@mostra/react";

export default function Page() {
  const [size, setSize] = useField("size", "small", { label: "Size" });
  const [loose, setLoose] = useState("");
  return (
    <main>
      <h1>Sizes</h1>
      <fieldset>
        <legend>Size</legend>
        {["small", "medium", "large"].map((v) => (
          <label key={v}>
            <input type="radio" name="size" value={v} checked={size === v} onChange={() => setSize(v)} />
            {v}
          </label>
        ))}
      </fieldset>
      <label>
        Search
        <input value={loose} onChange={(event) => setLoose(event.currentTarget.value)} />
      </label>
    </main>
  );
}
`,
      });
      const verdict = await verify(dir);
      // "small" was already chosen, so choosing it again changed and saved nothing; the input that
      // isn't bound still is reported.
      expect(find(verdict, "MOSTRA_FIELD_UNBOUND").map((d) => d.message)).toEqual([
        expect.stringContaining('"Search"'),
      ]);
    },
    VERIFY_MS,
  );
});
