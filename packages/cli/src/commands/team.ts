/**
 * Teams (D121, D168): `roster get|add|remove`, thin clients of `roster/*`. A respondent is named by
 * the caller's own stable key for them (`ref`, an email or an account ID) and gets a personal link
 * that acts as them; `mostra wait --until submitted:all` waits for every one of them.
 */
import {
  type CapabilityScope,
  RespondentSpec,
  type Roster,
  rosterAddMethod,
  rosterGetMethod,
  rosterRemoveMethod,
} from "@mostra/protocol";
import { type CommandDef, defineCommand } from "../command.ts";
import { EXIT } from "../exit.ts";
import { usage } from "../parse.ts";
import { arg, artifactRef, flag, jsonInput } from "./shared.ts";

/** One line per respondent and the round's tally: what `roster get` prints. */
export function rosterText(roster: Roster): string {
  const { counts } = roster;
  const head =
    counts.total === 0
      ? "No expected respondents.\n"
      : `Round ${roster.round}: ${counts.submitted} of ${counts.total} submitted, ${counts.drafting} drafting, ${counts.notOpened} not opened${roster.complete ? " (complete)" : ""}.\n`;
  const width = Math.max(0, ...roster.respondents.map((one) => one.ref.length));
  const lines = roster.respondents.map(
    (one) =>
      `  ${one.status.padEnd(10)} ${one.ref.padEnd(width)}${one.name !== undefined ? `  ${one.name}` : ""}\n`,
  );
  return `${head}${lines.join("")}`;
}

/** `mostra roster get <artifact>`. */
export const rosterGetCommand: CommandDef = defineCommand({
  path: ["roster", "get"],
  summary:
    "Show who an artifact expects answers from and where each stands: not opened, drafting or submitted.",
  args: [{ name: "artifact", summary: "The artifact: its source path or its ID." }],
  output: { type: "Roster", topic: "cli" },
  exits: [EXIT.failure],
  example: "roster get ./retro",
  async run(context) {
    const result = await context.call(rosterGetMethod, {
      artifact: artifactRef(arg(context, "artifact"), context.cwd),
    });
    return { result, human: rosterText(result) };
  },
});

/** `mostra roster add <artifact> [ref…]`. */
export const rosterAddCommand: CommandDef = defineCommand({
  path: ["roster", "add"],
  summary:
    "Name the people an artifact expects answers from; each gets a personal link that acts as them.",
  args: [
    { name: "artifact", summary: "The artifact: its source path or its ID." },
    {
      name: "ref",
      summary: "Each respondent, by your own stable key for them (an email, an account ID).",
      optional: true,
      variadic: true,
    },
  ],
  flags: [
    {
      name: "name",
      kind: "string",
      value: "<name>",
      summary: "The display name of the one respondent given.",
    },
    {
      name: "email",
      kind: "string",
      value: "<address>",
      summary: "Where a remote server that sends invitations writes to the one respondent given.",
    },
    {
      name: "file",
      kind: "string",
      value: "<path>",
      summary: "Read respondents from a JSON file: [{ ref, name?, email? }].",
    },
    { name: "stdin", kind: "boolean", summary: "Read respondents as JSON from stdin." },
    {
      name: "scope",
      kind: "list",
      value: "<a,b>",
      summary:
        "The personal links' scopes: view, draft, submit, review, signal, action:*. Default: all.",
    },
    {
      name: "ttl",
      kind: "duration",
      value: "<d>",
      summary: "How long the personal links work, such as 7d. Default: no limit.",
    },
    {
      name: "request-id",
      kind: "string",
      value: "<id>",
      summary: "Make a retry return the first attempt's links.",
    },
  ],
  output: { type: "RosterAddResult", topic: "cli" },
  exits: [EXIT.failure],
  example: "roster add ./retro ada@example.com grace@example.com",
  readsStdin: (flags) => flags["stdin"] === true,
  async run(context) {
    const refs = (context.args["ref"] as readonly string[] | undefined) ?? [];
    const name = flag(context, "name");
    const email = flag(context, "email");
    const fromJson = context.flags["file"] !== undefined || context.flags["stdin"] === true;
    let respondents: RespondentSpec[];
    if (fromJson) {
      if (refs.length > 0 || name !== undefined || email !== undefined) {
        throw usage("Give respondents either as arguments or with --file or --stdin, not both.");
      }
      const parsed = RespondentSpec.array()
        .min(1)
        .safeParse(await jsonInput(context, "respondents"));
      if (!parsed.success) {
        throw usage("The respondents must be a non-empty JSON array of { ref, name?, email? }.");
      }
      respondents = parsed.data;
    } else {
      if (refs.length === 0)
        throw usage("Name at least one respondent, or give --file or --stdin.");
      if ((name !== undefined || email !== undefined) && refs.length !== 1) {
        throw usage("--name and --email describe one respondent: give one ref with them.");
      }
      respondents = refs.map((ref) => ({
        ref,
        ...(name !== undefined ? { name } : {}),
        ...(email !== undefined ? { email } : {}),
      }));
    }
    const scopes = context.flags["scope"] as readonly string[] | undefined;
    const ttl = flag(context, "ttl");
    const requestId = flag(context, "request-id");
    const result = await context.call(rosterAddMethod, {
      artifact: artifactRef(arg(context, "artifact"), context.cwd),
      respondents,
      ...(scopes !== undefined ? { scopes: scopes as CapabilityScope[] } : {}),
      ...(ttl !== undefined ? { ttl: ttl as `${number}${"s" | "m" | "h" | "d"}` } : {}),
      ...(requestId !== undefined ? { requestId } : {}),
    });
    const width = Math.max(0, ...result.links.map((entry) => entry.ref.length));
    const links = result.links.map((entry) => `${entry.ref.padEnd(width)}  ${entry.link.url}\n`);
    return {
      result,
      human: `${links.join("")}Send each person their own link. Wait for everyone with: mostra wait ${arg(context, "artifact")} --until submitted:all\n`,
    };
  },
});

/** `mostra roster remove <artifact> <ref…>`. */
export const rosterRemoveCommand: CommandDef = defineCommand({
  path: ["roster", "remove"],
  summary:
    "Stop expecting answers from respondents; their links, drafts and submissions stay as they are.",
  args: [
    { name: "artifact", summary: "The artifact: its source path or its ID." },
    { name: "ref", summary: "Each respondent to remove, by their ref.", variadic: true },
  ],
  flags: [
    {
      name: "request-id",
      kind: "string",
      value: "<id>",
      summary: "Make a retry return the first attempt's result.",
    },
  ],
  output: { type: "RosterRemoveResult", topic: "cli" },
  exits: [EXIT.failure],
  example: "roster remove ./retro grace@example.com",
  async run(context) {
    const refs = (context.args["ref"] as readonly string[] | undefined) ?? [];
    if (refs.length === 0) throw usage("Name at least one respondent to remove.");
    const requestId = flag(context, "request-id");
    const result = await context.call(rosterRemoveMethod, {
      artifact: artifactRef(arg(context, "artifact"), context.cwd),
      refs: [...refs],
      ...(requestId !== undefined ? { requestId } : {}),
    });
    return {
      result,
      human: `${result.removed.length === 0 ? "No one removed.\n" : `Removed ${result.removed.join(", ")}.\n`}${rosterText(result.roster)}`,
    };
  },
});
