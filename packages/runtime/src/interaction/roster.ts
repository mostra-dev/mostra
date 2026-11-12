/**
 * Expected respondents and their roster (D121, D168; CO-01 to CO-03, CO-07). An artifact names the
 * people it expects answers from; each acts as one viewer of kind `token` (D104) through a personal
 * link the gateway mints. The roster has rounds: under `once` one, complete while every respondent
 * has a submission; under `epochs` a new one after each completion, complete once every respondent
 * submitted since it began. A completion is a durable `roster.completed`, appended in the same
 * transaction as the submission (or roster change) that made it, so a wait, a host and the
 * operator's events hear it exactly once per completion.
 *
 * Every function here runs inside the caller's ledger transaction.
 */
import { createHash } from "node:crypto";
import {
  type Actor,
  createDiagnostic,
  DEFAULT_TEAM_VISIBILITY,
  type Peer,
  type Respondent,
  type RespondentForPage,
  type RespondentSpec,
  type RespondentStatus,
  ROSTER_MAX,
  type Roster,
  type RosterCounts,
  type RosterForPage,
  RpcError,
  type SubmissionPolicy,
  type TeamVisibility,
  type ViewerKind,
} from "@mostra/protocol";
import type { LedgerDb } from "../ledger/index.ts";
import { appendEvent } from "./events.ts";
import { storedPolicy } from "./policy.ts";
import { viewerForSpec } from "./viewers.ts";

/** A `roster_entry` row. */
interface EntryRow {
  readonly artifact_id: string;
  readonly ref: string;
  readonly name: string | null;
  readonly email: string | null;
  readonly viewer_id: string;
  readonly token_id: string | null;
  readonly position: number;
  readonly added_at: string;
}

/** A `roster_state` row. */
interface StateRow {
  readonly artifact_id: string;
  readonly round: number;
  readonly round_cursor: number;
  readonly round_started_at: string;
  readonly complete: number;
}

/** The roster's state: round 1 from the start of everything until the roster first changes it. */
function stateOf(db: LedgerDb, artifactId: string): StateRow {
  return (
    db.get<StateRow>("SELECT * FROM roster_state WHERE artifact_id = ?", artifactId) ?? {
      artifact_id: artifactId,
      round: 1,
      round_cursor: 0,
      round_started_at: "",
      complete: 0,
    }
  );
}

function entries(db: LedgerDb, artifactId: string): EntryRow[] {
  return db.all<EntryRow>(
    "SELECT * FROM roster_entry WHERE artifact_id = ? ORDER BY position",
    artifactId,
  );
}

function policyOf(db: LedgerDb, artifactId: string): SubmissionPolicy {
  const row = db.get<{ policy_json: string | null }>(
    "SELECT policy_json FROM artifact WHERE id = ?",
    artifactId,
  );
  return storedPolicy(row?.policy_json ?? null);
}

/**
 * What a page may learn of other viewers' submissions (CO-07, D168): under `once` for the whole
 * artifact anyone's submission closes every draft, so every page hears of it; otherwise a
 * submission is its viewer's status, shown only as the visibility allows, the owner seeing as
 * `names`.
 */
export interface SubmissionStanding {
  readonly closesAll: boolean;
  readonly visibility: TeamVisibility;
}

export function submissionStanding(
  db: LedgerDb,
  artifactId: string,
  owner: boolean,
): SubmissionStanding {
  const policy = policyOf(db, artifactId);
  return {
    closesAll: policy.policy === "once" && policy.scope !== "per-viewer",
    visibility: owner ? "names" : teamVisibility(db, artifactId),
  };
}

/**
 * What viewers see of each other on an artifact (CO-07): its latest version's `team.visibility`,
 * else `private` (D168). The latest version decides for every view, so a version that narrows it
 * narrows it for pages of older versions too.
 */
export function teamVisibility(db: LedgerDb, artifactId: string): TeamVisibility {
  const row = db.get<{ manifest_json: string }>(
    `SELECT version.manifest_json FROM artifact JOIN version ON version.id = artifact.latest_version_id
      WHERE artifact.id = ?`,
    artifactId,
  );
  if (!row) return DEFAULT_TEAM_VISIBILITY;
  try {
    const manifest = JSON.parse(row.manifest_json) as { team?: { visibility?: unknown } };
    const value = manifest.team?.visibility;
    return value === "counts" || value === "names" || value === "private"
      ? value
      : DEFAULT_TEAM_VISIBILITY;
  } catch {
    return DEFAULT_TEAM_VISIBILITY;
  }
}

