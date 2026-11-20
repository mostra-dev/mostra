/**
 * A hosted home's MCP Apps (D175 item 8): each version's page, which a chat host reads through the
 * remote MCP server (`app/page`). The hosted home makes each page itself, with the exporter Mostra
 * carries, from the version's own client files: the files it holds and its operator reviews
 * (D165 item 9). It never keeps a page anyone sent it, so what a chat host shows is always made
 * from a published version, owner online or not (review findings R01-2, R01-9, R02-17).
 *
 * A page is derived from its version and never canonical: it is kept beside the home's ledger as
 * one file (`pages/<versionId>.json`, the page and its metadata), written aside under a random name
 * and renamed into place, so it is there whole or not at all (R02-18); the first one made is kept,
 * and a lost one is only made again. A version under review, or removed, gets no page, also from a
 * making that was already under way when it was quarantined or removed (R01-8).
 */
import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type AppPageResult,
  createDiagnostic,
  McpAppResourceMeta,
  mcpAppUri,
  RpcError,
} from "@mostra/protocol";
import type { Log } from "../log.ts";

/** What the pages need of their hosted home. */
export interface AppPagesOptions {
  readonly dir: string;
  readonly log: Log;
  /** The artifact a version of this home belongs to, or `undefined`. */
  readonly artifactOf: (versionId: string) => string | undefined;
  /** Whether the operator quarantined the artifact or this version (D165 item 9). */
  readonly underReview: (artifactId: string, versionId: string) => boolean;
  /** Makes a version's page from its own files (the bundled exporter, in a child). */
  readonly make: (artifactId: string, versionId: string) => Promise<AppPageResult>;
}

/** A hosted home's pages. */
export interface AppPages {
  /** A version's page: kept, or made now. */
  page(versionId: string): Promise<AppPageResult>;
  /** Removes a removed version's page; a making under way for it keeps nothing. */
  forget(versionId: string): Promise<void>;
}

function refuse(
  code: "MOSTRA_ARTIFACT_VERSION_NOT_FOUND" | "MOSTRA_REMOTE_UNDER_REVIEW",
  message: string,
): RpcError {
  return new RpcError(createDiagnostic(code, { message }));
}

/** What one kept page's file holds. */
interface KeptPage {
  readonly html: string;
  readonly meta: McpAppResourceMeta;
}

/** Creates a hosted home's pages. */
export function createAppPages(options: AppPagesOptions): AppPages {
  const dir = join(options.dir, "pages");
  const making = new Map<string, Promise<AppPageResult>>();
  // Each removal of a version moves its generation on: a making started before it keeps nothing,
  // and a version shared again later is made afresh.
  const generations = new Map<string, number>();
  const generationOf = (versionId: string): number => generations.get(versionId) ?? 0;

  const fileOf = (versionId: string): string => join(dir, `${versionId}.json`);

  /** The version's artifact, and that no review holds it, or a refusal. */
  const shown = (versionId: string): string => {
    const artifactId = options.artifactOf(versionId);
    if (artifactId === undefined) {
      throw refuse("MOSTRA_ARTIFACT_VERSION_NOT_FOUND", `This home has no version ${versionId}.`);
    }
    // A quarantined page shows nowhere, inline neither (D165 item 9).
    if (options.underReview(artifactId, versionId)) {
      throw refuse(
        "MOSTRA_REMOTE_UNDER_REVIEW",
        "This page is under review by the server's operator.",
      );
    }
    return artifactId;
  };

  const kept = async (versionId: string): Promise<KeptPage | undefined> => {
    try {
      const text = JSON.parse(await readFile(fileOf(versionId), "utf8")) as {
        html?: unknown;
        meta?: unknown;
      };
      const meta = McpAppResourceMeta.safeParse(text.meta);
      if (typeof text.html !== "string" || !meta.success) return undefined;
      return { html: text.html, meta: meta.data };
    } catch {
      return undefined;
    }
  };

  /** Keeps a page as one file, written aside and renamed, unless one is kept already. */
  const keep = async (versionId: string, page: KeptPage, generation: number): Promise<void> => {
    if ((await kept(versionId)) !== undefined) return;
    mkdirSync(dir, { recursive: true });
    const aside = `${fileOf(versionId)}.${randomBytes(8).toString("hex")}.tmp`;
    try {
      await writeFile(aside, JSON.stringify(page), { mode: 0o600 });
      // A removal while it was written: nothing is renamed into place.
      if (generationOf(versionId) !== generation) return;
      await rename(aside, fileOf(versionId));
    } finally {
      await rm(aside, { force: true });
    }
  };

  return {
    async page(versionId) {
      const artifactId = shown(versionId);
      const found = await kept(versionId);
      if (found !== undefined) {
        return { artifactId, uri: mcpAppUri(versionId), html: found.html, meta: found.meta };
      }
      const already = making.get(versionId);
      if (already !== undefined) return already;
      const generation = generationOf(versionId);
      const made = (async (): Promise<AppPageResult> => {
        const page = await options.make(artifactId, versionId);
        // Judged again with the page made: a version quarantined or removed meanwhile shows
        // nothing, and keeps nothing (R01-8).
        if (generationOf(versionId) !== generation) {
          throw refuse(
            "MOSTRA_ARTIFACT_VERSION_NOT_FOUND",
            `This home has no version ${versionId}.`,
          );
        }
        shown(versionId);
        await keep(versionId, { html: page.html, meta: page.meta }, generation).catch(
          (error: unknown) => options.log.warn("server.page_unkept", { versionId, error }),
        );
        options.log.info("server.page_made", { versionId, artifactId });
        return { artifactId, uri: mcpAppUri(versionId), html: page.html, meta: page.meta };
      })().finally(() => {
        if (making.get(versionId) === made) making.delete(versionId);
      });
      making.set(versionId, made);
      return made;
    },

    async forget(versionId) {
      generations.set(versionId, generationOf(versionId) + 1);
      making.delete(versionId);
      await rm(fileOf(versionId), { force: true });
    },
  };
}
