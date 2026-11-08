/**
 * Removing a hosted artifact (`ServerHandle.remove`, DATA_MODEL §7.5): an explicit deletion,
 * never part of another action. Everything of the artifact goes in one transaction of its home's
 * ledger: its own rows (every table with an `artifact_id`) and every row that references them,
 * followed through the schema's foreign keys, so no table needs listing here and a table a later
 * migration adds is covered by construction. The write-once triggers that keep versions, events,
 * submissions and tokens immutable are dropped for the transaction and created again in it, so the
 * only way past them is this one.
 */
import type { MigrationDb, SqlValue } from "../ledger/index.ts";

interface ForeignKey {
  readonly table: string;
  readonly from: string;
  readonly to: string;
}

/** What one removal deleted, table by table. */
export type Removed = Readonly<Record<string, number>>;

/**
 * Deletes an artifact and everything referencing it from a home's ledger, in the caller's write
 * transaction. Answers the rows deleted per table.
 */
export function purgeArtifact(db: MigrationDb, artifactId: string): Removed {
  const tables = db
    .all<{ name: string }>(
      "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
    )
    .map((row) => row.name);
  const columns = new Map<string, Set<string>>();
  const children = new Map<string, ForeignKey[]>();
  for (const table of tables) {
    columns.set(
      table,
      new Set(db.all<{ name: string }>(`PRAGMA table_info("${table}")`).map((row) => row.name)),
    );
    for (const key of db.all<{ table: string; from: string; to: string | null }>(
      `PRAGMA foreign_key_list("${table}")`,
    )) {
      const list = children.get(key.table) ?? [];
      list.push({ table, from: key.from, to: key.to ?? "rowid" });
      children.set(key.table, list);
    }
  }

  // Which rows of each table go: the artifact's own, then whatever references a doomed row.
  const where = new Map<string, { readonly sql: string; readonly params: SqlValue[] }>();
  for (const table of tables) {
    if (table === "artifact") where.set(table, { sql: "id = ?", params: [artifactId] });
    else if (columns.get(table)?.has("artifact_id")) {
      where.set(table, { sql: "artifact_id = ?", params: [artifactId] });
    }
  }
  // A fixed point over the foreign keys: a table joins once a parent of it is doomed. Bounded,
  // since the schema's references form no long chain.
  let grew = true;
  for (let round = 0; grew && round < 16; round++) {
    grew = false;
    for (const [parent, list] of children) {
      const doomed = where.get(parent);
      if (!doomed) continue;
      for (const key of list) {
        const clause = {
          sql: `"${key.from}" IN (SELECT "${key.to}" FROM "${parent}" WHERE ${doomed.sql})`,
          params: doomed.params,
        };
        const existing = where.get(key.table);
        if (!existing) {
          where.set(key.table, clause);
          grew = true;
        } else if (
          !existing.sql.includes(`"${key.from}" IN (SELECT "${key.to}" FROM "${parent}"`)
        ) {
          where.set(key.table, {
            sql: `(${existing.sql}) OR (${clause.sql})`,
            params: [...existing.params, ...clause.params],
          });
          grew = true;
        }
      }
    }
  }

  const triggers = db.all<{ name: string; sql: string }>(
    `SELECT name, sql FROM sqlite_schema WHERE type = 'trigger' AND tbl_name IN (${[...where.keys()]
      .map(() => "?")
      .join(", ")})`,
    ...where.keys(),
  );
  for (const trigger of triggers) db.exec(`DROP TRIGGER "${trigger.name}"`);
  db.exec("PRAGMA defer_foreign_keys = ON");
  const removed: Record<string, number> = {};
  // Children first: a row is read through its parent's clause before the parent goes.
  const order = [...where.keys()].sort((a, b) => depth(b) - depth(a));
  function depth(table: string, seen = new Set<string>()): number {
    if (table === "artifact" || seen.has(table)) return 0;
    seen.add(table);
    let deepest = 0;
    for (const [parent, list] of children) {
      if (list.some((key) => key.table === table) && where.has(parent) && parent !== table) {
        deepest = Math.max(deepest, depth(parent, seen) + 1);
      }
    }
    return deepest;
  }
  // The clauses read the parents, so the rows to delete are fixed first, by rowid.
  const doomedRows = new Map<string, number[]>();
  for (const table of order) {
    const clause = where.get(table);
    if (!clause) continue;
    doomedRows.set(
      table,
      db
        // Named apart: SQLite answers a table's own column name for `rowid` when it has an
        // INTEGER PRIMARY KEY (`document.id`, `event.cursor`).
        .all<{ row: number }>(
          `SELECT rowid AS row FROM "${table}" WHERE ${clause.sql}`,
          ...clause.params,
        )
        .map((found) => found.row),
    );
  }
  for (const table of order) {
    const rows = doomedRows.get(table) ?? [];
    let count = 0;
    for (let index = 0; index < rows.length; index += 500) {
      const slice = rows.slice(index, index + 500);
      count += db.run(
        `DELETE FROM "${table}" WHERE rowid IN (${slice.map(() => "?").join(", ")})`,
        ...slice,
      ).changes;
    }
    if (count > 0) removed[table] = count;
  }
  for (const trigger of triggers) db.exec(trigger.sql);
  // Nothing left pointing at what went: a row of another artifact naming a removed one would
  // fail the commit anyway; this names it.
  const dangling = db.all<{ table: string; parent: string }>("PRAGMA foreign_key_check");
  if (dangling.length > 0) {
    throw new Error(
      `Removing ${artifactId} would leave ${dangling.length} rows dangling (${[
        ...new Set(dangling.map((row) => `${row.table} → ${row.parent}`)),
      ].join(", ")}).`,
    );
  }
  return removed;
}
