/**
 * The kit through `verify` and the real host protocol (WP-18): every part in both bases and both
 * built-in themes (KT-03, KT-04), a page with nothing of the kit (KT-10), and the kit's forms
 * (KT-05, #158). A suite of its own, apart from `verify.test.ts`, so neither group's machine runs
 * past its deadline (Windows arm64's `windows-verify` ran 14 minutes with them, REPO_STANDARDS §6).
 */
import { cpSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
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
    "judges an input unbound only when its value changed and nothing saved (#158; Opus review 12)",
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
      <div contentEditable suppressContentEditableWarning role="textbox" aria-label="Notes" />
    </main>
  );
}
`,
      });
      const verdict = await verify(dir);
      // "small" was already chosen, so choosing it again changed and saved nothing; the input and
      // the editable element that aren't bound still are reported (Opus review 12).
      const unbound = find(verdict, "MOSTRA_FIELD_UNBOUND").map((d) => d.message);
      expect(unbound).toHaveLength(2);
      expect(unbound).toEqual(
        expect.arrayContaining([
          expect.stringContaining('"Search"'),
          expect.stringContaining('"Notes"'),
        ]),
      );
    },
    VERIFY_MS,
  );

  it(
    "keeps a version's field coverage exact only where the scan saw the questionnaire's ids (Opus review 2)",
    async () => {
      // Each page also names a field of its own, so its coverage would otherwise be exact.
      const page = (
        imports: string,
        body: string,
      ): string => `import { defineArtifact, useField } from "@mostra/react";
${imports}

export const artifact = defineArtifact({ title: "Survey" });

export function Note() {
  const [note, setNote] = useField("note", "", { label: "Note" });
  return <input aria-label="Note" value={note} onChange={(event) => setNote(event.currentTarget.value)} />;
}

${body}
`;
      const survey =
        '<Questionnaire id="survey" title="Survey"><Question id="name" title="Your name"><TextAnswer /></Question></Questionnaire>';
      const pages: Record<string, string> = {
        seen: page(
          'import { Question, Questionnaire, TextAnswer } from "@mostra/kit/questionnaire";',
          `export default function Page() {\n  return ${survey};\n}`,
        ),
        lazy: page(
          'import { lazy, Suspense } from "react";',
          `const Survey = lazy(async () => {
  const { Question, Questionnaire, TextAnswer } = await import("@mostra/kit/questionnaire");
  return { default: () => ${survey} };
});

export default function Page() {
  return <Suspense fallback={null}><Survey /></Suspense>;
}`,
        ),
        registry: page(
          "// @ts-expect-error: the registry's files are the kit's sources, not its typed entries\nimport { Question, Questionnaire, TextAnswer } from \"@mostra/kit/registry/base/components/mostra/questionnaire.tsx\";",
          `export default function Page() {\n  return ${survey};\n}`,
        ),
      };
      const coverage: Record<string, { open: boolean; reasons: string[]; ids: string[] }> = {};
      for (const [name, text] of Object.entries(pages)) {
        const dir = artifact(`coverage-${name}`, { "index.tsx": text });
        const receipt = result(
          await client.call("artifact/publish", { source: { path: dir }, force: true }, VERIFY_MS),
        ) as { versionId: string };
        const registry = JSON.parse(
          readFileSync(join(home.home, "versions", receipt.versionId, "registry.json"), "utf8"),
        ) as {
          fields: { open: boolean; openReasons: { reason: string }[]; entries: { id?: string }[] };
        };
        coverage[name] = {
          open: registry.fields.open,
          reasons: registry.fields.openReasons.map((reason) => reason.reason),
          ids: registry.fields.entries.flatMap((entry) =>
            entry.id !== undefined ? [entry.id] : [],
          ),
        };
      }
      // Imported as the scan reads it: exact, with the question's fields.
      expect(coverage["seen"]?.reasons).toEqual([]);
      expect(coverage["seen"]?.open).toBe(false);
      expect(coverage["seen"]?.ids).toContain("survey.name");
      // Through import(), or a path into the kit's registry: the scan can't see the ids, so the
      // version's coverage is open and says why, never exact without them.
      for (const name of ["lazy", "registry"]) {
        expect(coverage[name]?.open, name).toBe(true);
        // The reason names the kit module (WP-19: the code editor and whiteboard are such modules).
        expect(coverage[name]?.reasons.join("\n"), name).toMatch(
          /uses @mostra\/kit\/questionnaire where the field scan can't see its ids/,
        );
      }
    },
    VERIFY_MS,
  );

  it(
    "resolves @/ with its query in code, and @/ in a stylesheet and in a theme layer (Opus review 3, 4)",
    async () => {
      const png = Buffer.from(
        "89504e470d0a1a0a0000000d4948445200000001000000010806000000" +
          "1f15c4890000000d4944415478da63f8cfc0f01f0005000201a5d2b6c90000000049454e44ae426082",
        "hex",
      );
      const dir = artifact("at-paths", {
        "index.tsx": `import { defineArtifact } from "@mostra/react";
