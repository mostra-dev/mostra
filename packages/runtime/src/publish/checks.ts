/**
 * `instance/check` (D140 item 18): the checks only the supervisor can run, because it holds the
 * ledger's lock (D81). `mostra doctor` shows them beside the checks the CLI runs itself.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createDiagnostic, type InstanceCheck, RpcError } from "@mostra/protocol";
import type { Ledger } from "../ledger/index.ts";
import type { Registry } from "../registry/index.ts";
import { versionDamage } from "./publisher.ts";

/** What the checks read. */
export interface InstanceCheckInputs {
  /** Also hash every version against its output digest. */
  readonly deep: boolean;
  readonly ledger: Ledger;
  readonly registry: Registry;
  /** The shell's built files, when the runtime found them. */
  readonly shellDir: string | undefined;
  /** Finds the warm set; throws `MOSTRA_ENV_WARM_MISSING` when it is incomplete. */
  readonly warm: () => unknown;
}

/** Runs the checks in order: the ledger, the version store, the shell, the warm set. */
export async function instanceChecks(inputs: InstanceCheckInputs): Promise<InstanceCheck[]> {
  const checks: InstanceCheck[] = [];
  const integrity = inputs.ledger.checkIntegrity();
  checks.push(
    integrity.ok
      ? { name: "ledger", status: "ok" }
      : {
          name: "ledger",
          status: "error",
          diagnostic: createDiagnostic("MOSTRA_HOME_LEDGER_UNREADABLE", {
            message: `SQLite's integrity check of the ledger failed: ${integrity.problems.slice(0, 3).join("; ")}.`,
          }),
        },
  );
  // Collected versions have no files by design (D140 item 14); every other version must.
  const versions = inputs.ledger.read((db) =>
    db.all<{ id: string; number: number; artifact_id: string }>(
      "SELECT id, number, artifact_id FROM version WHERE id NOT IN (SELECT version_id FROM version_collected) ORDER BY artifact_id, number",
    ),
  );
  const damaged: string[] = [];
  for (const version of versions) {
    const dir = inputs.registry.store.versionDir(version.id);
    const damage = inputs.deep
      ? await versionDamage(dir)
      : existsSync(join(dir, "manifest.json"))
        ? undefined
        : "its files are missing";
    if (damage !== undefined)
      damaged.push(`${version.artifact_id} version ${version.number}: ${damage}`);
  }
  checks.push(
    damaged.length === 0
      ? { name: "versions", status: "ok" }
      : {
          name: "versions",
          status: "error",
          diagnostic: createDiagnostic("MOSTRA_HOME_INTEGRITY", {
            message: `${damaged.length} published ${damaged.length === 1 ? "version is" : "versions are"} damaged: ${damaged.slice(0, 3).join("; ")}${damaged.length > 3 ? " …" : ""}.`,
          }),
        },
  );
  checks.push(
    inputs.shellDir !== undefined
      ? { name: "shell", status: "ok" }
      : {
          name: "shell",
          status: "error",
          diagnostic: createDiagnostic("MOSTRA_ENV_SHELL_MISSING", {
            message: "The runtime has no built shell, so no capability link can open.",
          }),
        },
  );
  try {
    inputs.warm();
    checks.push({ name: "warm", status: "ok" });
  } catch (error) {
    checks.push({
      name: "warm",
      status: "error",
      diagnostic:
        error instanceof RpcError
          ? error.diagnostic
          : createDiagnostic("MOSTRA_ENV_WARM_MISSING", { message: String(error) }),
    });
  }
  return checks;
}
