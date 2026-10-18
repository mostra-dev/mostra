/**
 * Interaction: `wait`, `results`, `push` and `state get|set|patch`, thin clients of `wait`,
 * `results/get`, `live/push` and `state/*` (INTERFACES §6, D101). `wait` ends with exit 5 when it
 * times out (`still_waiting`), and a write that meets a conflict with exit 6.
 */
import {
  FieldOp,
  livePushMethod,
  MutationId,
  resultsGetMethod,
  stateGetMethod,
  statePatchMethod,
  type WaitCondition,
  type WaitResult,
  waitMethod,
} from "@mostra/protocol";
import { type CommandDef, defineCommand } from "../command.ts";
import { EXIT } from "../exit.ts";
import { durationMs, usage } from "../parse.ts";
import { arg, artifactRef, flag, jsonInput, parseJson, pretty } from "./shared.ts";

/** The longest one `wait` request may ask for (INTERFACES §6: 2^31 − 1 ms). */
const MAX_WAIT_MS = 2 ** 31 - 1;

/** `mostra wait <artifact>`. */
export const waitCommand: CommandDef = defineCommand({
  path: ["wait"],
  summary:
    "Block until an artifact's submission, signal, state change or event; still_waiting on timeout.",
  args: [{ name: "artifact", summary: "The artifact: its source path or its ID." }],
  flags: [
    {
      name: "until",
      kind: "string",
      value: "<condition>",
      summary: "submitted, signal:<name>, state:<fieldId> or event:<type>.",
    },
    {
      name: "after",
      kind: "string",
      value: "<cursor>",
      summary: "Wait for what comes after this cursor. Default: the latest publish.",
    },
    {
      name: "timeout",
      kind: "duration",
      value: "<d>",
      summary: "Stop waiting after this long, with still_waiting and exit 5. Default: no limit.",
    },
  ],
  output: { type: "WaitResult", topic: "cli" },
  exits: [EXIT.failure, EXIT.stillWaiting],
  example: "wait ./sidebar-review --until submitted --timeout 30m",
  async run(context) {
    const until = flag(context, "until");
    if (until === undefined) throw usage('"mostra wait" needs --until, such as --until submitted.');
    const timeout = flag(context, "timeout");
    const deadline = timeout === undefined ? undefined : Date.now() + durationMs(timeout);
    const artifact = artifactRef(arg(context, "artifact"), context.cwd);
    let after = flag(context, "after");
    for (;;) {
      const remaining = deadline === undefined ? MAX_WAIT_MS : Math.max(0, deadline - Date.now());
      const result: WaitResult = await context.call(waitMethod, {
        artifact,
        until: until as WaitCondition,
        timeoutMs: Math.min(remaining, MAX_WAIT_MS),
        ...(after !== undefined ? { after } : {}),
      });
      if (result.status === "satisfied") {
        return { result, human: `${result.event.type} at cursor ${result.cursor}\n` };
      }
      // No limit: wait again from the newest cursor examined, so nothing is missed.
      if (deadline === undefined) {
        after = result.cursor;
        continue;
      }
      return {
        result,
        human: `still waiting; resume with --after ${result.cursor}\n`,
        exit: EXIT.stillWaiting,
      };
    }
  },
});

/** `mostra results <artifact>`. */
export const resultsCommand: CommandDef = defineCommand({
  path: ["results"],
  summary:
    "Print an artifact's submission in full: answers, state, choices, comments, actions and signals.",
  args: [{ name: "artifact", summary: "The artifact: its source path or its ID." }],
  flags: [
    {
      name: "submission",
      kind: "string",
      value: "<id>",
      summary: "This submission instead of the latest.",
    },
    {
      name: "format",
      kind: "string",
      value: "<format>",
      choices: ["md", "json"],
      summary: "Markdown or JSON. Default: Markdown, or JSON with --json.",
    },
  ],
  output: { type: "Results", topic: "cli" },
  exits: [EXIT.failure],
  example: "results ./sidebar-review",
  async run(context) {
    const format = (flag(context, "format") ?? (context.json ? "json" : "md")) as "md" | "json";
    const submission = flag(context, "submission");
    const result = await context.call(resultsGetMethod, {
      artifact: artifactRef(arg(context, "artifact"), context.cwd),
      format,
      ...(submission !== undefined ? { submission } : {}),
    });
    const markdown =
      typeof result === "object" && result !== null && "markdown" in result
        ? (result as { markdown: string }).markdown
        : undefined;
    return { result, human: markdown !== undefined ? `${markdown.trimEnd()}\n` : pretty(result) };
  },
});

