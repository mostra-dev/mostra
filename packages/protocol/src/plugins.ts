/**
 * The wire types of the plugin system (D30, D31, INTERFACES §14): what `plugin/*` and `pack/add`
 * answer, and the home's license policy. The manifest schema, license classing and the contract
 * table live in the `./plugin` entry, which only the instance and tools load.
 */
import * as z from "zod";
import { Diagnostic } from "./diagnostics/diagnostic.ts";
import { wireRegistry } from "./wire-registry.ts";

/**
 * The six extension contracts (ARCHITECTURE §13, ROUND-3 §6.1), each its own
 * `@mostra/contract-<name>` package with its own version.
 */
export type ContractName =
  | "embed-engine"
  | "exporter"
  | "verify-check"
  | "anchor-provider"
  | "connector"
  | "cli-command";

/** The Zod schema of the `ContractName` type. */
export const ContractName: z.ZodType<ContractName> = z
  .enum(["embed-engine", "exporter", "verify-check", "anchor-provider", "connector", "cli-command"])
  .register(wireRegistry, {
    id: "ContractName",
    description: "An extension contract: each is its own @mostra/contract-<name> package (D30).",
  });

/**
 * What a license is, as Mostra shows it at install (D31, EX-04): `osi-permissive` and
 * `osi-copyleft` (OSI-approved), `public-domain` (a dedication, or a license that asks nothing),
 * `free` (free but not OSI-approved, such as CC-BY-4.0), `source-available` (readable, with use
 * restricted), `proprietary`, and `unknown` (Mostra can't read it). The last three need a one-time
 * acknowledgment.
 */
export type LicenseClass =
  | "osi-permissive"
  | "osi-copyleft"
  | "public-domain"
  | "free"
  | "source-available"
  | "proprietary"
  | "unknown";

/** The Zod schema of the `LicenseClass` type. */
export const LicenseClass: z.ZodType<LicenseClass> = z
  .enum([
    "osi-permissive",
    "osi-copyleft",
    "public-domain",
    "free",
    "source-available",
    "proprietary",
    "unknown",
  ])
  .register(wireRegistry, {
    id: "LicenseClass",
    description:
      "What a license is (D31): OSI-approved (permissive, copyleft), public-domain, free, source-available, proprietary or unknown; the last three need an acknowledgment.",
  });

/**
 * Where a license's acknowledgment stands: `not-needed` (its class needs none), `accepted` (with
 * `--accept-license`, recorded in the lockfile), `host` (the home's host accepted it by policy,
 * recorded the same way) or `missing`.
 */
export type LicenseAcknowledgment = "not-needed" | "accepted" | "host" | "missing";

/** The Zod schema of the `LicenseAcknowledgment` type. */
export const LicenseAcknowledgment: z.ZodType<LicenseAcknowledgment> = z
  .enum(["not-needed", "accepted", "host", "missing"])
  .register(wireRegistry, {
    id: "LicenseAcknowledgment",
    description: "Where a license's acknowledgment stands: not-needed, accepted, host or missing.",
  });

/** One package under a license, as a disclosure lists it. */
export interface LicensedPackage {
  /** The package's npm name. */
  readonly name: string;
  /** The package's version. */
  readonly version: string;
  /** The license expression it declares, as Mostra read it. */
  readonly license: string;
}

/** The Zod schema of the `LicensedPackage` type. */
export const LicensedPackage: z.ZodType<LicensedPackage> = z
  .object({ name: z.string().min(1), version: z.string().min(1), license: z.string() })
  .register(wireRegistry, {
    id: "LicensedPackage",
    description: "A package under a license: its name, version and declared license.",
  });

/** One license an install brings, shown before anything is recorded (D31). */
export interface LicenseDisclosure {
  /** The license: an SPDX ID or a `LicenseRef-` reference, what `--accept-license` names. */
  readonly id: string;
  /** Its class (D31). */
  readonly class: LicenseClass;
  /** The packages under it. */
  readonly packages: readonly LicensedPackage[];
  /** Where its acknowledgment stands. */
  readonly acknowledgment: LicenseAcknowledgment;
  /** When it was acknowledged (RFC 3339). */
  readonly acceptedAt?: string;
  /** What the plugin says of it in one line, for a `LicenseRef-`. */
  readonly summary?: string;
  /** Where its full text is. */
  readonly url?: string;
}

