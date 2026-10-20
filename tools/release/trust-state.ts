#!/usr/bin/env node
/**
 * Judges what `npm trust list <package> --json` printed (tools/release/npm-setup.sh): one of
 *
 * - `none`: no trusted publisher;
 * - `ours`: exactly this repository, workflow file and environment;
 * - `other <entries>`: anything else (npm allows one configuration per package);
 * - `unreadable <why>`: an error object (EOTP when npm wanted a one-time password it couldn't ask
 *   for), or text that isn't npm's JSON.
 *
 * Never a guess: only an empty answer is `none`. npm prints one JSON object per configuration,
 * one after another, or one error object.
 *
 *   npm trust list <package> --json | node tools/release/trust-state.ts <repo> <file> <env>
 */
import { readFileSync } from "node:fs";

/** What a trusted-publisher listing says about one package. */
export type TrustState =
  | { readonly kind: "none" }
  | { readonly kind: "ours" }
  | { readonly kind: "other"; readonly entries: readonly unknown[] }
  | { readonly kind: "unreadable"; readonly why: string };

/** What the release workflow presents to npm. */
export interface Publisher {
  readonly repository: string;
  readonly file: string;
  readonly environment: string;
}

/** Splits npm's output into the JSON values it holds, one after another. */
function values(text: string): unknown[] | undefined {
  const out: unknown[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === "{" || c === "[") {
      if (depth === 0) start = i;
      depth++;
    } else if (c === "}" || c === "]") {
      depth--;
      if (depth < 0) return undefined;
      if (depth === 0) {
        try {
          out.push(JSON.parse(text.slice(start, i + 1)));
        } catch {
          return undefined;
        }
      }
    } else if (depth === 0 && !/\s/.test(c as string)) return undefined;
  }
  return depth === 0 && !inString ? out : undefined;
}

/** Judges `npm trust list --json` output against the publisher the workflow presents. */
export function judge(text: string, publisher: Publisher): TrustState {
  const parsed = values(text.trim());
  if (parsed === undefined)
    return { kind: "unreadable", why: "npm printed something that is not JSON" };
  const entries = parsed.flat();
  if (entries.length === 0) return { kind: "none" };
  for (const entry of entries) {
    const error = (entry as { error?: { code?: unknown; summary?: unknown } } | null)?.error;
    if (error)
      return {
        kind: "unreadable",
        why: `${String(error.code ?? "error")}: ${String(error.summary ?? "")}`.trim(),
      };
  }
  const ours = entries.every((entry) => {
    const e = entry as Record<string, unknown>;
    return (
      e["type"] === "github" &&
      e["repository"] === publisher.repository &&
      e["file"] === publisher.file &&
      e["environment"] === publisher.environment
    );
  });
  return ours ? { kind: "ours" } : { kind: "other", entries };
}

/** The one line npm-setup.sh reads. */
export function line(state: TrustState): string {
  switch (state.kind) {
    case "none":
    case "ours":
      return state.kind;
    case "other":
      return `other ${JSON.stringify(state.entries)}`;
    case "unreadable":
      return `unreadable ${state.why}`;
  }
}

if (import.meta.main) {
  const [repository, file, environment] = process.argv.slice(2);
  if (!repository || !file || !environment) {
    console.error("usage: trust-state.ts <repo> <file> <env> < npm-output");
    process.exit(2);
  }
  console.log(line(judge(readFileSync(0, "utf8"), { repository, file, environment })));
}
