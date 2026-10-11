import * as z from "zod";
import { defineMethod, type MethodDefinition } from "../../method.ts";
import { wireRegistry } from "../../wire-registry.ts";

/** The params of `mostra/shutdown` (INTERFACES §6): none. */
export type MostraShutdownParams = Record<string, never>;

/** The result of `mostra/shutdown`, sent before the instance stops: empty. */
export type MostraShutdownResult = Record<string, never>;

const params: z.ZodType<MostraShutdownParams> = z
  .object({})
  .register(wireRegistry, { id: "MostraShutdownParams" });

const result: z.ZodType<MostraShutdownResult> = z
  .object({})
  .register(wireRegistry, { id: "MostraShutdownResult" });

/**
 * `mostra/shutdown`: stops the instance cleanly. The instance answers first, then finishes its
 * ledger work, stops its children, removes its socket and `instance.json`, and exits. Available to
 * the spawning host and to every attached client of a daemon (D87).
 */
export const mostraShutdownMethod: MethodDefinition<MostraShutdownParams, MostraShutdownResult> =
  defineMethod({
    method: "mostra/shutdown",
    direction: "client-to-instance",
    mutating: false,
    params,
    result,
  });
