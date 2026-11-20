/**
 * How a page renders in each chat host (D160, D175 item 8): through the MCP Apps resource
 * (`app`) or as the hosted link alone (`link`). The operator's `policy.chatHost` answers first,
 * then the configuration's `chatHosts`, by the host a client's redirect URIs name, else `app`.
 *
 * `chatHosts` stays as open as the release before it read it (D32, review finding Fable 10): an
 * entry whose key isn't a host name, or whose value isn't a policy, is left out and logged once at
 * start, never a reason to stop. Answers are kept for a minute per client, since an open page asks
 * on every save and long poll (Fable 11, Opus 13); a client whose metadata can't be read now keeps
 * its last answer, rather than the default.
 */
import {
  type ChatHostPolicy,
  ChatHostPolicy as ChatHostPolicySchema,
} from "@mostra/protocol/operator";
import type { Log } from "../log.ts";

/** How a chat host shows a page. */
export type Render = "app" | "link";

/** A host name as a policy key: lower-case letters, digits, dots and hyphens. */
const HOST_KEY = /^[a-z0-9.-]{1,253}$/;

/** How long one client's answer is kept. */
export const RENDER_KEPT_MS = 60_000;

/** The configured policies by host name, each entry it can't use logged and left out. */
export function chatHostPolicies(
  entries: Readonly<Record<string, unknown>> | undefined,
  log: Log,
): ReadonlyMap<string, ChatHostPolicy> {
  const policies = new Map<string, ChatHostPolicy>();
  for (const [key, value] of Object.entries(entries ?? {})) {
    const host = key.toLowerCase();
    if (!HOST_KEY.test(host)) {
      log.warn("server.chat_host_ignored", { key, why: "not a host name" });
      continue;
    }
    const policy = ChatHostPolicySchema.safeParse(value);
    if (!policy.success) {
      log.warn("server.chat_host_ignored", { key, why: "not a chat host policy" });
      continue;
    }
    policies.set(host, policy.data);
  }
  return policies;
}

/** What the resolver reads. */
export interface RenderSources {
  /** A client by its ID, or `undefined` when it can't be read now. */
  readonly client: (
    clientId: string,
  ) => Promise<{ readonly name: string; readonly redirectUris: readonly string[] } | undefined>;
  /** The operator's answer for a client, or `null` with none. */
  readonly ask: (client: {
    readonly name: string;
    readonly redirectHost?: string;
  }) => Promise<ChatHostPolicy | null>;
  readonly configured: ReadonlyMap<string, ChatHostPolicy>;
  readonly now?: () => number;
}

/** The host names a client's redirect URIs name, in their order, each once. */
function hostsOf(uris: readonly string[]): string[] {
  const hosts: string[] = [];
  for (const uri of uris) {
    try {
      const host = new URL(uri).hostname.toLowerCase();
      if (!hosts.includes(host)) hosts.push(host);
    } catch {
      // A URI that doesn't parse names no host.
    }
  }
  return hosts;
}

/** Makes the resolver: how a client's chat host shows a page. */
export function createRender(sources: RenderSources): (clientId: string) => Promise<Render> {
  const now = sources.now ?? Date.now;
  const kept = new Map<string, { readonly render: Render; readonly at: number }>();
  return async (clientId) => {
    const last = kept.get(clientId);
    if (last !== undefined && now() - last.at < RENDER_KEPT_MS) return last.render;
    const client = await sources.client(clientId);
    if (client === undefined) return last?.render ?? "app";
    const hosts = hostsOf(client.redirectUris);
    const asked = await sources.ask({
      name: client.name,
      ...(hosts[0] !== undefined ? { redirectHost: hosts[0] } : {}),
    });
    const configured = hosts.map((host) => sources.configured.get(host)).find(Boolean);
    const render: Render = asked?.render ?? configured?.render ?? "app";
    kept.set(clientId, { render, at: now() });
    // A client seen once is kept; a server seeing many keeps at most a few thousand.
    if (kept.size > 4096) kept.delete(kept.keys().next().value as string);
    return render;
  };
}
