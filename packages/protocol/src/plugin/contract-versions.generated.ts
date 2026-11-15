/**
 * Written by `node tools/release/versions.ts sync` from each `@mostra/contract-*` package's
 * version. Don't edit: the release's version step keeps it equal to the packages.
 */
import type { ContractName } from "../plugins.ts";

/** The version of each contract package this release implements. */
export const CONTRACT_VERSIONS: Readonly<Record<ContractName, string>> = {
  "anchor-provider": "0.0.0",
  "cli-command": "0.0.0",
  connector: "0.0.0",
  "embed-engine": "0.0.0",
  exporter: "0.0.0",
  "verify-check": "0.0.0",
};