/**
 * A viewer's key as pages see it (D168): stable for one viewer of one artifact, different across
 * artifacts, and no viewer ID, which pages never learn of others (D104).
 */
export function peerKey(artifactId: string, viewerId: string): string {
  const digest = createHash("sha256")
    .update(`mostra/viewer-key\u0000${artifactId}\u0000${viewerId}`)
    .digest("hex");
  return `vk_${digest.slice(0, 24)}`;
}

/** One respondent's standing in the round. */
interface Standing {
  readonly entry: EntryRow;
  readonly status: RespondentStatus;
  readonly openedAt?: string;
  readonly activeAt?: string;
  readonly submission?: { readonly id: string; readonly at: string; readonly position: number };
  readonly submissions: number;
}

/**
 * Where each respondent stands in the round (CO-03): `submitted` with a submission in it (under
 * `once`, their one submission; under `epochs`, their latest after the round began), else
 * `drafting` when they opened the artifact or wrote their draft in it, else `not-opened`.
 */
function standings(db: LedgerDb, artifactId: string, state: StateRow): Standing[] {
  const list = entries(db, artifactId);
  if (list.length === 0) return [];
  // Four grouped reads over the roster's viewers, whatever its size: a settle runs in every
  // submit transaction, so it costs the same for 5 respondents or 1,000.
  const inRound = new Map(
    db
      .all<{ viewer_id: string; id: string; created_at: string; position: number }>(
        "SELECT s.viewer_id, s.id, s.created_at, s.position FROM submission s JOIN roster_entry r ON r.artifact_id = s.artifact_id AND r.viewer_id = s.viewer_id WHERE s.artifact_id = ? AND s.position > ? AND s.position = (SELECT MAX(t.position) FROM submission t WHERE t.artifact_id = s.artifact_id AND t.viewer_id = s.viewer_id)",
        artifactId,
        state.round_cursor,
      )
      .map((row) => [row.viewer_id, row]),
  );
  const totals = new Map(
    db
      .all<{ viewer_id: string; n: number }>(
        "SELECT s.viewer_id, COUNT(*) AS n FROM submission s JOIN roster_entry r ON r.artifact_id = s.artifact_id AND r.viewer_id = s.viewer_id WHERE s.artifact_id = ? GROUP BY s.viewer_id",
        artifactId,
      )
      .map((row) => [row.viewer_id, row.n]),
  );
  const views = new Map(
    db
      .all<{ viewer_id: string; first: string; last: string }>(
        "SELECT v.viewer_id, MIN(v.opened_at) AS first, MAX(v.opened_at) AS last FROM view v JOIN roster_entry r ON r.artifact_id = v.artifact_id AND r.viewer_id = v.viewer_id WHERE v.artifact_id = ? GROUP BY v.viewer_id",
        artifactId,
      )
      .map((row) => [row.viewer_id, row]),
  );
  const wrote = new Map(
    db
      .all<{ viewer_id: string; last: string }>(
        "SELECT d.viewer_id, MAX(f.updated_at) AS last FROM field f JOIN document d ON d.id = f.document_id JOIN roster_entry r ON r.artifact_id = d.artifact_id AND r.viewer_id = d.viewer_id WHERE d.artifact_id = ? AND d.scope = 'viewer' GROUP BY d.viewer_id",
        artifactId,
      )
      .map((row) => [row.viewer_id, row.last]),
  );
  return list.map((entry) => {
    const submission = inRound.get(entry.viewer_id);
    const opened = views.get(entry.viewer_id);
    const activeAt =
      [opened?.last, wrote.get(entry.viewer_id)]
        .filter((at): at is string => typeof at === "string")
        .sort()
        .at(-1) ?? undefined;
    const status: RespondentStatus = submission
      ? "submitted"
      : activeAt !== undefined && activeAt >= state.round_started_at
        ? "drafting"
        : "not-opened";
    return {
      entry,
      status,
      ...(opened ? { openedAt: opened.first } : {}),
      ...(activeAt !== undefined ? { activeAt } : {}),
      ...(submission
        ? {
            submission: {
              id: submission.id,
              at: submission.created_at,
              position: submission.position,
            },
          }
        : {}),
      submissions: totals.get(entry.viewer_id) ?? 0,
    };
  });
}

