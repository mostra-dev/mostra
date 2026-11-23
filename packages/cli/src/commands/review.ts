/**
 * `mostra review export` (RV-05, WP-20): an artifact's review for an agent, its choices and comment
 * threads with every anchor layer and each crop's path, as Markdown or JSON.
 */
import { resolve } from "node:path";
import { reviewExportMethod } from "@mostra/protocol";
import { type CommandDef, defineCommand } from "../command.ts";
import { EXIT } from "../exit.ts";
import { arg, artifactRef, flag, pretty } from "./shared.ts";

/** `mostra review export <artifact>`. */
export const reviewExportCommand: CommandDef = defineCommand({
  path: ["review", "export"],
  summary:
    "Print an artifact's review: its choices and comment threads, each with where it points and the path of its crop.",
  args: [{ name: "artifact", summary: "The artifact: its source path or its ID." }],
  flags: [
    {
      name: "submission",
      kind: "string",
      value: "<id>",
      summary: "The review a submission carried instead of the threads as they stand now.",
    },
    {
      name: "format",
      kind: "string",
      value: "<format>",
      choices: ["md", "json"],
      summary: "Markdown or JSON. Default: Markdown, or JSON with --json.",
    },
    {
      name: "out",
      kind: "string",
      value: "<dir>",
      summary: "Write review.md or review.json into this directory, with each crop in crops/.",
    },
  ],
  output: { type: "ReviewExportResult", topic: "cli" },
  exits: [EXIT.failure],
  example: "review export ./sidebar-review --out ./review",
  async run(context) {
    const format = (flag(context, "format") ?? (context.json ? "json" : "md")) as "md" | "json";
    const submission = flag(context, "submission");
    const out = flag(context, "out");
    const result = await context.call(reviewExportMethod, {
      artifact: artifactRef(arg(context, "artifact"), context.cwd),
      format,
      ...(submission !== undefined ? { submission } : {}),
      ...(out !== undefined ? { out: resolve(context.cwd, out) } : {}),
    });
    const human =
      result.path !== undefined
        ? `Wrote ${result.path}: ${String(result.threads)} ${result.threads === 1 ? "thread" : "threads"}, ${String(result.crops)} ${result.crops === 1 ? "crop" : "crops"}.\n`
        : format === "json"
          ? pretty(JSON.parse(result.content ?? "{}"))
          : `${(result.content ?? "").trimEnd()}\n`;
    return { result, human };
  },
});
