/**
 * The owner instance's links to remote servers (INTERFACES §18.2, D165 items 1, 2): what
 * `remote/status` reports and `mostra/initialize` carries on a binding.
 */
import * as z from "zod";
import { Cursor } from "./ids.ts";
import { wireRegistry } from "./wire-registry.ts";

/** A server, by its API origin (`https://api.example`). */
export type ServerOrigin = string;

/** The Zod schema of the `ServerOrigin` type: an origin with no path. */
export const ServerOrigin: z.ZodType<ServerOrigin> = z
  .string()
  .regex(/^https?:\/\/[^/?#\s]+$/)
  .register(wireRegistry, {
    id: "ServerOrigin",
    description: "A remote server, by its API origin, such as https://api.example.",
  });

/** The state of an instance's link to one server (INTERFACES §18.2). */
export type RemoteLinkState = "connected" | "connecting" | "offline" | "signed-out";

/** One server this home is linked to (`remote/status`). */
export interface RemoteLink {
  /** The server's API origin. */
  readonly server: ServerOrigin;
  /** The account signed in there. */
  readonly account: { readonly id: string; readonly name?: string };
  /** This home's instance link on that server (`lnk_…`), kept across sign-outs. */
  readonly instanceId: string;
  /** The link's name, as the account's other instances see it. */
  readonly name: string;
  /** Whether this instance is the account's default instance (D165 item 1b). */
  readonly default: boolean;
  /** Whether the binding is open, being dialled, offline, or signed out. */
  readonly state: RemoteLinkState;
  /** When the link reached its state. */
  readonly since: string;
  /** Publishes of shared artifacts waiting to reach the server. */
  readonly pendingPushes: number;
  /** Why the link isn't connected, when it failed. */
  readonly lastError?: string;
}

/** The Zod schema of the `RemoteLink` type. */
export const RemoteLink: z.ZodType<RemoteLink> = z
  .object({
    server: ServerOrigin,
    account: z.object({ id: z.string(), name: z.string().exactOptional() }),
    instanceId: z.string(),
    name: z.string(),
    default: z.boolean(),
    state: z.enum(["connected", "connecting", "offline", "signed-out"]),
    since: z.string(),
    pendingPushes: z.int().min(0),
    lastError: z.string().exactOptional(),
  })
  .register(wireRegistry, {
    id: "RemoteLink",
    description: "One remote server this home is linked to, and the state of the link.",
  });

/**
 * What an owner instance tells its hosted home as it opens a binding session (INTERFACES §18.2):
 * its link, the highest relay sequence it accepted, and the hosted home's position it committed,
 * so a home restored to an earlier copy is found before it answers (D165, FAILURE_MODEL §11.2).
 */
export interface OwnerLinkInfo {
  /** The instance's `lnk_` ID on this server. */
  readonly instanceId: string;
  /** The highest relay sequence the owner's ledger accepted. */
  readonly relayMark: number;
  /** The hosted home's position the owner committed: its incarnation and cursor. */
  readonly followed?: { readonly incarnation: string; readonly cursor: Cursor };
}

/** The Zod schema of the `OwnerLinkInfo` type. */
export const OwnerLinkInfo: z.ZodType<OwnerLinkInfo> = z
  .object({
    instanceId: z.string().min(1),
    relayMark: z.int().min(0),
    followed: z.object({ incarnation: z.string().min(1), cursor: Cursor.schema }).exactOptional(),
  })
  .register(wireRegistry, {
    id: "OwnerLinkInfo",
    description:
      "An owner instance's link on its binding session: its link ID, its relay mark and the hosted home's position it committed.",
  });