function countsOf(list: readonly Standing[]): RosterCounts {
  return {
    total: list.length,
    notOpened: list.filter((one) => one.status === "not-opened").length,
    drafting: list.filter((one) => one.status === "drafting").length,
    submitted: list.filter((one) => one.status === "submitted").length,
  };
}

/** Whether every respondent submitted in the round; an empty roster never has. */
function completeOf(list: readonly Standing[]): boolean {
  return list.length > 0 && list.every((one) => one.status === "submitted");
}

/** The whole roster, as agents and hosts read it (`roster/get`, CO-03, CO-07). */
export function readRoster(
  db: LedgerDb,
  artifactId: string,
  live: (tokenId: string) => boolean = () => true,
): Roster {
  const state = stateOf(db, artifactId);
  const list = standings(db, artifactId, state);
  return {
    round: state.round,
    complete: completeOf(list),
    visibility: teamVisibility(db, artifactId),
    counts: countsOf(list),
    respondents: list.map((one): Respondent => {
      const { entry } = one;
      return {
        ref: entry.ref,
        ...(entry.name !== null ? { name: entry.name } : {}),
        ...(entry.email !== null ? { email: entry.email } : {}),
        viewerId: entry.viewer_id,
        status: one.status,
        ...(one.openedAt !== undefined ? { openedAt: one.openedAt } : {}),
        ...(one.activeAt !== undefined ? { activeAt: one.activeAt } : {}),
        ...(one.submission ? { submission: { id: one.submission.id, at: one.submission.at } } : {}),
        submissions: one.submissions,
        ...(entry.token_id !== null && live(entry.token_id) ? { tokenId: entry.token_id } : {}),
        addedAt: entry.added_at,
      };
    }),
  };
}

/** Whether the artifact has any expected respondent. */
export function hasRoster(db: LedgerDb, artifactId: string): boolean {
  return (
    db.get("SELECT 1 FROM roster_entry WHERE artifact_id = ? LIMIT 1", artifactId) !== undefined
  );
}

/**
 * Settles the roster after a change inside its transaction (a submission, an import, a roster
 * change): when the round became complete, appends `roster.completed` with each respondent's
 * submission in the round and, under `epochs`, begins the next round; when a roster change made a
 * complete round incomplete again (someone joined), says so. Returns whether it is complete now.
 */
export function settleRoster(db: LedgerDb, artifactId: string, now: string): boolean {
  if (
    !hasRoster(db, artifactId) &&
    !db.get("SELECT 1 FROM roster_state WHERE artifact_id = ?", artifactId)
  ) {
    return false;
  }
  const state = stateOf(db, artifactId);
  const list = standings(db, artifactId, state);
  const complete = completeOf(list);
  const ensure = (): void => {
    db.run(
      "INSERT OR IGNORE INTO roster_state (artifact_id, round, round_cursor, round_started_at, complete) VALUES (?, 1, 0, '', 0)",
      artifactId,
    );
  };
  if (complete && state.complete === 0) {
    ensure();
    const cursor = Number(
      appendEvent(db, {
        artifactId,
        type: "roster.completed",
        actor: { kind: "mostra" },
        payload: {
          round: state.round,
          respondents: list.length,
          submissions: list.map((one) => ({
            ref: one.entry.ref,
            submissionId: one.submission?.id ?? "",
          })),
        },
      }),
    );
    if (policyOf(db, artifactId).policy === "epochs") {
      // The next round begins with this completion: what anyone submits from now on is its.
      db.run(
        "UPDATE roster_state SET round = round + 1, round_cursor = ?, round_started_at = ?, complete = 0 WHERE artifact_id = ?",
        cursor,
        now,
        artifactId,
      );
      return false;
    }
    db.run("UPDATE roster_state SET complete = 1 WHERE artifact_id = ?", artifactId);
    return true;
  }
  if (!complete && state.complete === 1) {
    db.run("UPDATE roster_state SET complete = 0 WHERE artifact_id = ?", artifactId);
  }
  return complete;
}

function rosterTooLarge(count: number): RpcError {
  return new RpcError(
    createDiagnostic("MOSTRA_TEAM_ROSTER_TOO_LARGE", {
      message: `This change would give the roster ${count} expected respondents, more than ${ROSTER_MAX}.`,
    }),
  );
}

/**
 * Adds expected respondents (CO-01), idempotently by `ref`: one already there keeps their row and
 * link, and a name or email given again replaces theirs. `link` gives each respondent's personal
 * link's token (`current` is the one their row names, which the caller keeps while it works) and
 * runs in this transaction. Appends `roster.changed` when anything changed.
 */
