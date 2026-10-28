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
  .refine(isOrigin, {
    message: "An origin: http: or https:, a lower case host and a port only when not the default.",
  })
  .register(wireRegistry, {
    id: "OriginString",
    description: "A web origin: scheme, host and a port only when it isn't the default.",
  });

/** Whether a string is an origin exactly as browsers serialize one. */
function isOrigin(value: string): boolean {
  const match =
    /^(https?):\/\/([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*|\[[0-9a-f:.]+\])(?::([1-9][0-9]{0,4}))?$/.exec(
      value,
    );
  if (!match) return false;
  const port = match[3];
  if (port === undefined) return true;
  const number = Number(port);
  return (
    number <= 65535 &&
    !(match[1] === "http" && number === 80) &&
    !(match[1] === "https" && number === 443)
  );
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
export type PortAddressingExternalBaseResult = {
  readonly origin: string;
  readonly mode?: "cookie" | "worker";
} | null;

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

const result: z.ZodType<PortAddressingExternalBaseResult> = z
  .object({ origin: OriginString, mode: z.enum(["cookie", "worker"]).exactOptional() })
  .nullable()
  .register(wireRegistry, {
    id: "PortAddressingExternalBaseResult",
    description: "The external origin a host gives a listener, or null for loopback.",
  });

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
