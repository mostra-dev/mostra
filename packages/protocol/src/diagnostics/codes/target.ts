/**
 * Diagnostic codes of the TARGET area.
 */
import type { AreaCatalog } from "../spec.ts";

/** The codes of the TARGET area, in the order they were added. */
export const targetDiagnosticCodes = [
  "MOSTRA_TARGET_UNAVAILABLE",
  "MOSTRA_TARGET_CALL_TOO_LONG",
  "MOSTRA_TARGET_SERVER_FEATURES",
  "MOSTRA_TARGET_NOT_INLINED",
  "MOSTRA_TARGET_SHARED_STATE",
  "MOSTRA_TARGET_EXPORT_STRICT",
  // gen:codes
] as const;

/** The codes of the TARGET area. */
export type TargetDiagnosticCode = (typeof targetDiagnosticCodes)[number];

/** The TARGET area's catalog entries. */
export const targetDiagnostics: AreaCatalog<TargetDiagnosticCode> = {
  MOSTRA_TARGET_UNAVAILABLE: {
    severity: "error",
    phase: "runtime",
    title: "Not available in this delivery target",
    hint: "Open the published version through Mostra to use this feature.",
    docs: {
      explanation:
        "The page called something that needs Mostra's server, such as a server function, and this delivery target doesn't provide it: a static export, a file opened from disk, or a runtime without server support. The page keeps working without it.",
      fix: "Open the artifact through its Mostra link, where server functions, submissions and live data are available. In a static export, handle the error so the page explains what isn't available.",
    },
  },
  MOSTRA_TARGET_CALL_TOO_LONG: {
    severity: "error",
    phase: "runtime",
    title: "A call outlasted the chat host's limit",
    hint: "Make work that can take longer than 45 seconds an action run (useAction): a run outlives the call and reports its progress.",
    docs: {
      explanation:
        "A page shown inline in a chat host (an MCP App) reaches its server functions through the host's tool calls, which a host ends after about a minute. A plain call of a server function that hadn't finished within 45 seconds was stopped, and its result is lost: the function was asked to stop through its abort signal.",
      fix: "Call long work through useAction instead of calling the function directly: an action run is recorded before it starts, goes on after the call that started it, and the page follows its progress and result. In the full page, plain calls have no such limit.",
    },
  },
  MOSTRA_TARGET_SERVER_FEATURES: {
    severity: "warning",
    phase: "publish",
    title: "An export loses the page's server features",
    hint: "Keep the answers and state with `--as snapshot`, or the actions running with `--as bundle` and `mostra run`.",
    docs: {
      explanation:
        "The export is the page's front end, and the page has server code: the actions, live producers and Submit the message names need Mostra's server, so in the export they show as unavailable where they sit and live values keep the value they had, marked as frozen. No server code, secret or server setting is in the export.",
      fix: "Nothing, when a readable record of the page is what you want. Export a `snapshot` to keep the answers and state as they are, or a `bundle` for another Mostra home to run the actions; add `--strict` to make this an error in scripts.",
    },
  },
  MOSTRA_TARGET_NOT_INLINED: {
    severity: "warning",
    phase: "publish",
    title: "An export needs a network for some files",
    hint: "Load these files from the artifact itself, or expect them to need a network where the export is opened.",
    docs: {
      explanation:
        "The export couldn't hold some files the page loads, because they come from another address (an external font, image or script): the message lists each. They load only where the export is opened with a network.",
      fix: "Put the files in the artifact (its `public/` folder, or imported from its source) so the export carries them.",
    },
  },
  MOSTRA_TARGET_SHARED_STATE: {
    severity: "warning",
    phase: "publish",
    title: "A snapshot holds other people's answers",
    hint: "Check that the snapshot may carry these answers, or leave the shared state out with `--no-shared-state`.",
    docs: {
      explanation:
        "A snapshot carries the artifact's shared state, which other people wrote (a roster's answers, votes, a shared list): the message says how many people's answers it holds. A snapshot is a file that travels, so they travel with it.",
      fix: "Pass `--no-shared-state` to leave the shared state out, or send the snapshot only to people who may read it.",
    },
  },
  MOSTRA_TARGET_EXPORT_STRICT: {
    severity: "error",
    phase: "publish",
    title: "A strict export found what it would lose",
    hint: "Fix what the warnings name, or export without `--strict`.",
    docs: {
      explanation:
        "`--strict` makes every warning of an export an error: the export found something it would lose or couldn't carry, named in the warnings beside this error, and wrote nothing.",
      fix: "Read the warnings: export another class (`snapshot`, `bundle`, `static`), give the export what it needs (`--base`), or drop `--strict` to accept them.",
    },
  },
  // gen:entries
};
