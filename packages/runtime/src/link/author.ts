/**
 * Authoring from a chat host, on the owner instance (INTERFACES §18.8, D165 item 5): the remote MCP
 * server relays `artifact/create`, `verify` and `publish`, and the workspace's files, to the
 * account's default owner instance as `port/relay.author`, and this module runs each here, on this
 * home's own protocol server, in an in-process session as any host would (invariant 11).
 *
 * The relay is a way in from outside this machine, so every directory it names stays inside this
 * home's MCP workspace (`MOSTRA_MCP_WORKSPACE`, default `~/mostra-artifacts`, as `mostra mcp`'s):
 * a relative one resolves there, an absolute one must already be there, and anything else is
 * `MOSTRA_ARTIFACT_PATH_INVALID`. A screenshot is read only from verify's own cache. A publish also
 * hosts the version on the server that asked and answers its hosted link.
 */
import { realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { defaultWorkspaceRoot, localWorkspace } from "@mostra/mcp";
import {
  artifactCreateMethod,
  artifactGetMethod,
  artifactPublishMethod,
  artifactVerifyMethod,
  createDiagnostic,
  portRelayAuthorMethod,
  RpcError,
  shareStartMethod,
} from "@mostra/protocol";
import type { Environment, Log } from "../log.ts";
import { attachInProcess, type ProtocolServer } from "../protocol-server/index.ts";

/** What the owner's authoring needs. */
export interface OwnerAuthorOptions {
  readonly home: string;
  readonly env: Environment;
  readonly log: Log;
  readonly runtimeVersion: string;
  /** This home's protocol server, once it exists. */
  readonly protocol: () => ProtocolServer | undefined;
  /** The servers an artifact is hosted on now. */
  readonly hostedOn: (artifactId: string) => readonly string[];
}

/** Answers `port/relay.author` from the server `server`. */
export type OwnerAuthor = (server: string, params: unknown) => Promise<unknown>;

function outside(message: string): RpcError {
  return new RpcError(createDiagnostic("MOSTRA_ARTIFACT_PATH_INVALID", { message }));
}

/** Whether `inner` is `outer` or inside it. */
function within(outer: string, inner: string): boolean {
  const between = relative(outer, inner);
  return between === "" || (!between.startsWith("..") && !isAbsolute(between));
}

/** Creates the owner's answer to relayed authoring. */
export function createOwnerAuthor(options: OwnerAuthorOptions): OwnerAuthor {
  const configured = options.env["MOSTRA_MCP_WORKSPACE"];
  const root = resolve(
    configured !== undefined && configured !== "" ? configured : defaultWorkspaceRoot(),
  );
  const workspace = localWorkspace(root);
  const verifyCache = join(options.home, "cache", "verify");

  /** A directory the relay names, inside the workspace or refused. */
  const dirOf = (dir: unknown): string => {
    if (typeof dir !== "string" || dir === "") throw outside("Name an artifact's directory.");
    const absolute = isAbsolute(dir) ? resolve(dir) : workspace.resolveDir(dir);
    let real = absolute;
    try {
      real = realpathSync.native(absolute);
    } catch {
      // A directory not made yet is judged by its name.
    }
    let base = root;
    try {
      base = realpathSync.native(root);
    } catch {
      // The workspace not made yet: no real path to compare against beyond its name.
    }
    if (!within(root, absolute) || !within(base, real)) {
      throw outside(
        `A chat host's authoring stays inside this machine's Mostra workspace (${root}); ${dir} is outside it.`,
      );
    }
    return absolute;
  };

  /** One call on this home's protocol server, in a session of its own. */
  const local = async <P, R>(
    method: { readonly method: string } & Parameters<
      Awaited<ReturnType<typeof attachInProcess>>["client"]["peer"]["call"]
    >[0],
    params: P,
  ): Promise<R> => {
    const protocol = options.protocol();
    if (protocol === undefined) {
      throw new RpcError(
        createDiagnostic("MOSTRA_REMOTE_NO_INSTANCE", {
          message: "This Mostra instance is still starting; try again in a moment.",
        }),
      );
    }
    const { client } = await attachInProcess(protocol, {
      name: "mostra-remote-author",
      version: options.runtimeVersion,
    });
    try {
      return (await client.peer.call(method, params as never)) as R;
    } finally {
      client.close();
    }
  };

  return async (server, raw) => {
    const { method, params } = portRelayAuthorMethod.params.parse(raw);
    const given = (params ?? {}) as Record<string, unknown>;
    options.log.info("link.author", { server, method });
    switch (method) {
      case "workspace/root":
        return root;
      case "workspace/allocate":
        return workspace.allocateDir(
          typeof given["title"] === "string" ? given["title"] : undefined,
        );
      case "workspace/read": {
        const content = await workspace.read(dirOf(given["dir"]), String(given["path"] ?? ""));
        return content === undefined ? {} : { content: Buffer.from(content).toString("base64") };
      }
      case "workspace/apply": {
        const write = Array.isArray(given["write"]) ? given["write"] : [];
        const deletes = Array.isArray(given["delete"]) ? given["delete"] : [];
        return workspace.apply(dirOf(given["dir"]), {
          write: write.map((file) => {
            const entry = file as { path?: unknown; content?: unknown };
            return {
              path: String(entry.path ?? ""),
              content: Buffer.from(String(entry.content ?? ""), "base64"),
            };
          }),
          delete: deletes.map(String),
        });
      }
      case "verify/screenshot": {
        const path = resolve(String(given["path"] ?? ""));
        if (!within(verifyCache, path)) return {};
        try {
          return { png: (await readFile(path)).toString("base64") };
        } catch {
          return {};
        }
      }
      case "artifact/create":
        return local(artifactCreateMethod, { ...given, dir: dirOf(given["dir"]) });
      case "artifact/get": {
        const artifact = given["artifact"] as { path?: unknown; artifactId?: unknown } | undefined;
        return local(artifactGetMethod, {
          artifact:
            artifact?.path !== undefined
              ? { path: dirOf(artifact.path) }
              : { artifactId: String(artifact?.artifactId ?? "") },
        });
      }
      case "artifact/verify": {
        const source = given["source"] as { path?: unknown } | undefined;
        return local(artifactVerifyMethod, { ...given, source: { path: dirOf(source?.path) } });
      }
      case "artifact/publish": {
        const source = given["source"] as { path?: unknown } | undefined;
        const receipt = await local<object, { artifactId: string; url?: string; tokenId?: string }>(
          artifactPublishMethod,
          { ...given, source: { path: dirOf(source?.path) } },
        );
        // A publish from a chat host also hosts the version on the server it came through
        // (D165 item 5): a first share there pushes it; once hosted, every publish is pushed.
        if (!options.hostedOn(receipt.artifactId).includes(server)) {
          await local(shareStartMethod, {
            artifact: { artifactId: receipt.artifactId },
            via: "remote",
            server,
          });
        }
        return receipt;
      }
      default:
        throw outside(`The relay serves no authoring method ${method as string}.`);
    }
  };
}
