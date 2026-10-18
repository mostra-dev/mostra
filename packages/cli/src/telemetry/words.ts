/**
 * Telemetry's words to people (D140 item 11): the notice, the question, its answers and the
 * `status` lines, exactly as Mirza approved them (M28). `<docs>` is `DEFAULT_DOCS_BASE` (D37).
 */
import { DEFAULT_DOCS_BASE } from "@mostra/protocol";

const DOCS = `${DEFAULT_DOCS_BASE}/telemetry`;

/** The notice where telemetry is on by default: stderr, once, before the first event. */
export const NOTICE_DEFAULT: string = `Mostra sends anonymous usage data to improve the CLI: the command, its
outcome, the version, the platform, which agent ran it, and a random
install ID. Never content, paths, tokens or personal data.
Details: ${DOCS}
Turn it off: mostra telemetry off, or set DO_NOT_TRACK=1.
`;

/** The question in the ask-first zones, when it may be asked. */
export const QUESTION: string = `Mostra can send anonymous usage data to improve the CLI: the command,
its outcome, the version, the platform, which agent ran it, and a random
install ID. Never content, paths, tokens or personal data.
Details: ${DOCS}
Send anonymous usage data? [y/N] `;

/** The answers to the question. */
export const ANSWER = {
  yes: "Telemetry is on. Turn it off any time: mostra telemetry off\n",
  no: "Telemetry stays off. Turn it on any time: mostra telemetry on\n",
  timeout: "No answer, so telemetry stays off. Turn it on any time: mostra telemetry on\n",
} as const;

/** The notice in the ask-first zones when the question can't be asked: stderr, once. */
export const NOTICE_ASK_FIRST: string = `Mostra can send anonymous usage data to improve the CLI: the command,
its outcome, the version, the platform, which agent ran it, and a random
install ID. Never content, paths, tokens or personal data.
Details: ${DOCS}
Nothing is sent unless you run: mostra telemetry on
An agent should ask its user before turning it on.
`;

/** `mostra telemetry on` and `off`. */
export const TURNED = {
  on: "Telemetry is on. Turn it off any time: mostra telemetry off",
  off: "Telemetry is off. Your install ID and any unsent events were deleted.",
} as const;

/** Why telemetry is on or off: the decision order's reasons (D140 item 3). */
export type TelemetryReason =
  | "no-collector"
  | "embedded"
  | "do-not-track"
  | "variable"
  | "variable-invalid"
  | "setting"
  | "default"
  | "unreadable";

/** The first line of `mostra telemetry status`. */
export function statusLine(input: {
  readonly enabled: boolean;
  readonly reason: TelemetryReason;
  readonly askFirst: boolean;
  readonly settingsFile: string;
}): string {
  if (input.enabled) {
    if (input.reason === "setting") return "Telemetry is on: you turned it on.";
    if (input.reason === "variable") return "Telemetry is on: MOSTRA_TELEMETRY=1 is set.";
    return "Telemetry is on by default here. Turn it off: mostra telemetry off";
  }
  switch (input.reason) {
    case "setting":
      return "Telemetry is off: you turned it off.";
    case "do-not-track":
      return "Telemetry is off: DO_NOT_TRACK is set.";
    case "variable":
      return "Telemetry is off: MOSTRA_TELEMETRY=0 is set.";
    case "variable-invalid":
      return "Telemetry is off: MOSTRA_TELEMETRY has a value Mostra doesn't recognize, so nothing is sent.";
    case "embedded":
      return "Telemetry is off: a host configures this home, and hosts never send telemetry.";
    case "no-collector":
      return "Telemetry is off: this build has no telemetry endpoint.";
    case "unreadable":
      return `Telemetry is off: ${input.settingsFile} can't be read, so nothing is sent.`;
    case "default":
      return "Telemetry is off until you turn it on: mostra telemetry on";
  }
}
