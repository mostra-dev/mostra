import * as z from "zod";
import { ArtifactId } from "../../ids.ts";
import { defineMethod, type MethodDefinition } from "../../method.ts";
import { wireRegistry } from "../../wire-registry.ts";

/**
 * An origin as browsers write it (`https://host.example`, `http://host:8080`): a scheme, a lower
 * case host and a port only when it isn't the scheme's default, with no path, query or fragment.
 */
export const OriginString: z.ZodType<string> = z
  .string()
  .max(2048)
  .regex(originPattern(), {
    message: "An origin: http: or https:, a lower case host and a port only when not the default.",
  })
  .register(wireRegistry, {
    id: "OriginString",
    description: "A web origin: scheme, host and a port only when it isn't the default.",
  });

/**
 * An origin exactly as browsers serialize one, as one regular expression, so JSON Schema and the
 * Rust crate check what Zod checks: a lower case DNS name or bracketed IPv6 literal, a port of 1
 * to 65535, and never the scheme's default port written out.
 */
function originPattern(): RegExp {
  const label = "[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?";
  const host = `(?:${label}(?:\\.${label})*|\\[[0-9a-f:.]+\\])`;
  const port =
    "(?:[1-9][0-9]{0,3}|[1-5][0-9]{4}|6[0-4][0-9]{3}|65[0-4][0-9]{2}|655[0-2][0-9]|6553[0-5])";
  return new RegExp(`^(?!http://[^/]*:80$)(?!https://[^/]*:443$)https?://${host}(?::${port})?$`);
}

/** The params of `port/addressing.externalBase` (INTERFACES §7, D158 item 6). */
export interface PortAddressingExternalBaseParams {
  /** The artifact whose links or frame this address serves. */
  readonly artifactId: string;
  /**
   * Which of Mostra's listeners the address fronts: `shell` for the artifact's links (the shell
   * that opens them), `artifact` for the artifact's own frame.
   */
  readonly listener: "shell" | "artifact";
  /**
   * The loopback origin the host forwards this address to, such as `http://127.0.0.1:23456`: a
   * port leased for this face, the same across restarts while the face exists.
   */
  readonly local: string;
}

/**
 * The host's answer: the origin browsers use for this listener, and optionally how the artifact's
 * frame authenticates there (`worker` by default whenever the shell's and the artifact's hosts
 * differ, D70); `null` when the host offers no external address, so links stay on loopback.
 */
export type PortAddressingExternalBaseResult = ExternalBase | null;

const params: z.ZodType<PortAddressingExternalBaseParams> = z
  .object({
    artifactId: ArtifactId.schema,
    listener: z.enum(["shell", "artifact"]),
    local: z.string().min(1),
  })
  .register(wireRegistry, {
    id: "PortAddressingExternalBaseParams",
    description:
      "Which listener of which artifact needs an external address, and where it listens.",
  });

/** One external address a host gives a listener (D158 item 6). */
export interface ExternalBase {
  readonly origin: string;
  readonly mode?: "cookie" | "worker";
}

/** The schema of {@link ExternalBase}. */
export const ExternalBase: z.ZodType<ExternalBase> = z
  .object({ origin: OriginString, mode: z.enum(["cookie", "worker"]).exactOptional() })
  .register(wireRegistry, {
    id: "ExternalBase",
    description: "The origin browsers use for a listener, and how its frame authenticates there.",
  });

const result: z.ZodType<PortAddressingExternalBaseResult> = ExternalBase.nullable().register(
  wireRegistry,
  {
    id: "PortAddressingExternalBaseResult",
    description: "The external origin a host gives a listener, or null for loopback.",
  },
);

/**
 * `port/addressing.externalBase`: Mostra asks the host that registered the `addressing` port for
 * the external address of one of its listeners (HO-10, D158 item 6), with 5 seconds to answer,
 * when it mints a link for an artifact and when the shell at such an address opens the artifact's
 * frame. The answer joins the Host allowlist and the links Mostra mints; `null`, or another
 * origin, withdraws the address given before, whose links stop working. A host that fails or
 * answers something the schema refuses leaves links on loopback.
 */
export const portAddressingExternalBaseMethod: MethodDefinition<
  PortAddressingExternalBaseParams,
  PortAddressingExternalBaseResult
> = defineMethod({
  method: "port/addressing.externalBase",
  direction: "instance-to-host",
  mutating: false,
  params,
  result,
});
