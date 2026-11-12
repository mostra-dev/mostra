/**
 * Teams (WP-31, D168): expected respondents with personal links through the host's own client,
 * each respondent's status, the roster's durable events, and the `submitted:all` and
 * `submitted:<N>` waits under `once` per viewer and `epochs`, with each answer delivered to the
 * host (CO-01, CO-02, CO-03).
 */
import { FORM } from "../fixtures.ts";
import { type Scenario, same } from "../scenario.ts";
import { Viewer } from "../viewer.ts";

interface RosterAnswer {
  readonly roster: {
    readonly round: number;
    readonly complete: boolean;
    readonly respondents: readonly { readonly ref: string; readonly status: string }[];
  };
  readonly links: readonly { readonly ref: string; readonly link: { readonly url: string } }[];
}

const PEOPLE = [
  { ref: "ada@example.com", name: "Ada" },
  { ref: "grace@example.com", name: "Grace" },
  { ref: "alan@example.com", name: "Alan" },
];

/** Answers and submits on whichever channel the view allows. */
async function answerAndSubmit(viewer: Viewer, fields: Record<string, unknown>) {
  return viewer.answer(
    fields,
    viewer.ticket.submitChannels.includes("artifact") ? "artifact" : "shell",
  );
}

/** CO-01, CO-03: a roster through the host's client; each link acts as its respondent. */
export const roster: Scenario = {
  id: "team.roster",
  title:
    "roster/add gives each expected respondent a personal link that acts as them, again keeps it; roster/get reports each one's status; roster changes are durable events",
  covers: ["HO-05", "CO-01", "CO-03"],
  async run(context) {
    await context.start();
    const receipt = await context.published(FORM, {
      policy: { policy: "once", scope: "per-viewer" },
    });
    const artifact = { artifactId: receipt.artifactId };
    const added = await context.host.call<RosterAnswer>("roster/add", {
      artifact,
      respondents: PEOPLE,
    });
    same(added.links.length, 3, "the personal links roster/add gives three respondents");
    const again = await context.host.call<RosterAnswer>("roster/add", {
      artifact,
      respondents: PEOPLE,
    });
    same(
      again.links.map((entry) => entry.link.url).join(" "),
      added.links.map((entry) => entry.link.url).join(" "),
      "the links adding the same respondents again gives",
    );
    const viewers: Viewer[] = [];
    for (const entry of added.links) viewers.push(await Viewer.open(entry.link.url));
    const [ada] = viewers as [Viewer, ...Viewer[]];
    same((await answerAndSubmit(ada, { name: "Ada" })).status, 200, "Ada's submit");
    const read = await context.host.call<RosterAnswer["roster"]>("roster/get", { artifact });
    same(
      read.respondents.map((one) => `${one.ref}=${one.status}`).join(" "),
      "ada@example.com=submitted grace@example.com=drafting alan@example.com=drafting",
      "each respondent's status: Ada submitted, the others opened their links",
    );
    const results = await context.results(receipt.artifactId);
    same(results.submission.viewer.name, "Ada", "the submission's viewer is the respondent");
    const events = await context.events({ artifacts: [receipt.artifactId], types: ["roster.*"] });
    same(
      events.events.map((event) => event.type).join(" "),
      "roster.changed",
      "the roster's events: one change, adding again changed nothing",
    );
  },
};

/** CO-02: everyone's answer, under once per viewer and epochs, each delivered to the host. */
export const waits: Scenario = {
  id: "team.waits",
  title:
    "submitted:all holds exactly when the last expected respondent submits (roster.completed), once per round under epochs; submitted:<N> at the N-th; every answer reaches the host",
  covers: ["HO-05", "CO-02", "IN-12"],
  async run(context) {
    await context.start();
    for (const policy of [{ policy: "once", scope: "per-viewer" }, { policy: "epochs" }]) {
      const receipt = await context.published(FORM, { policy });
      const artifact = { artifactId: receipt.artifactId };
      const added = await context.host.call<RosterAnswer>("roster/add", {
        artifact,
        respondents: PEOPLE,
      });
      const viewers: Viewer[] = [];
      for (const entry of added.links) viewers.push(await Viewer.open(entry.link.url));
      const start = await context.host.call<{ cursor: string }>("wait", {
        artifact,
        until: "submitted:all",
        timeoutMs: 0,
      });
      same(
        (start as { status?: string }).status,
        "still_waiting",
        `${policy.policy}: before anyone`,
      );
      const all = context.host.call<{ status: string; event: { type: string }; cursor: string }>(
        "wait",
        { artifact, until: "submitted:all", after: start.cursor, timeoutMs: 60_000 },
      );
      for (const [index, viewer] of viewers.entries()) {
        same(
          (await answerAndSubmit(viewer, { name: PEOPLE[index]?.name })).status,
          200,
          `${policy.policy}: ${PEOPLE[index]?.name}'s submit`,
        );
        if (index === 1) {
          const two = await context.host.call<{ status: string }>("wait", {
            artifact,
            until: "submitted:2",
            after: start.cursor,
            timeoutMs: 0,
          });
          same(two.status, "satisfied", `${policy.policy}: submitted:2 at the second answer`);
          const early = await context.host.call<{ status: string }>("wait", {
            artifact,
            until: "submitted:all",
            after: start.cursor,
            timeoutMs: 0,
          });
          same(early.status, "still_waiting", `${policy.policy}: submitted:all before the last`);
        }
      }
      const done = await all;
      same(done.status, "satisfied", `${policy.policy}: submitted:all at the last answer`);
      same(done.event.type, "roster.completed", `${policy.policy}: the event that satisfies it`);
      if (policy.policy === "epochs") {
        const next = await context.host.call<{ status: string }>("wait", {
          artifact,
          until: "submitted:all",
          after: done.cursor,
          timeoutMs: 0,
        });
        same(next.status, "still_waiting", "epochs: the next round waits for everyone again");
        const round = await context.host.call<RosterAnswer["roster"]>("roster/get", { artifact });
        same(round.round, 2, "epochs: the roster's round after everyone answered");
      }
    }
    // Every answer of both artifacts reaches the host that takes submissions.
    if (context.host.serves("submissions")) {
      await context.eventually(
        "every answer of both rosters in the host's store",
        async () => (await context.store()).deliveries.length >= 6,
      );
    }
  },
};

/** The team scenarios. */
export const TEAM_SCENARIOS: readonly Scenario[] = [roster, waits];
