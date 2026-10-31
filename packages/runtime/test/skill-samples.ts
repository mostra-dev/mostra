/**
 * The Agent Skill's code samples as one artifact (WP-14, D162): every `tsx` and `ts` block of
 * `skills/mostra/references/` is a complete module, so verify can type-check, build and render all
 * of them, and a reference whose sample no longer matches the API fails CI.
 *
 * - A block containing `defineArtifact(` is skipped: manifests are the examples' (they pass verify).
 * - A block whose first line is `// live.ts` is the artifact's `live.ts` (at most one).
 * - A block that starts with `"use server"` or `// actions.ts` joins `actions.ts`.
 * - A block whose first line names a declaration file (`// pushed.d.ts`) is that file.
 * - Every other block is a module of components (`sample-<reference>-<n>.tsx`); a first line
 *   `// index.tsx` is dropped. The entry renders every top-level function it declares, with the
 *   props of `SAMPLE_PROPS`.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const REFERENCES = fileURLToPath(new URL("../../../skills/mostra/references/", import.meta.url));

/** Props for sample components that take any, by component name. */
export const SAMPLE_PROPS: Readonly<Record<string, string>> = {
  Reply: 'email={{ id: "e1" }} body="Hello"',
  Invoices:
    'data={[{ id: "INV-1", customer: "Acme", amount: 1200 }, { id: "INV-2", customer: "Bolt", amount: 300 }]}',
};

/** The artifact's files, by path. */
export function skillSampleArtifact(): Record<string, string> {
  const live: string[] = [];
  const actions: string[] = [];
  const modules: { path: string; names: string[] }[] = [];
  const files: Record<string, string> = {};
  for (const reference of readdirSync(REFERENCES)
    .filter((name) => name.endsWith(".md"))
    .sort()) {
    const text = readFileSync(join(REFERENCES, reference), "utf8");
    let index = 0;
    for (const match of text.matchAll(/```(tsx|ts)\n([\s\S]*?)```/g)) {
      const code = match[2] as string;
      if (code.includes("defineArtifact(")) continue;
      const first = code.trimStart().split("\n")[0]?.trim() ?? "";
      if (first === "// live.ts") {
        live.push(code.replace(/^\s*\/\/ live\.ts\n/, ""));
        continue;
      }
      const declaration = /^\/\/ ([\w-]+\.d\.ts)$/.exec(first);
      if (declaration) {
        files[declaration[1] as string] = code.replace(/^\s*\/\/ [\w-]+\.d\.ts\n/, "");
        continue;
      }
      if (first === '"use server";' || first === "// actions.ts") {
        actions.push(code.replace(/^\s*\/\/ actions\.ts\n/, "").replace(/^"use server";\n/m, ""));
        continue;
      }
      index += 1;
      const path = `sample-${reference.replace(/\.md$/, "")}-${index}.tsx`;
      const body = code.replace(/^\s*\/\/ index\.tsx\n/, "");
      const names = [...body.matchAll(/^function (\w+)/gm)].map((found) => found[1] as string);
      if (names.length === 0)
        throw new Error(
          `${reference}'s sample ${index} declares no component; samples are complete modules`,
        );
      files[path] = `${body}\nexport { ${names.join(", ")} };\n`;
      modules.push({ path, names });
    }
  }
  if (live.length > 1) throw new Error("more than one live.ts sample");
  if (live[0] !== undefined) files["live.ts"] = live[0];
  if (actions.length > 0) files["actions.ts"] = `"use server";\n${actions.join("\n")}`;
  const imports = modules.map(
    ({ path, names }) => `import { ${names.join(", ")} } from "./${path.replace(/\.tsx$/, "")}";`,
  );
  const rendered = modules.flatMap(({ names }) =>
    names.map((name) => `      <${name}${SAMPLE_PROPS[name] ? ` ${SAMPLE_PROPS[name]}` : ""} />`),
  );
  files["index.tsx"] = `${imports.join("\n")}

export default function Page() {
  return (
    <main className="grid gap-6 p-8">
      <h1>The Skill's samples</h1>
${rendered.join("\n")}
    </main>
  );
}
`;
  return files;
}