export function addRespondents(
  db: LedgerDb,
  input: {
    readonly artifactId: string;
    readonly respondents: readonly RespondentSpec[];
    readonly actor: Actor;
    readonly now: string;
    readonly link: (viewerId: string, current: string | undefined) => string;
  },
): { readonly tokens: readonly { readonly ref: string; readonly tokenId: string }[] } {
  const seen = new Set<string>();
  const specs = input.respondents.filter((spec) => {
    if (seen.has(spec.ref)) return false;
    seen.add(spec.ref);
    return true;
  });
  const existing = new Map(entries(db, input.artifactId).map((entry) => [entry.ref, entry]));
  const fresh = specs.filter((spec) => !existing.has(spec.ref)).length;
  if (existing.size + fresh > ROSTER_MAX) throw rosterTooLarge(existing.size + fresh);
  let position =
    db.get<{ last: number | null }>(
      "SELECT MAX(position) AS last FROM roster_entry WHERE artifact_id = ?",
      input.artifactId,
    )?.last ?? 0;
  const added: { ref: string; name?: string }[] = [];
  const renamed: { ref: string; name?: string }[] = [];
  const relinked: string[] = [];
  const tokens: { ref: string; tokenId: string }[] = [];
  for (const spec of specs) {
    const viewerId = viewerForSpec(db, {
      ref: spec.ref,
      ...(spec.name !== undefined ? { name: spec.name } : {}),
    });
    const entry = existing.get(spec.ref);
    const tokenId = input.link(viewerId, entry?.token_id ?? undefined);
    tokens.push({ ref: spec.ref, tokenId });
    if (!entry) {
      position += 1;
      db.run(
        "INSERT INTO roster_entry (artifact_id, ref, name, email, viewer_id, token_id, position, added_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        input.artifactId,
        spec.ref,
        spec.name ?? null,
        spec.email ?? null,
        viewerId,
        tokenId,
        position,
        input.now,
      );
      added.push({ ref: spec.ref, ...(spec.name !== undefined ? { name: spec.name } : {}) });
      continue;
    }
    const name = spec.name ?? entry.name;
    const email = spec.email ?? entry.email;
    if (name !== entry.name || email !== entry.email || tokenId !== entry.token_id) {
      db.run(
        "UPDATE roster_entry SET name = ?, email = ?, token_id = ? WHERE artifact_id = ? AND ref = ?",
        name,
        email,
        tokenId,
        input.artifactId,
        spec.ref,
      );
      if (name !== entry.name) renamed.push({ ref: spec.ref, ...(name !== null ? { name } : {}) });
      // A new personal link replaced one that stopped working (revoked, expired, moved).
      if (tokenId !== entry.token_id) relinked.push(spec.ref);
    }
  }
  if (added.length > 0 || renamed.length > 0 || relinked.length > 0) {
    changed(db, input, { added, renamed, relinked, removed: [] });
  }
  return { tokens };
}

/**
 * Removes expected respondents by `ref` (D168); unknown ones are ignored. Their links, drafts and
 * submissions stay. Appends `roster.changed` and, when everyone still expected has answered,
 * `roster.completed`.
 */
export function removeRespondents(
  db: LedgerDb,
  input: {
    readonly artifactId: string;
    readonly refs: readonly string[];
    readonly actor: Actor;
    readonly now: string;
  },
): { readonly removed: readonly string[] } {
  const removed: string[] = [];
  for (const ref of new Set(input.refs)) {
    const result = db.run(
      "DELETE FROM roster_entry WHERE artifact_id = ? AND ref = ?",
      input.artifactId,
      ref,
    );
    if (result.changes > 0) removed.push(ref);
  }
  if (removed.length > 0) changed(db, input, { added: [], renamed: [], relinked: [], removed });
  return { removed };
}