/** The Zod schema of the `LicenseDisclosure` type. */
export const LicenseDisclosure: z.ZodType<LicenseDisclosure> = z
  .object({
    id: z.string().min(1),
    class: LicenseClass,
    packages: z.array(LicensedPackage).readonly(),
    acknowledgment: LicenseAcknowledgment,
    acceptedAt: z.iso.datetime().exactOptional(),
    summary: z.string().exactOptional(),
    url: z.string().exactOptional(),
  })
  .register(wireRegistry, {
    id: "LicenseDisclosure",
    description:
      "A license an install brings: its ID and class, the packages under it and where its acknowledgment stands (D31).",
  });

/** Where a plugin is installed: one artifact (recorded in its lockfile) or the whole home. */
export type PluginScope = "artifact" | "home";

/** The Zod schema of the `PluginScope` type. */
export const PluginScope: z.ZodType<PluginScope> = z
  .enum(["artifact", "home"])
  .register(wireRegistry, {
    id: "PluginScope",
    description:
      "Where a plugin is installed: one artifact, or the whole home (exporters and CLI commands).",
  });

/** One contribution of a plugin: the contract it implements and its ID. */
export interface PluginContribution {
  /** The contract's stamp, its name and version, which the define function sets. */
  readonly contract: ContractName;
  /** Its ID (a CLI command's: its words joined by spaces). */
  readonly id: string;
}

/** The Zod schema of the `PluginContribution` type. */
export const PluginContribution: z.ZodType<PluginContribution> = z
  .object({ contract: ContractName, id: z.string().min(1) })
  .register(wireRegistry, {
    id: "PluginContribution",
    description: "A plugin's contribution: the contract it implements and its ID.",
  });

/** A plugin as `plugin/*` reports it. */
export interface PluginSummary {
  /** Its npm package. */
  readonly package: string;
  /** The package's version. */
  readonly version: string;
  /** Its manifest's `name`: `<namespace>/<name>`. */
  readonly name: string;
  /** A short name for people. */
  readonly title?: string;
  /** One sentence on what it does, for people and agents. */
  readonly description?: string;
  /** Where it is installed: one artifact, or the whole home. */
  readonly scope: PluginScope;
  /** The contract ranges it declares, by contract. */
  readonly contracts: Readonly<Record<string, string>>;
  /** What it contributes, in its manifest's order. */
  readonly contributions: readonly PluginContribution[];
  /** The source packs it carries (their item names). */
  readonly packs: readonly string[];
  /** The effects it declares (`network`, `filesystem` …): disclosure, never enforced. */
  readonly effects: readonly string[];
  /** Its own license expression. */
  readonly license: string;
  /** The systems it says it runs on; absent means all. */
  readonly platforms?: readonly string[];
  /** `ok` when it loads here, `error` when one of `diagnostics` is an error. */
  readonly status: "ok" | "error";
  /** What loading it found: contract ranges, conflicts, entries, licenses. */
  readonly diagnostics: readonly Diagnostic[];
}

/** The Zod schema of the `PluginSummary` type. */
export const PluginSummary: z.ZodType<PluginSummary> = z
  .object({
    package: z.string().min(1),
    version: z.string().min(1),
    name: z.string().min(1),
    title: z.string().exactOptional(),
    description: z.string().exactOptional(),
    scope: PluginScope,
    contracts: z.record(z.string(), z.string()),
    contributions: z.array(PluginContribution).readonly(),
    packs: z.array(z.string()).readonly(),
    effects: z.array(z.string()).readonly(),
    license: z.string(),
    platforms: z.array(z.string()).readonly().exactOptional(),
    status: z.enum(["ok", "error"]),
    diagnostics: z.array(Diagnostic).readonly(),
  })
  .register(wireRegistry, {
    id: "PluginSummary",
    description:
      "A plugin as plugin/* reports it: its package, manifest, scope, contributions, licenses and whether it loads (D30).",
  });

/**
 * The home's license policy (D31): the licenses its host accepts for every install, as
 * `--accept-license` would (`"*"` accepts any). Kept in the home's `config.json`.
 */
export interface LicensePolicy {
  /** License IDs (`LicenseRef-Remotion`), or `"*"` for every license. */
  readonly accept: readonly string[];
}

/** The Zod schema of the `LicensePolicy` type. */
export const LicensePolicy: z.ZodType<LicensePolicy> = z
  .object({ accept: z.array(z.string().min(1).max(256)).max(256).readonly() })
  .register(wireRegistry, {
    id: "LicensePolicy",
    description:
      "The licenses a home's host accepts for every install (D31): IDs, or * for any. Kept in config.json.",
  });
