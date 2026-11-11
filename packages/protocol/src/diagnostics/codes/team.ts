/**
 * Diagnostic codes of the TEAM area.
 */
import type { AreaCatalog } from "../spec.ts";

/** The codes of the TEAM area, in the order they were added. */
export const teamDiagnosticCodes = [
  "MOSTRA_TEAM_ROSTER_POLICY",
  "MOSTRA_TEAM_ROSTER_TOO_LARGE",
  "MOSTRA_TEAM_PRESENCE_RATE_LIMITED",
  // gen:codes
] as const;

/** The codes of the TEAM area. */
export type TeamDiagnosticCode = (typeof teamDiagnosticCodes)[number];

/** The TEAM area's catalog entries. */
export const teamDiagnostics: AreaCatalog<TeamDiagnosticCode> = {
  MOSTRA_TEAM_ROSTER_POLICY: {
    severity: "error",
    phase: "host",
    title: "This artifact's policy can't wait for every respondent",
    hint: "Publish with the submission policy once per-viewer or epochs, then wait again; or wait for submitted.",
    docs: {
      explanation:
        "`submitted:all` waits until every expected respondent has submitted, and `submitted:<N>` for N submissions. Both need a policy that takes a submission from each person: `once` with scope `per-viewer`, or `epochs`. Under `once` per-artifact the artifact takes one submission in all, so neither can be met beyond the first, and Mostra refuses the wait instead of letting it run forever.",
      fix: "Publish again with `mostra publish <path> --policy once-per-viewer` (or `--policy epochs`), or wait for `submitted`.",
    },
  },
  MOSTRA_TEAM_ROSTER_TOO_LARGE: {
    severity: "error",
    phase: "host",
    title: "Roster larger than 1,000 respondents",
    hint: "Name at most 1,000 expected respondents; share one link for everyone else instead.",
    docs: {
      explanation:
        "A roster lists the people an artifact expects answers from, each with a personal link and a status. It holds at most 1,000 of them. Nothing was added: the roster is as it was.",
      fix: "Remove respondents you no longer expect (`mostra roster remove`), or, for a page many people answer, share one link and wait for `submitted:<N>` instead.",
    },
  },
  MOSTRA_TEAM_PRESENCE_RATE_LIMITED: {
    severity: "error",
    phase: "hygiene",
    title: "Presence updates too fast",
    hint: "Send presence at most 10 times a second; usePresence does this for you.",
    docs: {
      explanation:
        "A page shares its viewer's cursor and selection through `POST /_mostra/v/<rev>/presence`. Each view may send 20 updates a second; past that the gateway answers 429 with `Retry-After`. Presence is never stored, so nothing is lost: the next update replaces the last one.",
      fix: "Use `usePresence` from `@mostra/react`, which sends at most 10 updates a second, or throttle your own calls to the route.",
    },
  },
  // gen:entries
};
