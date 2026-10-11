"use server";
import { dryRun, progress } from "@mostra/server";

const ARCHIVE_SECRET_MARKER = "server-only-archive-implementation";

async function guarded(): Promise<boolean> {
  return dryRun();
}

/** Opts into verify's smoke test through a helper (D55). */
export async function archive(id: string): Promise<{ id: string; archived: boolean }> {
  if (await guarded()) return { id, archived: false };
  progress({ message: ARCHIVE_SECRET_MARKER });
  return { id, archived: true };
}

/** Doesn't opt in: verify never runs it. */
export const notify = async (message: string): Promise<string> => `sent ${message}`;

export type ArchiveResult = Awaited<ReturnType<typeof archive>>;
