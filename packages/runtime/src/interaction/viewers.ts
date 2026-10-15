/**
 * Viewers and views (D104, DATA_MODEL §3). A viewer is a person: the home's local user, or the
 * person a capability link was minted for (`view/url`'s `viewer`), mapped idempotently by the
 * host's key. A view is one frame load of one version by one viewer; mutations and submits name
 * it, and a submission takes its version from it.
 */
import {
  createDiagnostic,
  RpcError,
  type Viewer,
  ViewerId,
  type ViewerKind,
  type ViewerSpec,
  ViewId,
} from "@mostra/protocol";
import type { LedgerDb } from "../ledger/index.ts";
import { appendEvent } from "./events.ts";

interface ViewerRow {
  id: string;
  kind: ViewerKind;
  external_ref: string;
  name: string | null;
}

/** A `view` row. */
export interface ViewRow {
  readonly id: string;
  readonly artifact_id: string;
  readonly version_id: string;
  readonly viewer_id: string;
  readonly token_id: string | null;
}

/** The `external_ref` of the home's one local user. */
const LOCAL_REF = "local";

function viewerOf(row: ViewerRow): Viewer {
  return {
    id: row.id,
    kind: row.kind,
    ...(row.name !== null ? { name: row.name } : {}),
    ...(row.kind === "token" || row.kind === "host" ? { ref: row.external_ref } : {}),
  };
}

/** The home's local user (created on first use): who every session acts as without a viewer. */
export function localViewerId(db: LedgerDb): string {
  const found = db.get<{ id: string }>(
    "SELECT id FROM viewer WHERE kind = 'local' AND external_ref = ?",
    LOCAL_REF,
  );
  if (found) return found.id;
  const id = ViewerId.create();
  db.run(
    "INSERT INTO viewer (id, kind, external_ref, name, created_at) VALUES (?, 'local', ?, NULL, ?)",
    id,
    LOCAL_REF,
    new Date().toISOString(),
  );
  return id;
}

/**
 * The viewer a link minted with `viewer` acts for: the same `ref` always gives the same viewer, and
 * a `name` given again replaces the stored one.
 */
export function viewerForSpec(db: LedgerDb, spec: ViewerSpec): string {
  const found = db.get<ViewerRow>(
    "SELECT * FROM viewer WHERE kind = 'token' AND external_ref = ?",
    spec.ref,
  );
  if (found) {
    if (spec.name !== undefined && spec.name !== found.name) {
      db.run("UPDATE viewer SET name = ? WHERE id = ?", spec.name, found.id);
    }
    return found.id;
  }
  const id = ViewerId.create();
  db.run(
    "INSERT INTO viewer (id, kind, external_ref, name, created_at) VALUES (?, 'token', ?, ?, ?)",
    id,
    spec.ref,
    spec.name ?? null,
    new Date().toISOString(),
  );
  return id;
}

/** A viewer by ID; throws for an unknown one, which would be a defect. */
export function viewer(db: LedgerDb, id: string): Viewer {
  const row = db.get<ViewerRow>("SELECT * FROM viewer WHERE id = ?", id);
  if (!row) throw new Error(`No viewer ${id}.`);
  return viewerOf(row);
}

/** Records one frame load of a version (D104) and appends `view.opened`. */
export function openView(
  db: LedgerDb,
  input: {
    readonly artifactId: string;
    readonly versionId: string;
    readonly viewerId: string;
    readonly tokenId?: string | undefined;
  },
): string {
  const id = ViewId.create();
  db.run(
    "INSERT INTO view (id, artifact_id, version_id, viewer_id, token_id, opened_at) VALUES (?, ?, ?, ?, ?, ?)",
    id,
    input.artifactId,
    input.versionId,
    input.viewerId,
    input.tokenId ?? null,
    new Date().toISOString(),
  );
  appendEvent(db, {
    artifactId: input.artifactId,
    type: "view.opened",
    actor: { kind: "viewer", id: input.viewerId },
    payload: { viewId: id, versionId: input.versionId, viewerId: input.viewerId },
  });
  return id;
}

/**
 * The view a request names, checked against the artifact and the viewer it must belong to;
 * `MOSTRA_SUBMIT_VIEW_INVALID` otherwise (D104).
 */
export function viewFor(
  db: LedgerDb,
  viewId: string,
  artifactId: string,
  viewerId: string,
): ViewRow {
  const row = ViewId.is(viewId)
    ? db.get<ViewRow>("SELECT * FROM view WHERE id = ?", viewId)
    : undefined;
  if (!row || row.artifact_id !== artifactId || row.viewer_id !== viewerId) {
    throw new RpcError(
      createDiagnostic("MOSTRA_SUBMIT_VIEW_INVALID", {
        message: `The view ${viewId} isn't one this page's link opened for this artifact.`,
      }),
    );
  }
  return row;
}
