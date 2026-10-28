/**
 * Viewers and views (D104, DATA_MODEL §3). A viewer is a person: the home's local user, or the
 * person a capability link was minted for (`view/url`'s `viewer`), mapped idempotently by the
 * host's key. A view is one frame load of one version by one viewer; mutations and submits name
 * it, and a submission takes its version from it.
 */
import {
  type ControlsPolicy,
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
  readonly opened_cursor: number | null;
  /** The channels and controls in force for the view (D108); null for views from before them. */
  readonly controls_json: string | null;
}

/** Both channels, every control: D40's standalone default. */
export const OPEN_CONTROLS: ControlsPolicy = { submitChannels: ["shell", "artifact"] };

/** The channels and controls a view was opened with (D108). */
export function viewControls(view: ViewRow): ControlsPolicy {
  return view.controls_json === null
    ? OPEN_CONTROLS
    : (JSON.parse(view.controls_json) as ControlsPolicy);
}

/** The `external_ref` of the home's one local user. */
const LOCAL_REF = "local";

function viewerOf(row: ViewerRow): Viewer {
  return {
    id: row.id,
    kind: row.kind,
    ...(row.name !== null ? { name: row.name } : {}),
    ...(row.kind === "token" || row.kind === "host" || row.kind === "tailnet"
      ? { ref: row.external_ref }
      : {}),
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
  return viewerByRef(db, "token", spec);
}

/**
 * The viewer a host's identity port named (D143 item 2): one viewer of kind `host` per `ref`,
 * kept apart from `view/url`'s viewers, which a host names for links it mints.
 */
export function viewerForHost(db: LedgerDb, spec: ViewerSpec): string {
  return viewerByRef(db, "host", spec);
}

/**
 * A tailnet person (D158 item 2): one viewer of kind `tailnet` per Tailscale login, named by the
 * display name Tailscale Serve sends.
 */
export function viewerForTailnet(db: LedgerDb, spec: ViewerSpec): string {
  return viewerByRef(db, "tailnet", spec);
}

/**
 * A link's own viewer (D158 item 2): whoever opens a link over a tunnel without being named (a
 * public share, a tagged tailnet device) acts as one viewer per link, never as the home's local
 * user, so a visitor's answers never mix into the owner's draft.
 */
export function viewerForLink(db: LedgerDb, tokenId: string, name: string): string {
  return viewerByRef(db, "token", { ref: `link:${tokenId}`, name });
}

function viewerByRef(db: LedgerDb, kind: "token" | "host" | "tailnet", spec: ViewerSpec): string {
  const found = db.get<ViewerRow>(
    "SELECT * FROM viewer WHERE kind = ? AND external_ref = ?",
    kind,
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
    "INSERT INTO viewer (id, kind, external_ref, name, created_at) VALUES (?, ?, ?, ?, ?)",
    id,
    kind,
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
    /** The channels and controls in force for this view (D108). */
    readonly controls?: ControlsPolicy;
  },
): string {
  const id = ViewId.create();
  const cursor = appendEvent(db, {
    artifactId: input.artifactId,
    type: "view.opened",
    actor: { kind: "viewer", id: input.viewerId },
    payload: { viewId: id, versionId: input.versionId, viewerId: input.viewerId },
  });
  db.run(
    "INSERT INTO view (id, artifact_id, version_id, viewer_id, token_id, opened_cursor, opened_at, controls_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    id,
    input.artifactId,
    input.versionId,
    input.viewerId,
    input.tokenId ?? null,
    Number(cursor),
    new Date().toISOString(),
    JSON.stringify(input.controls ?? OPEN_CONTROLS),
  );
  return id;
}

/**
 * The view a request names, checked against the artifact and the viewer it must belong to, and,
 * for a page, the link it was opened through: a page can't name a view another link opened, such
 * as one of a version its own link may not open (Claude review finding 11).
 * `MOSTRA_SUBMIT_VIEW_INVALID` otherwise (D104).
 */
export function viewFor(
  db: LedgerDb,
  viewId: string,
  artifactId: string,
  viewerId: string,
  tokenId?: string,
): ViewRow {
  const row = ViewId.is(viewId)
    ? db.get<ViewRow>("SELECT * FROM view WHERE id = ?", viewId)
    : undefined;
  if (
    !row ||
    row.artifact_id !== artifactId ||
    row.viewer_id !== viewerId ||
    (tokenId !== undefined && row.token_id !== tokenId)
  ) {
    throw new RpcError(
      createDiagnostic("MOSTRA_SUBMIT_VIEW_INVALID", {
        message: `The view ${viewId} isn't one this page's link opened for this artifact.`,
      }),
    );
  }
  return row;
}
