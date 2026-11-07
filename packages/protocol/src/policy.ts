/**
 * The submission policy (D10, D39, D63): a module of its own, so the shell bridge's view context
 * reads it without the whole manifest schema in its bundle.
 */
import * as z from "zod";
import { wireRegistry } from "./wire-registry.ts";

/**
 * The submission policy an artifact requests (D10, D39, D63). The host decides the policy in force;
 * the manifest only asks for one.
 */
export type SubmissionPolicy =
  | { readonly policy: "once"; readonly scope?: "per-artifact" | "per-viewer" }
  | { readonly policy: "epochs" }
  | { readonly policy: "none" };

/** The Zod schema of the `SubmissionPolicy` type. */
export const SubmissionPolicy: z.ZodType<SubmissionPolicy> = z
  .discriminatedUnion("policy", [
    z.object({
      policy: z.literal("once"),
      scope: z.enum(["per-artifact", "per-viewer"]).exactOptional(),
    }),
    z.object({ policy: z.literal("epochs") }),
    z.object({ policy: z.literal("none") }),
  ])
  .register(wireRegistry, {
    id: "SubmissionPolicy",
    description: "A submission policy: once (per-artifact or per-viewer), epochs, or none.",
  });
