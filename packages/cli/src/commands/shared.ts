/**
 * What commands share: naming artifacts and sources on the command line, and reading JSON values.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ArtifactRef, SourceRef } from "@mostra/protocol";
import type { CommandContext } from "../command.ts";
import { usage } from "../parse.ts";

const ARTIFACT_ID = /^art_[0-9A-HJKMNP-TV-Z]{26}$/;

/** An artifact named by its ID (`art_…`) or by a path, relative ones from `--cwd`. */
export function artifactRef(value: string, cwd: string): ArtifactRef {
  return ARTIFACT_ID.test(value) ? { artifactId: value } : { path: resolve(cwd, value) };
}

/** A source named the same way: a path, or the ID of an artifact (the path it was published from). */
export function sourceRef(value: string, cwd: string): SourceRef {
  return ARTIFACT_ID.test(value) ? { artifactId: value } : { path: resolve(cwd, value) };
}

/** A string argument the parser guaranteed. */
export function arg(context: CommandContext, name: string): string {
  const value = context.args[name];
  if (typeof value !== "string") throw usage(`<${name}> is missing.`);
  return value;
}

/** An optional string flag. */
export function flag(context: CommandContext, name: string): string | undefined {
  const value = context.flags[name];
  return typeof value === "string" ? value : undefined;
}

/** Parses a JSON value given on the command line, in a file or on stdin. */
export function parseJson(text: string, where: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw usage(`${where} isn't JSON: ${(error as Error).message}`);
  }
}

/** Reads a JSON value from `--value`, `--file` or `--stdin`, exactly one of them. */
export async function jsonInput(context: CommandContext, valueFlag = "value"): Promise<unknown> {
  const given = [valueFlag, "file", "stdin"].filter(
    (name) => context.flags[name] !== undefined && context.flags[name] !== false,
  );
  if (given.length !== 1) {
    throw usage(`Give the value with exactly one of --${valueFlag}, --file or --stdin.`);
  }
  if (context.flags["stdin"] === true) return parseJson(await context.readStdin(), "stdin");
  const file = flag(context, "file");
  if (file !== undefined) {
    let text: string;
    try {
      text = readFileSync(resolve(context.cwd, file), "utf8");
    } catch (error) {
      throw usage(
        `--file ${file} can't be read (${(error as NodeJS.ErrnoException).code ?? "error"}).`,
      );
    }
    return parseJson(text, file);
  }
  return parseJson(flag(context, valueFlag) ?? "", `--${valueFlag}`);
}

/** Indented JSON, for human output of structured results. */
export function pretty(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}
