/**
 * The home's settings (`config.json`, DATA_MODEL §1): what hosts set through `HomeConfig` and
 * what every later client of the home then shares: the dependency policy (D43, D95), the home's
 * submission policy (D102), the ports each host always provides (D105) and the submit channels the
 * home accepts (D108).
 * Written atomically (a temporary file, then a rename); read fresh by whoever needs a setting, so
 * a host's change applies to the next request.
 */
import { closeSync, fsyncSync, openSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  createDiagnostic,
  type DependencyPolicy,
  RpcError,
  SubmissionPolicy,
} from "@mostra/protocol";
import * as z from "zod";

/** The settings `config.json` holds. Unknown keys are kept, so newer settings survive. */
export interface HomeSettings {
  readonly dependencies?: DependencyPolicy;
  /** The policy for artifacts whose publish names none, before the manifest's (D102). */
  readonly submission?: SubmissionPolicy;
  /** The ports each host always provides, by its client name (D105). */
  readonly expectedPorts?: Readonly<Record<string, readonly string[]>>;
  /** The submit channels the home accepts, when a host narrowed them (D108). */
  readonly submitChannels?: readonly ("shell" | "artifact")[];
}

const Settings = z.looseObject({
  dependencies: z.enum(["auto", "explicit"]).optional(),
  submission: SubmissionPolicy.optional(),
  expectedPorts: z.record(z.string(), z.array(z.string())).optional(),
  submitChannels: z
    .array(z.enum(["shell", "artifact"]))
    .min(1)
    .max(2)
    .optional(),
});

/** The settings file of a home. */
export const SETTINGS_FILE = "config.json";

function unreadable(home: string, reason: string): RpcError {
  return new RpcError(
    createDiagnostic("MOSTRA_HOME_INTEGRITY", {
      message: `The home's ${join(home, SETTINGS_FILE)} can't be read: ${reason}.`,
      hint: `Repair or remove ${SETTINGS_FILE} in the home; a host sets its settings again when it connects.`,
    }),
  );
}

/**
 * The home's settings; none when `config.json` doesn't exist. A file that isn't valid settings
 * fails closed: guessing the policy could install packages a host forbade.
 */
export function readHomeSettings(home: string): HomeSettings & Record<string, unknown> {
  let text: string;
  try {
    text = readFileSync(join(home, SETTINGS_FILE), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw unreadable(home, (error as NodeJS.ErrnoException).code ?? "error");
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw unreadable(home, "it isn't JSON");
  }
  const parsed = Settings.safeParse(data);
  if (!parsed.success) throw unreadable(home, "its settings are invalid");
  return parsed.data as HomeSettings & Record<string, unknown>;
}

/** Merges `change` into the home's settings, durably. */
export function writeHomeSettings(home: string, change: HomeSettings): void {
  const next = { ...readHomeSettings(home), ...change };
  const file = join(home, SETTINGS_FILE);
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  const handle = openSync(temporary, "r");
  try {
    fsyncSync(handle);
  } finally {
    closeSync(handle);
  }
  renameSync(temporary, file);
  const dir = openSync(home, "r");
  try {
    fsyncSync(dir);
  } catch {
    // Some file systems can't sync a directory; the rename itself is atomic.
  } finally {
    closeSync(dir);
  }
}
