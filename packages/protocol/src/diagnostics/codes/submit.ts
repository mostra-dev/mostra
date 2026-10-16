/**
 * Diagnostic codes of the SUBMIT area.
 */
import type { AreaCatalog } from "../spec.ts";

/** The codes of the SUBMIT area, in the order they were added. */
export const submitDiagnosticCodes = [
  "MOSTRA_SUBMIT_ALREADY",
  "MOSTRA_SUBMIT_REVISION_MOVED",
  "MOSTRA_SUBMIT_POLICY_NONE",
  "MOSTRA_SUBMIT_NOT_FOUND",
  "MOSTRA_SUBMIT_VIEW_INVALID",
  "MOSTRA_SUBMIT_SIGNAL_INVALID",
  "MOSTRA_SUBMIT_CHANNEL_DENIED",
  "MOSTRA_SUBMIT_BLOCKED",
  // gen:codes
] as const;

/** The codes of the SUBMIT area. */
export type SubmitDiagnosticCode = (typeof submitDiagnosticCodes)[number];

/** The SUBMIT area's catalog entries. */
export const submitDiagnostics: AreaCatalog<SubmitDiagnosticCode> = {
  MOSTRA_SUBMIT_ALREADY: {
    severity: "error",
    phase: "runtime",
    title: "Already submitted",
    hint: "This artifact takes one submission, and it was made; read it with `mostra results`.",
    docs: {
      explanation:
        "The artifact's submission policy is `once`, and a submission already closed this draft: for scope `per-artifact` any viewer's submission closes every draft, for `per-viewer` the viewer's own. A submission is immutable and final, so Mostra refuses a second one and further edits to the closed draft. The refusal carries the existing submission. A repeated submit of the same view at the same draft revision is not refused: it returns the original submission.",
      fix: 'Read the existing submission with `mostra results <artifact>`. When another round of answers is wanted, publish a new artifact linked to this one (`links: [{ rel: "round-of", artifact }]`), or have the host publish with the `epochs` policy.',
    },
  },
  MOSTRA_SUBMIT_REVISION_MOVED: {
    severity: "error",
    phase: "runtime",
    title: "Draft changed before submit",
    hint: "Reload the draft, check what changed, and submit again with its current revision.",
    docs: {
      explanation:
        "A submit names the draft revision the viewer saw (`expectedRevision`), and the draft has changed since: another tab, device or writer saved an edit. Mostra never makes a submission from content the viewer didn't see (FAILURE_MODEL §4), so it refuses. The message names the draft's current revision.",
      fix: "Let the page reload the draft so the viewer sees exactly what will be sent, then submit with the new revision. The shell and the client runtime flush pending saves before they submit, which makes this rare.",
    },
  },
  MOSTRA_SUBMIT_POLICY_NONE: {
    severity: "error",
    phase: "runtime",
    title: "Artifact takes no submissions",
    hint: "Exchange data through artifact state, actions and signals; this artifact has no submissions.",
    docs: {
      explanation:
        "The artifact's submission policy is `none` (D63): long-lived artifacts such as dashboards and task managers talk to agents through artifact state, actions, signals and events, and the shell shows no Submit control. Mostra refuses a submit, and a `wait --until submitted`, on such an artifact.",
      fix: "Wait for a signal (`--until signal:<name>`), a state change (`--until state:<field>`) or an event instead, and read state with `mostra state get`. To collect submissions, publish with policy `once` or `epochs`.",
    },
  },
  MOSTRA_SUBMIT_NOT_FOUND: {
    severity: "error",
    phase: "runtime",
    title: "No such submission",
    hint: "Wait for a submission with `mostra wait --until submitted`, or name one that exists.",
    docs: {
      explanation:
        "The artifact has no submission yet, or none with the ID asked for. Submissions are durable once made, so this means none was made (or the ID belongs to another artifact or home).",
      fix: "Run `mostra wait <artifact> --until submitted` to block until the viewer submits, then read the results. List the artifact's submissions through `submission.created` events.",
    },
  },
  MOSTRA_SUBMIT_VIEW_INVALID: {
    severity: "error",
    phase: "runtime",
    title: "Unknown view",
    hint: "Send the view ID this page was opened with.",
    docs: {
      explanation:
        "Mutations and submits name the view they come from, the one the shell created when it opened this frame. The view named doesn't exist, belongs to another artifact, or belongs to another viewer. Mostra binds every submission to the exact version its view showed, so it refuses a view it can't place.",
      fix: "Use the `viewId` the shell handed this frame. A page opened outside Mostra's shell has no view and can't submit.",
    },
  },
  MOSTRA_SUBMIT_SIGNAL_INVALID: {
    severity: "error",
    phase: "runtime",
    title: "Invalid signal",
    hint: "Name signals with letters, digits, `.`, `_` and `-`, and keep their payload under 64 KiB of JSON.",
    docs: {
      explanation:
        "A signal names something the artifact wants a host's attention for, such as `ping-agent`. Its name is 1 to 64 characters of letters, digits, `.`, `_` and `-`, starting with a letter or digit, and its payload is JSON of at most 64 KiB. This one broke one of those rules. The name `submit` is reserved for submissions.",
      fix: "Rename the signal or shrink its payload; put large data into a field or artifact state and send its ID in the payload.",
    },
  },
  MOSTRA_SUBMIT_CHANNEL_DENIED: {
    severity: "error",
    phase: "runtime",
    title: "Submit channel not allowed",
    hint: "Let the viewer submit with the shell's trusted Submit; this host doesn't take submissions from artifact code.",
    docs: {
      explanation:
        "A submission comes through one of two channels (D40): the shell's trusted Submit (`shell`), which only a person can press, or the artifact's own code (`artifact`, `useSubmit().submit()` and `useChoice().choose()`). The host decides which it accepts (D108): through `HomeConfig.submitChannels` for the home, or its `trustedControls` port for each artifact. This view allows only the other channel, so Mostra refused the submit or the choice. `useSubmit().allowed` is `false` in such a view.",
      fix: "Ask the viewer to press the shell's Submit (relabel it with `useSubmitControl`), and use `useChoice(id, { candidates })` to have the shell render a trusted Choose. Check `allowed` before showing an in-page submit button.",
    },
  },
  MOSTRA_SUBMIT_BLOCKED: {
    severity: "error",
    phase: "runtime",
    title: "Answers missing before submit",
    hint: "Fill in the fields this diagnostic lists, fix their errors or resolve their conflicts, then submit again.",
    docs: {
      explanation:
        "Before a submit, the shell and the client runtime check every mounted field (D106): a `required` field without a value, a value its `validate` rejects, or a conflict the viewer hasn't resolved blocks the submit. The diagnostic lists the blockers with their field IDs and labels; `useSubmit().blockers` lists them before anyone submits. Nothing was submitted.",
      fix: "Show `useSubmit().blockers` next to your submit button, or let the shell list them by label. Answer the required fields, fix the invalid values, and keep or take the conflicting values, then submit again.",
    },
  },
  // gen:entries
};
