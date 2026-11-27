/**
 * Diagnostic codes of the DEMO area: web demos, the front ends an artifact builds into its
 * version and shows in `<WebDemo>` (D185).
 */
import type { AreaCatalog } from "../spec.ts";

/** The codes of the DEMO area, in the order they were added. */
export const demoDiagnosticCodes = [
  "MOSTRA_DEMO_UNSUPPORTED",
  "MOSTRA_DEMO_SOURCE_MISSING",
  "MOSTRA_DEMO_BUILD_FAILED",
  "MOSTRA_DEMO_BUILD_TIMEOUT",
  "MOSTRA_DEMO_OUTPUT_MISSING",
  "MOSTRA_DEMO_BASE_MISMATCH",
  "MOSTRA_DEMO_UNKNOWN",
  "MOSTRA_DEMO_NOT_IN_FILE",
  "MOSTRA_DEMO_BASE_NEEDED",
  "MOSTRA_DEMO_NOT_REBUILT",
  // gen:codes
] as const;

/** The codes of the DEMO area. */
export type DemoDiagnosticCode = (typeof demoDiagnosticCodes)[number];

/** The DEMO area's catalog entries. */
export const demoDiagnostics: AreaCatalog<DemoDiagnosticCode> = {
  MOSTRA_DEMO_UNSUPPORTED: {
    severity: "error",
    phase: "manifest",
    title: "A demo declared as a dev server",
    hint: "Declare the demo as a build: `{ source, build, output }`, the folder of its source, the command that builds it and the folder the build writes.",
    docs: {
      explanation:
        "A demo in the manifest names a command to run or a port to attach to: a running dev server. Mostra shows demos as built front ends only, stored with the version, so a demo works the same for every viewer wherever the page is seen and never depends on a process on the author's machine.",
      fix: 'Replace the demo with its build: `demos: { app: { source: "../web", build: ["pnpm", "build"], output: "dist" } }`, and set the app\'s base to `process.env.MOSTRA_DEMO_BASE` (Vite\'s `base`, Next.js\'s `basePath` with `output: "export"`).',
    },
  },
  MOSTRA_DEMO_SOURCE_MISSING: {
    severity: "error",
    phase: "compile",
    title: "A demo's source folder is missing",
    hint: "Point the demo's `source` at the folder of its project, relative to the artifact's directory.",
    docs: {
      explanation:
        "The folder a demo's `source` names, resolved against the artifact's directory, doesn't exist or isn't a folder, so its build can't run.",
      fix: "Fix the path in the manifest's `demos`, or move the project there.",
    },
  },
  MOSTRA_DEMO_BUILD_FAILED: {
    severity: "error",
    phase: "compile",
    title: "A demo's build failed",
    hint: "Read the build's last lines in the message, fix the project, and verify again.",
    docs: {
      explanation:
        "The command a demo's `build` names ended with an error, or couldn't start. The message holds the build's last log lines. Nothing is published while a demo doesn't build.",
      fix: "Run the same command in the demo's folder to see the whole log, fix what it reports (a missing install, a type error, a wrong script name), then verify again.",
    },
  },
  MOSTRA_DEMO_BUILD_TIMEOUT: {
    severity: "error",
    phase: "compile",
    title: "A demo's build ran past its time limit",
    hint: "Make the build faster, or give the demo a longer `timeout` (at most 60m).",
    docs: {
      explanation:
        "A demo's build was still running when its time limit passed (10 minutes unless the demo's `timeout` says otherwise), so Mostra ended it and everything it started.",
      fix: 'Check that the build doesn\'t wait for input or watch files (a dev server never ends), then set a longer limit if it really needs one: `timeout: "20m"`.',
    },
  },
  MOSTRA_DEMO_OUTPUT_MISSING: {
    severity: "error",
    phase: "compile",
    title: "A demo's build wrote no page",
    hint: "Set the demo's `output` to the folder its build writes, which holds its `index.html`.",
    docs: {
      explanation:
        "The demo's build succeeded, but the folder its `output` names holds no `index.html`, so there is nothing to show.",
      fix: "Name the folder the build writes (Vite's `dist`, a Next.js static export's `out`) and make sure the build emits static files (Next.js needs `output: \"export\"`).",
    },
  },
  MOSTRA_DEMO_BASE_MISMATCH: {
    severity: "error",
    phase: "compile",
    title: "A demo loads files from outside its base",
    hint: "Build the demo with its base set to `process.env.MOSTRA_DEMO_BASE`.",
    docs: {
      explanation:
        "A page of the demo's build loads a file by a path outside the one the demo is served under, `/_mostra/demos/<name>/`, which Mostra gives the build as `MOSTRA_DEMO_BASE`. Served from the version, such a file would be missing.",
      fix: 'Read the base from the environment: in Vite `base: process.env.MOSTRA_DEMO_BASE`, in Next.js `basePath: process.env.MOSTRA_DEMO_BASE?.replace(/\\/$/, "")`, and the same path as the router\'s basename.',
    },
  },
  MOSTRA_DEMO_UNKNOWN: {
    severity: "error",
    phase: "runtime",
    title: "The page shows a demo its version doesn't declare",
    hint: "Declare the demo in the manifest's `demos`, or show one it declares.",
    docs: {
      explanation:
        "A `<WebDemo>` or `useDemo` names a demo that the version's manifest doesn't declare, so there is no build to show.",
      fix: "Add the demo to `defineArtifact({ demos: { … } })` under that name, or fix the name the page uses.",
    },
  },
  MOSTRA_DEMO_NOT_IN_FILE: {
    severity: "warning",
    phase: "publish",
    title: "A demo can't run inside a single file",
    hint: "Export the folder version instead: `mostra export <artifact> --as static`.",
    docs: {
      explanation:
        "The `html` export holds a page in one file, which can carry a demo only when its build is one graph of ES modules (Vite and most bundlers). This demo's build loads its scripts by URL (a Next.js export does), so the single file shows a note in its place, and the folder export carries it whole.",
      fix: "Send the `static` export for this page, which opens from disk and carries every demo.",
    },
  },
  MOSTRA_DEMO_BASE_NEEDED: {
    severity: "warning",
    phase: "publish",
    title: "A demo works fully only at a host's root",
    hint: "To host the export at a subpath, export it again with `--base <path>`.",
    docs: {
      explanation:
        "A demo that moves between its pages by browser history was built for the path Mostra serves it under. In this export it works fully when the folder is served at a host's root (`npx serve <folder>`), and on its opening page when the folder is served from a subpath or opened from disk.",
      fix: "Export with the subpath the folder will be served from, such as `--base /my-repo/` for a GitHub Pages project site: Mostra rebuilds each demo under it.",
    },
  },
  MOSTRA_DEMO_NOT_REBUILT: {
    severity: "warning",
    phase: "publish",
    title: "A demo couldn't be rebuilt for the export's base",
    hint: "Export from the machine that built the version, with the demo's source as it was, or export without `--base`.",
    docs: {
      explanation:
        "`--base` rebuilds each demo under the export's path, which needs the demo's source exactly as the version built it. This demo's source isn't there, or has changed since, so the export carries the demo as the version built it, which works fully at a host's root only.",
      fix: "Publish the artifact again with the demo's current source and export that version, or serve the export at a host's root.",
    },
  },
  // gen:entries
};
