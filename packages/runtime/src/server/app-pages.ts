/**
 * A hosted home's MCP Apps (D175 item 8): each version's page, which a chat host reads through the
 * remote MCP server (`app/page`). The hosted home runs no plugin code, so it never makes one: the
 * version's owner instance sends it after the version's push (`hosted/page`), and a page asked
 * for before it arrived is asked of the connected owner (`port/relay.author`, `app/page`) and
 * kept. With the owner away and no page kept, the answer is `MOSTRA_REMOTE_OWNER_OFFLINE`, and the
 * loader offers the hosted link instead.
 *
 * A page is derived from its version, never canonical, so it is kept beside the home's ledger as a
 * file (`pages/<versionId>.html` and `.json`), written aside and renamed, and a lost one is only
 * asked for again.
 */
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  APP_PAGE_MAX_CHARS,
  type AppPageResult,
  createDiagnostic,
  type HostedPageParams,
  type HostedPageResult,
  type JsonRpcParams,
  McpAppResourceMeta,
  mcpAppUri,
  type PortRelayAuthorParams,
  portRelayAuthorMethod,
  RpcError,
} from "@mostra/protocol";
import type { Log } from "../log.ts";

/** How long the owner may take to make a page it was asked for. */
const OWNER_PAGE_TIMEOUT_MS = 120_000;

/** What the pages need of their hosted home. */
export interface AppPagesOptions {
  readonly dir: string;
  readonly log: Log;
  /** The artifact a version of this home belongs to, or `undefined`. */
  readonly artifactOf: (versionId: string) => string | undefined;
  /** The owner link of a hosted artifact. */
  readonly ownerOf: (artifactId: string) => string | undefined;
  /** Whether the operator quarantined the artifact or this version (D165 item 9). */
  readonly underReview: (artifactId: string, versionId: string) => boolean;
  /** The binding session of a link, while it is connected. */
  readonly sessionOf: (linkId: string) => number | undefined;
  readonly call: (
    session: number,
    method: string,
    params: JsonRpcParams,
    timeoutMs: number,
  ) => Promise<unknown>;
}

/** A hosted home's pages. */
export interface AppPages {
  /** Keeps a page an owner sent, for one of its own artifacts' versions. */
  keep(params: HostedPageParams, link: string): Promise<HostedPageResult>;
  /** A version's page: kept, or asked of the owner. */
  page(versionId: string): Promise<AppPageResult>;
}

function refuse(
  code:
    | "MOSTRA_REMOTE_NOT_OWNER_INSTANCE"
    | "MOSTRA_ARTIFACT_VERSION_NOT_FOUND"
    | "MOSTRA_REMOTE_OWNER_OFFLINE"
    | "MOSTRA_REMOTE_UNDER_REVIEW"
    | "MOSTRA_HOME_INTEGRITY",
  message: string,
): RpcError {
  return new RpcError(createDiagnostic(code, { message }));
}

