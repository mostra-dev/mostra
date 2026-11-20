import * as z from "zod";
import { defineMethod, type MethodDefinition } from "../../method.ts";
import { wireRegistry } from "../../wire-registry.ts";

/** The params of `relay/author.progress` (INTERFACES §18.8). */
export interface RelayAuthorProgressParams {
  /** The `progressToken` the relayed `artifact/verify` carried. */
  readonly progressToken: string;
  /** The stage that started (`prepare`, `compile`, `boot`, `render`, `smoke`, `regression`). */
  readonly stage: string;
  /** How far the stage is, 0 to 1, when known. */
  readonly fraction?: number;
}

const params: z.ZodType<RelayAuthorProgressParams> = z
  .object({
    progressToken: z.string().min(1).max(200),
    stage: z.string().min(1).max(64),
    fraction: z.number().min(0).max(1).exactOptional(),
  })
  .register(wireRegistry, { id: "RelayAuthorProgressParams" });

const result: z.ZodType<Record<string, never>> = z
  .object({})
  .register(wireRegistry, { id: "RelayAuthorProgressResult" });

/**
 * `relay/author.progress`: the owner instance reports each stage of an `artifact/verify` a chat
 * host's agent asked for through `port/relay.author`, so the remote MCP server's
 * `artifact_verify` can answer where verify is while it runs (#157, D175 item 10). Best effort:
 * the verdict still arrives whole as the relayed call's answer.
 */
export const relayAuthorProgressMethod: MethodDefinition<
  RelayAuthorProgressParams,
  Record<string, never>
> = defineMethod({
  method: "relay/author.progress",
  direction: "client-to-instance",
  mutating: false,
  params,
  result,
});