/** `mostra push <artifact> <key>`. */
export const pushCommand: CommandDef = defineCommand({
  path: ["push"],
  summary: "Push a value into an artifact's live source; pages showing it update at once.",
  args: [
    { name: "artifact", summary: "The artifact: its source path or its ID." },
    { name: "key", summary: "The live source's key: its export name in live.ts, or a new one." },
  ],
  flags: [
    { name: "value", kind: "string", value: "<json>", summary: "The value, as JSON." },
    { name: "file", kind: "string", value: "<path>", summary: "Read the value from a JSON file." },
    { name: "stdin", kind: "boolean", summary: "Read the value from stdin." },
    {
      name: "append",
      kind: "boolean",
      summary: "Add the value to the source's ring instead of replacing it.",
    },
    {
      name: "request-id",
      kind: "string",
      value: "<id>",
      summary: "Make a retry return the first attempt's revision.",
    },
  ],
  output: { type: "LivePushResult", topic: "cli" },
  exits: [EXIT.failure],
  example: `push ./dashboard prices --value '{"btc": 64000}'`,
  readsStdin: (flags) => flags["stdin"] === true,
  async run(context) {
    const value = await jsonInput(context);
    const requestId = flag(context, "request-id");
    const result = await context.call(livePushMethod, {
      artifact: artifactRef(arg(context, "artifact"), context.cwd),
      key: arg(context, "key"),
      value,
      ...(context.flags["append"] === true ? { mode: "append" as const } : {}),
      ...(requestId !== undefined ? { requestId } : {}),
    });
    return { result, human: `revision ${result.revision}\n` };
  },
});

const writeFlags = [
  {
    name: "base",
    kind: "string" as const,
    value: "<revision>",
    summary:
      "Write only if the fields are unchanged since this revision; else a conflict (exit 6).",
  },
  {
    name: "as",
    kind: "string" as const,
    value: "<actor>",
    choices: ["agent", "host"],
    default: "agent",
    summary: "Who the change is attributed to.",
  },
  {
    name: "mutation-id",
    kind: "string" as const,
    value: "<mut_…>",
    summary: "Make a retry return the first attempt's result.",
  },
];

/** `mostra state get <artifact> [ids…]`. */
export const stateGetCommand: CommandDef = defineCommand({
  path: ["state", "get"],
  summary: "Read an artifact's state: the fields every viewer shares, with their revisions.",
  args: [
    { name: "artifact", summary: "The artifact: its source path or its ID." },
    { name: "id", summary: "Only these field IDs.", optional: true, variadic: true },
  ],
  output: { type: "StateGetResult", topic: "cli" },
  exits: [EXIT.failure],
  example: "state get ./tasks priorities",
  async run(context) {
    const ids = context.args["id"] as readonly string[] | undefined;
    const result = await context.call(stateGetMethod, {
      artifact: artifactRef(arg(context, "artifact"), context.cwd),
      ...(ids !== undefined && ids.length > 0 ? { ids: [...ids] } : {}),
    });
    return { result, human: pretty(result) };
  },
});

/** Sends one state mutation; a conflict ends with exit 6. */
async function patch(
  context: Parameters<(typeof stateGetCommand)["run"]>[0],
  ops: readonly FieldOp[],
): Promise<{ result: unknown; human: string; exit?: number }> {
  const base = flag(context, "base");
  const as = (flag(context, "as") ?? "agent") as "agent" | "host";
  const result = await context.call(statePatchMethod, {
    artifact: artifactRef(arg(context, "artifact"), context.cwd),
    ops,
    mutationId: flag(context, "mutation-id") ?? MutationId.create(),
    as,
    ...(base !== undefined ? { baseRevision: base } : {}),
  });
  const conflicted = result.conflicts.length > 0;
  return {
    result,
    human: conflicted
      ? `conflict on ${result.conflicts.map((conflict) => conflict.id).join(", ")}; revision ${result.revision}\n`
      : `revision ${result.revision}\n`,
    ...(conflicted ? { exit: EXIT.conflict } : {}),
  };
}

/** `mostra state set <artifact> <id> <json>`. */
export const stateSetCommand: CommandDef = defineCommand({
  path: ["state", "set"],
  summary: "Set one field of an artifact's state; viewers see it at once.",
  args: [
    { name: "artifact", summary: "The artifact: its source path or its ID." },
    { name: "id", summary: "The field ID." },
    { name: "value", summary: "The value, as JSON." },
  ],
  flags: writeFlags,
  output: { type: "StatePatchResult", topic: "cli" },
  exits: [EXIT.failure, EXIT.conflict],
  example: `state set ./tasks priorities '["Ship the CLI"]'`,
  async run(context) {
    return patch(context, [
      { id: arg(context, "id"), value: parseJson(arg(context, "value"), "<value>") },
    ]);
  },
});

/** `mostra state patch <artifact>`. */
export const statePatchCommand: CommandDef = defineCommand({
  path: ["state", "patch"],
  summary:
    "Change several fields of an artifact's state in one revision: [{ id, value } | { id, delete: true }].",
  args: [{ name: "artifact", summary: "The artifact: its source path or its ID." }],
  flags: [
    { name: "ops", kind: "string", value: "<json>", summary: "The operations, as JSON." },
    {
      name: "file",
      kind: "string",
      value: "<path>",
      summary: "Read the operations from a JSON file.",
    },
    { name: "stdin", kind: "boolean", summary: "Read the operations from stdin." },
    ...writeFlags,
  ],
  output: { type: "StatePatchResult", topic: "cli" },
  exits: [EXIT.failure, EXIT.conflict],
  example: `state patch ./tasks --file ops.json`,
  readsStdin: (flags) => flags["stdin"] === true,
  async run(context) {
    const ops = await jsonInput(context, "ops");
    const parsed = FieldOp.array().safeParse(ops);
    if (!parsed.success || parsed.data.length === 0) {
      throw usage(
        "The operations must be a non-empty JSON array of { id, value } or { id, delete: true }.",
      );
    }
    return patch(context, parsed.data);
  },
});