import notes from "@/notes.md?raw";
import heroUrl from "@/hero.png?url";
import "@/styles.css";

export const artifact = defineArtifact({ title: "Paths", kit: { theme: ["studio", "./brand.css"] } });

export default function Page() {
  return (
    <main>
      <h1>Paths</h1>
      <pre data-notes>{notes}</pre>
      <img src={heroUrl} alt="Hero" width={1} height={1} />
      <div className="banner">Banner</div>
      <div className="brand">Brand</div>
    </main>
  );
}
`,
        "notes.md": "# Notes from the raw import\n",
        "styles.css": '@import "@/more.css";\n.banner { background: url("@/hero.png"); }\n',
        "more.css": ".banner { min-height: 2rem; }\n",
        "brand.css": '.brand { background-image: url("@/hero.png"); }\n',
      });
      writeFileSync(join(dir, "hero.png"), png);
      const verdict = await verify(dir);
      expect(codes(verdict, "error")).toEqual([]);
      expect(codes(verdict, "warning")).toEqual([]);
      const receipt = result(
        await client.call("artifact/publish", { source: { path: dir } }, VERIFY_MS),
      ) as { versionId: string };
      const assets = join(home.home, "versions", receipt.versionId, "client", "assets");
      const files = readdirSync(assets);
      const text = (pattern: RegExp): string =>
        files
          .filter((file) => pattern.test(file))
          .map((file) => readFileSync(join(assets, file), "utf8"))
          .join("\n");
      // `?raw` brought the file's text, `?url` its URL; the stylesheet's `@import` and both
      // stylesheets' `url()`s reached the artifact's own files.
      expect(text(/\.js$/)).toContain("# Notes from the raw import");
      const css = text(/\.css$/);
      expect(css).toContain("min-height:2rem");
      expect(css).not.toContain("@/");
      // The image is small enough to be inlined; either way both stylesheets' urls reached it.
      const hero = /url\("?(?:\/assets\/hero-[^")]*\.png|data:image\/png;base64,[^")]+)"?\)/g;
      expect(css.match(hero)?.length ?? 0).toBeGreaterThanOrEqual(2);
    },
    VERIFY_MS,
  );

  it(
    "builds, verifies and shows a page that names no theme in the home's default stack, which names only what every page has (D181 item 5; Opus review 6, 13)",
    async () => {
      const dir = artifact("home-default", {
        "index.tsx": `import { defineArtifact } from "@mostra/react";

export const artifact = defineArtifact({ title: "Plain" });

export default function Page() {
  return <main><h1>Plain</h1></main>;
}
`,
      });
      // A connection initializes once: each setting of the home's look is a host's own.
      const configure = async (look: Record<string, unknown>): Promise<Message> => {
        const host = await connectTo(daemon.status.socket as string);
        try {
          return await host.call("mostra/initialize", initializeParams({ home: { look } }));
        } finally {
          host.close();
        }
      };
      try {
        // A file or a plugin's theme isn't on every page: refused now, not at the next publish.
        for (const theme of [["studio", "./brand.css"], ["studio", "acme"], "acme"]) {
          const refused = await configure({ theme });
          expect(refused.error?.data.code, JSON.stringify(theme)).toBe(
            "MOSTRA_HOST_INVALID_PARAMS",
          );
        }
        expect((await configure({ theme: ["arcata", "host"] })).error).toBeUndefined();
        const verdict = await verify(dir);
        expect(codes(verdict, "error")).toEqual([]);
        expect(verdict.theme).toEqual({ stack: ["arcata", "host"], default: true });
        const listed = result(await client.call("theme/list", { artifact: { path: dir } })) as {
          artifact: { stack: string[]; default: boolean };
        };
        expect(listed.artifact).toEqual({ stack: ["arcata", "host"], default: true });
        const shown = result(await client.call("theme/show", { artifact: { path: dir } })) as {
          id?: string;
          stack: string[];
          default: boolean;
        };
        expect([shown.id, shown.stack, shown.default]).toEqual([
          "arcata",
          ["arcata", "host"],
          true,
        ]);
        // Another stack for one look is that stack, never a default.
        const other = result(
          await client.call("theme/show", { artifact: { path: dir }, theme: "studio" }),
        ) as { stack: string[]; default: boolean };
        expect([other.stack, other.default]).toEqual([["studio"], false]);
      } finally {
        expect((await configure({})).error).toBeUndefined();
      }
    },
    VERIFY_MS,
  );
});