/** Appends `roster.changed` after settling the roster, so the event says where it stands. */
function changed(
  db: LedgerDb,
  input: { readonly artifactId: string; readonly actor: Actor; readonly now: string },
  change: {
    readonly added: readonly { ref: string; name?: string }[];
    readonly renamed: readonly { ref: string; name?: string }[];
    readonly relinked: readonly string[];
    readonly removed: readonly string[];
  },
): void {
  db.run(
    "INSERT OR IGNORE INTO roster_state (artifact_id, round, round_cursor, round_started_at, complete) VALUES (?, 1, 0, '', 0)",
    input.artifactId,
  );
  // The change first, then a completion it caused: a reader of events sees the roster's story
  // in order (removing the last one who hadn't answered completes the round).
  const before = stateOf(db, input.artifactId);
  const list = standings(db, input.artifactId, before);
  appendEvent(db, {
    artifactId: input.artifactId,
    type: "roster.changed",
    actor: input.actor,
    payload: {
      round: before.round,
      respondents: list.length,
      complete: completeOf(list),
      ...(change.added.length > 0 ? { added: change.added } : {}),
      ...(change.renamed.length > 0 ? { renamed: change.renamed } : {}),
      ...(change.relinked.length > 0 ? { relinked: change.relinked } : {}),
      ...(change.removed.length > 0 ? { removed: change.removed } : {}),
    },
  });
  settleRoster(db, input.artifactId, input.now);
}

/** The viewer a page acts as, as the roster sees them. */
export interface RosterViewer {
  readonly id: string;
  readonly kind: ViewerKind;
  readonly name?: string;
  readonly verified?: boolean;
}

function peerOf(artifactId: string, viewer: RosterViewer, self: boolean): Peer {
  return {
    key: peerKey(artifactId, viewer.id),
    self,
    kind: viewer.kind,
    ...(viewer.name !== undefined ? { name: viewer.name } : {}),
    ...(viewer.verified !== undefined ? { verified: viewer.verified } : {}),
  };
}

/**
 * The roster as one page may see it (CO-03, CO-07): the viewer's own entry always (when they are
 * expected), the counts under `counts` and `names`, every respondent under `names`, and everything
 * for the artifact's owner. Never another viewer's `ref`, email or viewer ID.
 */
export function rosterForPage(
  db: LedgerDb,
  input: {
    readonly artifactId: string;
    readonly viewerId: string;
    readonly owner: boolean;
    readonly viewerOf: (viewerId: string) => RosterViewer;
  },
): RosterForPage {
  const [one] = rosterForPages(db, {
    artifactId: input.artifactId,
    pages: [{ viewerId: input.viewerId, owner: input.owner }],
    viewerOf: input.viewerOf,
  });
  return one as RosterForPage;
}

/**
 * The roster as each of several pages may see it, from one read of the standings (Opus review 9):
 * a change heard by many following pages costs one roster read, not one per page.
 */
export function rosterForPages(
  db: LedgerDb,
  input: {
    readonly artifactId: string;
    readonly pages: readonly { readonly viewerId: string; readonly owner: boolean }[];
    readonly viewerOf: (viewerId: string) => RosterViewer;
  },
): RosterForPage[] {
  const state = stateOf(db, input.artifactId);
  const list = standings(db, input.artifactId, state);
  const visibility = teamVisibility(db, input.artifactId);
  const viewers = new Map<string, RosterViewer>();
  const viewerOf = (viewerId: string): RosterViewer => {
    let viewer = viewers.get(viewerId);
    if (!viewer) {
      viewer = input.viewerOf(viewerId);
      viewers.set(viewerId, viewer);
    }
    return viewer;
  };
  const counts = countsOf(list);
  const complete = completeOf(list);
  const byViewer = new Map(list.map((one) => [one.entry.viewer_id, one]));
  return input.pages.map((page) => {
    const project = (one: Standing): RespondentForPage => {
      const viewer = viewerOf(one.entry.viewer_id);
      return {
        ...peerOf(
          input.artifactId,
          // The roster's name is the one the host gave; the viewer row keeps the same.
          { ...viewer, ...(one.entry.name !== null ? { name: one.entry.name } : {}) },
          one.entry.viewer_id === page.viewerId,
        ),
        status: one.status,
        ...(one.openedAt !== undefined ? { openedAt: one.openedAt } : {}),
        ...(one.submission ? { submittedAt: one.submission.at } : {}),
      };
    };
    const own = byViewer.get(page.viewerId);
    const sees = page.owner ? "names" : visibility;
    return {
      visibility,
      owner: page.owner,
      round: state.round,
      ...(own ? { self: project(own) } : {}),
      ...(sees !== "private" ? { counts, complete } : {}),
      ...(sees === "names" ? { respondents: list.map(project) } : {}),
    };
  });
}

/** The roster's events' types: pages never see them (they name refs and emails, D168). */
export const ROSTER_EVENTS: ReadonlySet<string> = new Set(["roster.changed", "roster.completed"]);
