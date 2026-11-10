/**
 * The remote MCP server (INTERFACES §18.8, MC-04, D165 items 5, 10): `@mostra/mcp`'s tools over
 * Streamable HTTP at `<apiOrigin>/mcp`, statelessly, behind the authorization server. Each request
 * is built for the account its token names:
 *
 * - **the instance** reads and writes the account's hosted home through a protocol session of its
 *   own in this process, as any host would (invariant 11); authoring (`artifact/create`, `verify`,
 *   `publish`) goes to the account's default owner instance through `port/relay.author`, and
 *   answers `MOSTRA_REMOTE_NO_INSTANCE` while none is connected;
 * - **the workspace** is the default owner instance's own, reached the same way;
 * - **the docs** are the reference this build carries. There is no browser.
 *
 * Each call is counted (`mcp.calls`, with the client's `clientInfo` name, D148) and asked of the
 * operator's `limits` (`mcp.call`) first; a refusal answers the operator's code.
 */
import { existsSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import {
  createAuthorizedEndpoint,
  fileDocs,
  type McpAuthorization,
  type McpDocs,
  type McpInstance,
  type McpWorkspace,
  type WorkspaceFile,
} from "@mostra/mcp";
import {
  type ArtifactRef,
  createDiagnostic,
  type MethodDefinition,
  type PortRelayAuthorParams,
  portRelayAuthorMethod,
  type RelayAuthorMethod,
  RpcError,
  viewDefaultMethod,
} from "@mostra/protocol";
import type { Log } from "../log.ts";
import { runtimeRoot } from "../platform/index.ts";
import { attachInProcess, type SocketClient } from "../protocol-server/index.ts";
import type { Authenticated } from "./auth.ts";
import type { HostedHome } from "./hosted.ts";
import type { Meter } from "./metering.ts";
import type { Operator } from "./operator.ts";

/** How long a relayed authoring step may take: verify and publish can take minutes. */
const AUTHOR_TIMEOUT_MS = 10 * 60_000;
/** How long a workspace step may take. */
const WORKSPACE_TIMEOUT_MS = 30_000;
/** How long a relayed publish waits for its version to arrive here before answering its link. */
const PUSH_WAIT_MS = 120_000;
/** The largest request body read. */
const MAX_BODY_BYTES = 16 * 1024 * 1024;

/** The methods that run on the owner instance, never on the hosted home. */
const AUTHORING = new Set<string>(["artifact/create", "artifact/verify", "artifact/publish"]);

/** What the endpoint needs of the server. */
export interface RemoteMcpOptions {
  readonly apiOrigin: string;
  readonly version: string;
  readonly docs: McpDocs;
  readonly log: Log;
  readonly operator: Operator;
  readonly meter: Meter | undefined;
  /** The account's hosted home, opened on demand. */
  readonly home: (homeId: string) => Promise<HostedHome>;
  /** The account's hosted home, made when it has none yet (an account that signed in only here). */
  readonly ensureHome: (accountId: string) => string;
}

/** The remote MCP endpoint. */
export interface RemoteMcp {
  /** Serves `/mcp` for a request whose token names `who`, for the resource `/mcp`. */
  handle(request: IncomingMessage, response: ServerResponse, who: Authenticated): Promise<void>;
  close(): Promise<void>;
}

function noInstance(): RpcError {
  return new RpcError(
    createDiagnostic("MOSTRA_REMOTE_NO_INSTANCE", {
      message:
        "No Mostra instance of this account is connected to the server, and building and verifying run there. Start Mostra on the linked machine (mostra daemon start), or link one with mostra login <server> --default.",
    }),
  );
}

/**
 * The reference this runtime carries: its build's copy (`dist/reference`, `dist/skill`), or the
 * repository's when it runs from source.
 */
export function serverDocs(): McpDocs {
  const root = runtimeRoot();
  const built = join(root, "dist", "reference");
  return existsSync(built)
    ? fileDocs({ referenceDir: built, skillDir: join(root, "dist", "skill") })
    : fileDocs({
        referenceDir: join(root, "..", "..", "docs", "reference"),
        skillDir: join(root, "..", "..", "skills", "mostra"),
      });
}

/** Builds the endpoint. */
export function createRemoteMcp(options: RemoteMcpOptions): RemoteMcp {
  const { log } = options;

  /** The default owner instance's session on a home: the account's chat-host authoring goes there. */
  const authorOn = (home: HostedHome) => {
    const call = async (method: RelayAuthorMethod, params: unknown, timeoutMs: number) => {
      const session = home.defaultOwnerSession();
      if (session === undefined) throw noInstance();
      const answer = await home.protocol.callSession(
        session,
        portRelayAuthorMethod.method,
        { method, params } satisfies PortRelayAuthorParams,
        timeoutMs,
      );
      return answer as unknown;
    };
    return call;
  };

  const endpoint = createAuthorizedEndpoint(
    (authorization: McpAuthorization) => {
      const subject = authorization.subject as {
        readonly home: HostedHome;
        readonly client: SocketClient;
        readonly account: string;
        readonly root: string;
      };
      const author = authorOn(subject.home);
      // A directory names an artifact on the owner's machine: the owner says which it is.
      const resolveRef = async (ref: ArtifactRef): Promise<ArtifactRef> => {
        if (!("path" in ref)) return ref;
        const found = (await author("artifact/get", { artifact: ref }, WORKSPACE_TIMEOUT_MS)) as {
          id: string;
        };
        return { artifactId: found.id };
      };
      const instance: McpInstance = {
        async call<P, R>(method: MethodDefinition<P, R>, params: P): Promise<R> {
          if (method.method === "artifact/publish") {
            // Published and hosted on the owner; the answer's link is the hosted default link,
            // once the version has arrived here (D165 item 5).
            const receipt = (await author("artifact/publish", params, AUTHOR_TIMEOUT_MS)) as {
              artifactId: string;
              versionId: string;
            };
            const until = Date.now() + PUSH_WAIT_MS;
            while (!subject.home.registry.hasVersion(receipt.versionId) && Date.now() < until) {
              await new Promise((resolve) => setTimeout(resolve, 100));
            }
            const link = await subject.client.peer.call(viewDefaultMethod, {
              artifact: { artifactId: receipt.artifactId },
            });
            return { ...receipt, url: link.url, tokenId: link.tokenId } as R;
          }
          if (AUTHORING.has(method.method)) {
            return (await author(
              method.method as RelayAuthorMethod,
              params,
              AUTHOR_TIMEOUT_MS,
            )) as R;
          }
          const value = params as { artifact?: ArtifactRef };
          const sent =
            value.artifact !== undefined
              ? ({ ...value, artifact: await resolveRef(value.artifact) } as P)
              : params;
          return (await subject.client.peer.call(method, sent)) as R;
        },
        // Progress of a relayed verify isn't streamed back; the verdict arrives whole.
        onProgress: () => () => undefined,
      };
      const workspace: McpWorkspace = {
        // The owner's workspace root, as the owner said it (its paths are the owner's).
        root: subject.root,
        // The owner resolves and checks every path itself: a relative one inside its workspace.
        resolveDir: (dir) => dir,
        allocateDir: async (title) =>
          (await author("workspace/allocate", { title }, WORKSPACE_TIMEOUT_MS)) as string,
        async read(dir, path) {
          const answer = (await author("workspace/read", { dir, path }, WORKSPACE_TIMEOUT_MS)) as {
            content?: string;
          };
          return answer.content === undefined ? undefined : Buffer.from(answer.content, "base64");
        },
        async apply(dir, changes) {
          return (await author(
            "workspace/apply",
            {
              dir,
              write: changes.write.map((file: WorkspaceFile) => ({
                path: file.path,
                content: Buffer.from(file.content).toString("base64"),
              })),
              delete: changes.delete,
            },
            WORKSPACE_TIMEOUT_MS,
          )) as { written: string[]; deleted: string[] };
        },
      };
      return {
        instance,
        workspace,
        docs: options.docs,
        version: options.version,
        readScreenshot: async (path) => {
          const answer = (await author("verify/screenshot", { path }, WORKSPACE_TIMEOUT_MS)) as {
            png?: string;
          };
          if (answer.png === undefined) {
            throw new RpcError(
              createDiagnostic("MOSTRA_ARTIFACT_PATH_INVALID", {
                message: "That screenshot isn't one of the owner instance's verify runs.",
              }),
            );
          }
          return Buffer.from(answer.png, "base64");
        },
        onClient: (client) => {
          options.meter?.add("mcp.calls", {
            account: subject.account,
            home: subject.home.id,
            dimensions: { client: client.name.slice(0, 64) },
          });
        },
      };
    },
    { onError: (error) => log.warn("mcp.error", { message: error.message }) },
  );

  return {
    async handle(request, response, who) {
      const homeId = who.homeId !== "" ? who.homeId : options.ensureHome(who.accountId);
      const verdict = await options.operator.limit({
        account: who.accountId,
        home: homeId,
        operation: "mcp.call",
      });
      if (verdict.allowed === false || verdict.allowed === "unavailable") {
        const diagnostic =
          verdict.allowed === false
            ? createDiagnostic("MOSTRA_REMOTE_LIMIT_REACHED", { message: verdict.message })
            : createDiagnostic("MOSTRA_REMOTE_OPERATOR_UNAVAILABLE", {
                message: "The server's operator didn't answer in time; try again shortly.",
              });
        const text = JSON.stringify({
          jsonrpc: "2.0",
          id: null,
          error: { code: -32000, message: diagnostic.message, data: diagnostic },
        });
        response.writeHead(verdict.allowed === false ? 403 : 503, {
          "content-type": "application/json",
          "cache-control": "no-store",
          ...(verdict.allowed === false && verdict.retryAfterMs !== undefined
            ? { "retry-after": String(Math.ceil(verdict.retryAfterMs / 1000)) }
            : {}),
        });
        response.end(text);
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of request) {
        size += (chunk as Buffer).length;
        if (size > MAX_BODY_BYTES) {
          response.writeHead(413, { "content-type": "application/json" });
          response.end(
            JSON.stringify({
              jsonrpc: "2.0",
              id: null,
              error: { code: -32600, message: "The request is too large." },
            }),
          );
          return;
        }
        chunks.push(chunk as Buffer);
      }
      const headers = new Headers();
      for (const [name, value] of Object.entries(request.headers)) {
        if (value === undefined || name === "host" || name === "cookie") continue;
        headers.set(name, Array.isArray(value) ? value.join(", ") : value);
      }
      const web = new Request(`${options.apiOrigin}${request.url ?? "/mcp"}`, {
        method: request.method ?? "POST",
        headers,
        ...(request.method === "POST" ? { body: Buffer.concat(chunks) } : {}),
      });
      const home = await options.home(homeId);
      // The owner's workspace root, when an owner instance is connected to say it.
      let root = "the workspace of this account's Mostra instance";
      if (home.defaultOwnerSession() !== undefined) {
        const found = await authorOn(home)("workspace/root", {}, WORKSPACE_TIMEOUT_MS).catch(
          () => undefined,
        );
        if (typeof found === "string") root = found;
      }
      const { client } = await attachInProcess(
        home.protocol,
        { name: "mostra-remote-mcp", version: options.version },
        { accountId: who.accountId, grantId: who.grantId, homeId, linkId: undefined },
      );
      try {
        const answer = await endpoint.fetch(web, {
          token: "",
          clientId: who.clientId,
          scopes: ["mostra"],
          expiresAt: Math.floor(who.expiresAt / 1000),
          resource: `${options.apiOrigin}/mcp`,
          subject: { home, client, account: who.accountId, root },
        });
        const out: Record<string, string> = {};
        answer.headers.forEach((value, name) => {
          out[name] = value;
        });
        response.writeHead(answer.status, out);
        if (answer.body) {
          for await (const chunk of answer.body as unknown as AsyncIterable<Uint8Array>) {
            response.write(chunk);
          }
        }
        response.end();
      } finally {
        client.close();
      }
    },
    close: () => endpoint.close(),
  };
}