/** Creates a hosted home's pages. */
export function createAppPages(options: AppPagesOptions): AppPages {
  const dir = join(options.dir, "pages");
  const asking = new Map<string, Promise<AppPageResult>>();

  const fileOf = (versionId: string, extension: "html" | "json"): string =>
    join(dir, `${versionId}.${extension}`);

  /** The version's artifact, or a refusal naming none. */
  const ownedVersion = (versionId: string): string => {
    const artifactId = options.artifactOf(versionId);
    if (artifactId === undefined) {
      throw refuse("MOSTRA_ARTIFACT_VERSION_NOT_FOUND", `This home has no version ${versionId}.`);
    }
    return artifactId;
  };

  const store = async (
    versionId: string,
    html: string,
    meta: McpAppResourceMeta,
  ): Promise<void> => {
    mkdirSync(dir, { recursive: true });
    const suffix = `.${process.pid}.${Date.now()}.tmp`;
    // The metadata first, then the page: a page is read only with its metadata beside it.
    await writeFile(`${fileOf(versionId, "json")}${suffix}`, JSON.stringify(meta), { mode: 0o600 });
    await rename(`${fileOf(versionId, "json")}${suffix}`, fileOf(versionId, "json"));
    await writeFile(`${fileOf(versionId, "html")}${suffix}`, html, { mode: 0o600 });
    await rename(`${fileOf(versionId, "html")}${suffix}`, fileOf(versionId, "html"));
  };

  const kept = async (
    versionId: string,
    artifactId: string,
  ): Promise<AppPageResult | undefined> => {
    try {
      const html = await readFile(fileOf(versionId, "html"), "utf8");
      const meta = McpAppResourceMeta.parse(
        JSON.parse(await readFile(fileOf(versionId, "json"), "utf8")),
      );
      return { artifactId, uri: mcpAppUri(versionId), html, meta };
    } catch {
      return undefined;
    }
  };

  const checked = (html: unknown, meta: unknown): { html: string; meta: McpAppResourceMeta } => {
    const parsedMeta = McpAppResourceMeta.safeParse(meta);
    if (
      typeof html !== "string" ||
      html.length > APP_PAGE_MAX_CHARS ||
      !/^<!doctype html>/i.test(html) ||
      !parsedMeta.success
    ) {
      throw refuse("MOSTRA_HOME_INTEGRITY", "The owner's page isn't an MCP App this home keeps.");
    }
    return { html, meta: parsedMeta.data };
  };

  return {
    async keep(params, link) {
      const artifactId = ownedVersion(params.versionId);
      if (options.ownerOf(artifactId) !== link) {
        throw refuse(
          "MOSTRA_REMOTE_NOT_OWNER_INSTANCE",
          "Only the artifact's owner instance sends its pages.",
        );
      }
      const page = checked(params.html, params.meta);
      await store(params.versionId, page.html, page.meta);
      options.log.info("server.page_kept", { versionId: params.versionId, artifactId });
      return { sha256: createHash("sha256").update(page.html).digest("hex") };
    },

    async page(versionId) {
      const artifactId = ownedVersion(versionId);
      // A quarantined page shows nowhere, inline neither (D165 item 9).
      if (options.underReview(artifactId, versionId)) {
        throw refuse(
          "MOSTRA_REMOTE_UNDER_REVIEW",
          "This page is under review by the server's operator.",
        );
      }
      const found = await kept(versionId, artifactId);
      if (found !== undefined) return found;
      const already = asking.get(versionId);
      if (already !== undefined) return already;
      const asked = (async (): Promise<AppPageResult> => {
        const owner = options.ownerOf(artifactId);
        const session = owner === undefined ? undefined : options.sessionOf(owner);
        if (session === undefined) {
          throw refuse(
            "MOSTRA_REMOTE_OWNER_OFFLINE",
            "This page's owner instance is offline, and its inline page isn't here yet: open its link instead.",
          );
        }
        const answer = (await options.call(
          session,
          portRelayAuthorMethod.method,
          { method: "app/page", params: { versionId } } satisfies PortRelayAuthorParams,
          OWNER_PAGE_TIMEOUT_MS,
        )) as { artifactId?: unknown; html?: unknown; meta?: unknown };
        if (answer.artifactId !== artifactId) {
          throw refuse("MOSTRA_HOME_INTEGRITY", "The owner answered another artifact's page.");
        }
        const page = checked(answer.html, answer.meta);
        await store(versionId, page.html, page.meta).catch((error: unknown) =>
          options.log.warn("server.page_unkept", { versionId, error }),
        );
        return { artifactId, uri: mcpAppUri(versionId), html: page.html, meta: page.meta };
      })().finally(() => asking.delete(versionId));
      asking.set(versionId, asked);
      return asked;
    },
  };
}

/** Removes a removed version's page (its artifact's removal, `remove`). */
export async function removeAppPage(homeDir: string, versionId: string): Promise<void> {
  for (const extension of ["html", "json"]) {
    await rm(join(homeDir, "pages", `${versionId}.${extension}`), { force: true });
  }
}
