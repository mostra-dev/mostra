import * as z from "zod";
import { Diagnostic } from "../../diagnostics/diagnostic.ts";
import { defineMethod, type MethodDefinition } from "../../method.ts";
import { wireRegistry } from "../../wire-registry.ts";

/** The params of `instance/check` (INTERFACES §6, D140 item 18). */
export interface InstanceCheckParams {
  /** Also hash every version directory against its `outputDigest` (`mostra doctor --deep`). */
  readonly deep?: boolean;
}

/** One check's outcome. */
export interface InstanceCheck {
  /** What was checked: `ledger`, `versions`, `ports`, `browser`, `shell`, `warm` and so on. */
  readonly name: string;
  /** `ok`, or how serious what it found is. */
  readonly status: "ok" | "warning" | "error";
  /** What is wrong and what to do, for a warning or an error. */
  readonly diagnostic?: Diagnostic;
}

/** The result of `instance/check`. */
export interface InstanceCheckResult {
  /** Every check, in the order it ran. */
  readonly checks: readonly InstanceCheck[];
}

const params: z.ZodType<InstanceCheckParams> = z
  .object({ deep: z.boolean().exactOptional() })
  .register(wireRegistry, { id: "InstanceCheckParams" });

const result: z.ZodType<InstanceCheckResult> = z
  .object({
    checks: z
      .array(
        z.object({
          name: z.string().min(1),
          status: z.enum(["ok", "warning", "error"]),
          diagnostic: Diagnostic.exactOptional(),
        }),
      )
      .readonly(),
  })
  .register(wireRegistry, {
    id: "InstanceCheckResult",
    description: "The supervisor's own checks of its home.",
  });

/**
 * `instance/check`: the checks only the supervisor can run, because it holds the ledger's lock
 * (D81): the ledger's integrity, the version store, leased ports another program holds, and the
 * runtime's browser, shell and warm set. `mostra doctor` adds the checks a client runs itself.
 */
export const instanceCheckMethod: MethodDefinition<InstanceCheckParams, InstanceCheckResult> =
  defineMethod({
    method: "instance/check",
    direction: "client-to-instance",
    mutating: false,
    params,
    result,
  });
