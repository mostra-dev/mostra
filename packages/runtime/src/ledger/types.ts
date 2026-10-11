/** The ledger's driver-neutral query interface (D71: the store module hides the driver). */

/** A SQL parameter. */
export type SqlValue = string | number | bigint | null | Uint8Array;

/** What a write statement changed. */
export interface RunResult {
  /** Rows inserted, updated or deleted. */
  readonly changes: number;
  /** The rowid of the last inserted row. */
  readonly lastInsertRowid: number | bigint;
}

/** Queries inside one ledger transaction. Statements are prepared once and cached. */
export interface LedgerDb {
  /** Runs a statement that returns no rows. */
  run(sql: string, ...params: readonly SqlValue[]): RunResult;
  /** Returns the first row, or `undefined`. */
  get<T>(sql: string, ...params: readonly SqlValue[]): T | undefined;
  /** Returns every row. */
  all<T>(sql: string, ...params: readonly SqlValue[]): T[];
}

/** What a migration may do besides queries: run DDL scripts. */
export interface MigrationDb extends LedgerDb {
  /** Runs one or more statements without parameters. */
  exec(sql: string): void;
}
