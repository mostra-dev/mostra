/**
 * Diagnostic codes of the VERIFY area.
 */
import type { AreaCatalog } from "../spec.ts";

/** The codes of the VERIFY area, in the order they were added. */
export const verifyDiagnosticCodes = [
  "MOSTRA_VERIFY_ACTION_SKIPPED",
  "MOSTRA_VERIFY_SKIP_CONSEQUENCE",
  "MOSTRA_VERIFY_TIMEOUT",
  "MOSTRA_VERIFY_CRASHED",
  "MOSTRA_VERIFY_NO_BASELINE",
  "MOSTRA_VERIFY_BASELINE_MISSING",
  "MOSTRA_VERIFY_LIVE_FAILED",
  "MOSTRA_VERIFY_SECRET_MISSING",
  // gen:codes
] as const;

/** The codes of the VERIFY area. */
export type VerifyDiagnosticCode = (typeof verifyDiagnosticCodes)[number];

/** The VERIFY area's catalog entries. */
export const verifyDiagnostics: AreaCatalog<VerifyDiagnosticCode> = {
  MOSTRA_VERIFY_ACTION_SKIPPED: {
    severity: "hint",
    phase: "smoke",
    title: "Action skipped in verify",
    hint: "To have verify run this action, check `dryRun()` from `@mostra/server` in it and return early without its side effects when it is true.",
    docs: {
      explanation:
        "Verify's smoke test never runs a server function that doesn't check `dryRun()` (D55). When the page called one, verify refused the call instead: the page's `run()` or server reference rejected with a `MostraError` carrying this code, as it would for any failed action. The verdict lists every such function in `smoke.skippedActions`. Nothing was sent, written or charged.",
      fix: "Nothing is wrong. To have verify exercise the action, add `if (dryRun()) return <a representative result>;` before its side effects; verify then runs it with `dryRun()` true.",
    },
  },
  MOSTRA_VERIFY_SKIP_CONSEQUENCE: {
    severity: "hint",
    phase: "smoke",
    title: "Page reaction to a skipped action",
    hint: "Nothing to fix: this followed from verify skipping an action, which a viewer's page never meets.",
    docs: {
      explanation:
        "After verify refused a server function that doesn't check `dryRun()`, the page reported an error: an unhandled rejection, an error a boundary caught, or a console error while it settled. It follows from verify's synthetic refusal, not from a defect a viewer would meet, so it is reported as a hint naming the skipped action.",
      fix: "Nothing is required. To let verify see the action's real result, opt it into the smoke test with `dryRun()`.",
    },
  },
  MOSTRA_VERIFY_TIMEOUT: {
    severity: "error",
    phase: "runtime",
    title: "Verify ran out of time",
    hint: "Make the page render without waiting on slow work at load, then verify again.",
    docs: {
      explanation:
        "Verify allows 120 s for everything after the build: booting the sandbox, rendering each viewport, the smoke test and the regression stage. This run went past it, so its verdict is partial: the message names the stage it reached. A partial run can't vouch for the page, so this is an error, and the verdict isn't cached.",
      fix: "Look for work the page does at load that takes long (large data, long animations, requests that never answer) and defer it, then verify again. On a heavily loaded machine, verifying again may be enough.",
    },
  },
  MOSTRA_VERIFY_CRASHED: {
    severity: "error",
    phase: "runtime",
    title: "Verify runner crashed",
    hint: "Verify again; if it keeps crashing, report the message with `mostra doctor`'s output.",
    docs: {
      explanation:
        "The verify runner, the child process that drives the browser, stopped before it finished (FAILURE_MODEL §2). The message carries its last lines of output. Nothing was published, and the next verify starts a fresh runner.",
      fix: "Verify again. A crash that repeats for the same artifact can come from a page that exhausts the browser's memory; one that repeats for every artifact means the runtime's browser is damaged.",
    },
  },
  MOSTRA_VERIFY_NO_BASELINE: {
    severity: "hint",
    phase: "regression",
    title: "No earlier passing version",
    hint: "Nothing to fix: the next version will be compared with this one once it is published.",
    docs: {
      explanation:
        "Verify compares a source with the newest published version of its artifact whose verdict passed. This artifact has none yet (it is new, or every earlier version was published with `--force`), so no regression stage ran.",
      fix: "Nothing is required.",
    },
  },
  MOSTRA_VERIFY_BASELINE_MISSING: {
    severity: "hint",
    phase: "regression",
    title: "Baseline version's build is missing",
    hint: "Nothing to fix here; publish again to give later versions a baseline.",
    docs: {
      explanation:
        "The newest version that passed verify is recorded in the ledger, but its stored build isn't in the home any more, so verify couldn't render it and ran no regression stage.",
      fix: "Nothing is required. A version published from this source becomes the next baseline.",
    },
  },
  MOSTRA_VERIFY_LIVE_FAILED: {
    severity: "warning",
    phase: "runtime",
    title: "Live source failed during verify",
    hint: "Check the live source's message: it failed while verify rendered the page, which may be the environment rather than the code.",
    docs: {
      explanation:
        "A live source's producer (`live.ts`) threw or couldn't reach its data while verify rendered the page. Verify runs producers for real, since they only read, so a failure can come from the environment (no network, a service that is down) as well as from the code. The page shows `useLive`'s `error` meanwhile.",
      fix: "Read the message. If the producer itself is wrong, fix it; if the data source was unreachable, verify again when it is back.",
    },
  },
  MOSTRA_VERIFY_SECRET_MISSING: {
    severity: "warning",
    phase: "runtime",
    title: "Secret missing during verify",
    hint: "Set the secret with `mostra secret set <NAME>` if the artifact needs it; verify reports it as the environment, not the code.",
    docs: {
      explanation:
        "Server code asked for a secret (`secret()`) that neither the host, the artifact's secrets nor the home's hold, while verify ran it. Secrets are part of the environment, so verify reports this as a warning rather than an error.",
      fix: "Run `mostra secret set <NAME>` (for the artifact or the home) with the value the code needs, then verify again.",
    },
  },
  // gen:entries
};
