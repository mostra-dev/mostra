"use server";
import { dryRun } from "@mostra/server";

/** Opts into verify's smoke test; a comment's crop never runs it (WP-20's review, finding 2). */
export async function ping(): Promise<string> {
  if (dryRun()) return "dry";
  return "ran";
}
