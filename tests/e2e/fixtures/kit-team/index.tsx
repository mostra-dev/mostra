import { Page, Section } from "@mostra/kit/layout";
import { Attribution, LiveCursors, PresenceAvatars, RespondentTracker } from "@mostra/kit/team";
import { defineArtifact, type Presence, type Respondents } from "@mostra/react";

export const artifact = defineArtifact({
  title: "The team's parts",
  kit: { theme: "studio" },
  team: { visibility: "names" },
});

// The shapes WP-31's hooks give, one per visibility (INTERFACES §2.3), so each part renders the
// same from them in every browser and theme; the parts below them read the live hooks.
const AT = "2026-11-26T12:00:00.000Z";
const NOW = new Date("2026-11-26T12:04:00.000Z");

const names: Presence = {
  status: "present",
  visibility: "names",
  count: 3,
  self: { key: "vk_self", name: "Mira", kind: "token", self: true, at: AT },
  others: [
    { key: "vk_ada", name: "Ada Lovelace", kind: "token", self: false, at: AT, cursor: { x: 120, y: 140 } },
    { key: "vk_grace", name: "Grace Hopper", kind: "account", verified: true, self: false, at: AT, cursor: { x: 420, y: 220 } },
    { key: "vk_anon", kind: "anonymous", self: false, at: AT },
  ],
};
const counts: Presence = { status: "present", visibility: "counts", count: 4, others: [] };
const alone: Presence = { status: "present", visibility: "private", others: [] };

const roster: Respondents = {
  visibility: "names",
  owner: false,
  round: 1,
  status: "ready",
  counts: { total: 4, notOpened: 1, drafting: 1, submitted: 2 },
  complete: false,
  self: { key: "vk_self", name: "Mira", kind: "token", self: true, status: "drafting", openedAt: AT },
  respondents: [
    { key: "vk_self", name: "Mira", kind: "token", self: true, status: "drafting", openedAt: AT },
    { key: "vk_ada", name: "Ada Lovelace", kind: "token", self: false, status: "submitted", openedAt: AT, submittedAt: AT },
    { key: "vk_grace", name: "Grace Hopper", kind: "account", verified: true, self: false, status: "submitted", openedAt: AT, submittedAt: AT },
    { key: "vk_linus", name: "Linus", kind: "token", self: false, status: "not-opened" },
  ],
};
const tally: Respondents = {
  visibility: "counts",
  owner: false,
  round: 1,
  status: "ready",
  counts: { total: 5, notOpened: 2, drafting: 0, submitted: 3 },
  complete: false,
  respondents: [],
};

/** A class each part takes, which shows as a thick red outline. */
const MARKED = "outline-4 outline-[rgb(255,0,0)] outline-solid";

export default function Team() {
  return (
    <Page title="The team's parts" width="wide">
      <Section title="Who is here">
        <div data-testid="presence-names">
          <PresenceAvatars presence={names} className={MARKED} />
        </div>
        <div data-testid="presence-counts">
          <PresenceAvatars presence={counts} />
        </div>
        <div data-testid="presence-private">
          <PresenceAvatars presence={alone} />
        </div>
        <div data-testid="presence-live">
          <PresenceAvatars />
        </div>
      </Section>
      <Section title="Who has answered">
        <div data-testid="roster-names">
          <RespondentTracker respondents={roster} className={MARKED} />
        </div>
        <div data-testid="roster-counts">
          <RespondentTracker respondents={tally} title="Retro" />
        </div>
        <div data-testid="roster-live">
          <RespondentTracker />
        </div>
      </Section>
      <Section title="Who changed it">
        <p data-testid="attribution">
          The action list <Attribution by={{ kind: "viewer", name: "Grace Hopper", key: "vk_grace", at: AT }} now={NOW} className={MARKED} />{" "}
          <Attribution by={{ kind: "viewer", name: "Mira", key: "vk_self", self: true, at: AT }} now={NOW} />{" "}
          <Attribution by={{ kind: "agent", at: AT }} now={NOW} />
        </p>
      </Section>
      <LiveCursors presence={names} className={MARKED} />
    </Page>
  );
}
