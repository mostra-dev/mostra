/**
 * Counts by choice (D165 item 12, RM-07; DATA_MODEL §7.4, INTERFACES §18.4). An artifact that
 * names a fixed-choice field in its manifest's `tally` gets a count of each choice, grown inside the
 * submit transaction, one more for the choice the new submission holds, and read by viewers under
 * the reserved live key `$tally/<field>`. Nothing else of a submission reaches viewers this way: a
 * value outside the listed choices counts nothing, so free text is never shown, and below the
 * entry's `minTotal` viewers see only the total.
 */
import {
  ArtifactManifest,
  type Batches,
  TALLY_LIVE_PREFIX,
  type TallySpec,
  type TallyValue,
} from "@mostra/protocol";
import type { LedgerDb } from "../ledger/index.ts";

/** The tally entries of a version's manifest; none when it has none or can't be read. */
export function tallySpecs(db: LedgerDb, versionId: string): readonly TallySpec[] {
  const row = db.get<{ manifest_json: string }>(
    "SELECT manifest_json FROM version WHERE id = ?",
    versionId,
  );
  if (!row) return [];
  try {
    const parsed = ArtifactManifest.safeParse(JSON.parse(row.manifest_json));
    return parsed.success ? (parsed.data.tally ?? []) : [];
  } catch {
    return [];
  }
}

/**
 * Counts a new submission, in its submit transaction: for each tally of the version the
 * submission names, one more for the choice its draft holds for the field. Returns the fields whose
 * counts grew, so their viewers can be told after the commit.
 */
export function countSubmission(
  db: LedgerDb,
  input: {
    readonly artifactId: string;
    readonly versionId: string;
    /** The submission's draft fields, as its snapshot holds them. */
    readonly fields: Readonly<Record<string, { readonly value: unknown }>>;
  },
): string[] {
  const grown: string[] = [];
  for (const spec of tallySpecs(db, input.versionId)) {
    const value = Object.hasOwn(input.fields, spec.field)
      ? input.fields[spec.field]?.value
      : undefined;
    if (typeof value !== "string" || !spec.choices.includes(value)) continue;
    // A row is counted, never replaced (a trigger), so the first answer inserts it and every
    // later one adds to it; the count never goes down (a trigger too).
    const updated = db.run(
      "UPDATE tally SET count = count + 1 WHERE artifact_id = ? AND field_id = ? AND choice = ?",
      input.artifactId,
      spec.field,
      value,
    );
    if (updated.changes === 0) {
      db.run(
        "INSERT INTO tally (artifact_id, field_id, choice, count) VALUES (?, ?, ?, 1)",
        input.artifactId,
        spec.field,
        value,
      );
    }
    grown.push(spec.field);
  }
  return grown;
}

/** The field a tally's live key reads, or `undefined` for any other key. */
export function tallyField(key: string): string | undefined {
  return key.startsWith(TALLY_LIVE_PREFIX) ? key.slice(TALLY_LIVE_PREFIX.length) : undefined;
}

/** A tally as a live source reads it: its value, and a revision that only grows. */
export interface TallyState {
  /** The total counted for the field, as a decimal string: it grows with every count. */
  readonly revision: string;
  readonly value: TallyValue;
  /** The value as serializer batches, as every live value travels. */
  readonly batches: Batches;
}

/**
 * The tally of `field` as viewers see it, by the artifact's latest version's entry: each listed
 * choice's count (a choice no one chose is 0), and the total, or only the total below the entry's
 * `minTotal`. `undefined` when the latest version tallies no such field.
 */
export function tallyState(
  db: LedgerDb,
  artifactId: string,
  field: string,
): TallyState | undefined {
  const latest = db.get<{ latest_version_id: string | null }>(
    "SELECT latest_version_id FROM artifact WHERE id = ?",
    artifactId,
  )?.latest_version_id;
  if (!latest) return undefined;
  const spec = tallySpecs(db, latest).find((entry) => entry.field === field);
  if (!spec) return undefined;
  const rows = db.all<{ choice: string; count: number }>(
    "SELECT choice, count FROM tally WHERE artifact_id = ? AND field_id = ?",
    artifactId,
    field,
  );
  const byChoice = new Map(rows.map((row) => [row.choice, row.count]));
  // Every answer ever counted for the field: an earlier version's choices included, so the
  // revision only grows whatever a later version lists.
  const counted = rows.reduce((sum, row) => sum + row.count, 0);
  const counts: Record<string, number> = {};
  let total = 0;
  for (const choice of spec.choices) {
    const count = byChoice.get(choice) ?? 0;
    // defineProperty keeps a choice such as `__proto__` an own key.
    Object.defineProperty(counts, choice, {
      value: count,
      enumerable: true,
      writable: true,
      configurable: true,
    });
    total += count;
  }
  const value: TallyValue = total < (spec.minTotal ?? 0) ? { total } : { counts, total };
  return { revision: String(counted), value, batches: [[{ c: 0, v: value }]] };
}
