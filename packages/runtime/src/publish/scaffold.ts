/**
 * What `artifact/create` (`mostra new`) writes into an empty directory: the entry with the
 * artifact's generated `id`, an `AGENTS.md` for the agent that edits it next (AX-06, WP-14), and a
 * `CLAUDE.md` that imports it, since Claude Code loads a subdirectory's `CLAUDE.md` when it works
 * there but not its `AGENTS.md`. Every file is source like any other: it is in the version's
 * snapshot and its digest.
 */

/** What a new artifact's files are made from. */
export interface ScaffoldInput {
  readonly artifactId: string;
  readonly title: string;
  /** This runtime's release, which `npx -y @mostra/cli@<version>` pins. */
  readonly version: string;
}

/** The files a new artifact gets, in the order `artifact/create` reports them. */
export const SCAFFOLD_PATHS: readonly string[] = ["index.tsx", "AGENTS.md", "CLAUDE.md"];

function entry({ artifactId, title }: ScaffoldInput): string {
  return [
    'import { defineArtifact } from "@mostra/react";',
    "",
    "export const artifact = defineArtifact({",
    `  id: ${JSON.stringify(artifactId)},`,
    `  title: ${JSON.stringify(title)},`,
    "});",
    "",
    "export default function Page() {",
    "  return (",
    '    <main className="mx-auto max-w-2xl p-8">',
    '      <h1 className="text-2xl font-semibold">{artifact.title}</h1>',
    "    </main>",
    "  );",
    "}",
    "",
  ].join("\n");
}

/** A Markdown heading's text: one line, nothing that reads as Markdown syntax at its start. */
function headingText(title: string): string {
  const line = title.replace(/\s+/g, " ").trim();
  return line === "" ? "Mostra artifact" : line;
}

function agents({ title, version }: ScaffoldInput): string {
  return [
    `# ${headingText(title)}`,
    "",
    "This directory is a Mostra artifact: a page people open from a private link, read, answer and act on. Their answers come back to you as results.",
    "",
    "## Work on it",
    "",
    "1. Edit `index.tsx`: ordinary React 19 and TypeScript with Tailwind CSS 4, with no `package.json` or build configuration.",
    "2. Run `mostra verify .` until it reports `pass`, and look at both screenshots it lists (`--screenshots always` lists them every time).",
    "3. Run `mostra publish .`. It prints the private link: whoever holds it can use the page.",
    "4. Give the link to the person, saying who is asking and why. Then run `mostra wait . --until submitted` and `mostra results .`.",
    "",
    `Where \`mostra\` isn't installed, run \`npx -y @mostra/cli@${version}\` in its place.`,
    "",
    "## Keep in mind",
    "",
    '- Every answer is a field with an ID that stays the same on every render and in every version: `useField("budget", 0, { label: "Budget" })`, or a template on your data\'s own ID for a list. Answers carry over to a new version by ID.',
    "- Keep the `id` in `defineArtifact`: it is this artifact's identity. Manifest values are literals.",
    '- Code that must run on this machine (send, save, call an API) goes in a module that starts with `"use server"`; live data in `live.ts`; static files in `public/`.',
    "- Imports stay inside this directory, or name an npm package.",
    "",
    "## More",
    "",
    "`mostra docs guide` is the full guide to writing artifacts, and `mostra docs <CODE>` explains any diagnostic. The same guide is the Mostra Agent Skill: `npx skills add mostra-dev/mostra`.",
    "",
  ].join("\n");
}

/** The files of a new artifact, by path. */
export function scaffoldFiles(input: ScaffoldInput): Map<string, string> {
  return new Map([
    ["index.tsx", entry(input)],
    ["AGENTS.md", agents(input)],
    ["CLAUDE.md", "@AGENTS.md\n"],
  ]);
}
