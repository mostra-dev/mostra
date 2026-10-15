/**
 * Results (IN-11, INTERFACES §8): the complete submission as JSON and as Markdown for agents.
 * Everything comes from the immutable submission row, its snapshot and the version it names, plus
 * the deliveries' current states; never from the live draft (IN-06).
 */
import type { ArtifactLink, ArtifactManifest, DeliveryStatus, Results } from "@mostra/protocol";
import { createDiagnostic, RpcError } from "@mostra/protocol";
import type { LedgerDb } from "../ledger/index.ts";
import {
  deliveriesOf,
  overallDelivery,
  type Snapshot,
  type SnapshotField,
  type SubmissionRow,
} from "./submissions.ts";

/** The field ID a review set's choice is kept under (D65): `review.<set>.choice`. */
const CHOICE = /^review\.(.+)\.choice$/;

/**
 * Nests dotted field IDs into objects (D52): `reply.m1` becomes `{ reply: { m1 } }`. A value never
 * gets keys merged into it: when `a` holds a value and `a.b` exists too, `a.b` stays a literal key
 * beside it, so no answer is lost or altered.
 */
export function nestFields(
  fields: Readonly<Record<string, SnapshotField>>,
): Record<string, unknown> {
  // Objects without a prototype, written with defineProperty, so a field ID such as `__proto__`
  // is an ordinary key.
  const make = (): Record<string, unknown> => Object.create(null) as Record<string, unknown>;
  const set = (node: Record<string, unknown>, key: string, value: unknown): void => {
    Object.defineProperty(node, key, {
      value,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  };
  const root = make();
  const made = new Set<object>([root]);
  for (const id of Object.keys(fields).sort()) {
    const value = (fields[id] as SnapshotField).value;
    const parts = id.split(".");
    let node = root;
    let index = 0;
    for (; index < parts.length - 1; index++) {
      const key = parts[index] as string;
      const next = Object.hasOwn(node, key) ? node[key] : undefined;
      if (next === undefined) {
        const child = make();
        made.add(child);
        set(node, key, child);
        node = child;
      } else if (typeof next === "object" && next !== null && made.has(next)) {
        node = next as Record<string, unknown>;
      } else {
        break;
      }
    }
    const rest = parts.slice(index).join(".");
    if (!Object.hasOwn(node, rest)) set(node, rest, value);
    else set(root, id, value);
  }
  return root;
}

function notFound(message: string): RpcError {
  return new RpcError(createDiagnostic("MOSTRA_SUBMIT_NOT_FOUND", { message }));
}

/**
 * The submission an artifact's results are read from: the one named, or the latest. Throws
 * `MOSTRA_SUBMIT_NOT_FOUND` when there is none.
 */
export function submissionFor(
  db: LedgerDb,
  artifactId: string,
  submissionId: string | undefined,
): SubmissionRow {
  const row =
    submissionId === undefined
      ? db.get<SubmissionRow>(
          "SELECT * FROM submission WHERE artifact_id = ? ORDER BY position DESC LIMIT 1",
          artifactId,
        )
      : db.get<SubmissionRow>(
          "SELECT * FROM submission WHERE id = ? AND artifact_id = ?",
          submissionId,
          artifactId,
        );
  if (!row) {
    throw notFound(
      submissionId === undefined
        ? `The artifact ${artifactId} has no submission yet.`
        : `The artifact ${artifactId} has no submission ${submissionId}.`,
    );
  }
  return row;
}

/** The complete results of a submission (INTERFACES §8). */
export function buildResults(db: LedgerDb, row: SubmissionRow): Results {
  const snapshot = JSON.parse(row.snapshot_json) as Snapshot;
  const version = db.get<{ manifest_json: string }>(
    "SELECT manifest_json FROM version WHERE id = ?",
    row.version_id,
  );
  const manifest = version ? (JSON.parse(version.manifest_json) as ArtifactManifest) : undefined;
  const artifactRow = db.get<{ title: string; family: string | null; links_json: string }>(
    "SELECT title, family, links_json FROM artifact WHERE id = ?",
    row.artifact_id,
  );
  const family = manifest ? manifest.family : (artifactRow?.family ?? undefined);
  const links = manifest
    ? (manifest.links ?? [])
    : (JSON.parse(artifactRow?.links_json ?? "[]") as ArtifactLink[]);
  const deliveries: DeliveryStatus[] = deliveriesOf(db, row.id);
  const draftFields = snapshot.draft.fields;
  const stateFields = snapshot.state?.fields;
  const describe = (id: string, field: SnapshotField, scope: "viewer" | "artifact") => ({
    id,
    ...(field.label !== undefined ? { label: field.label } : {}),
    ...(field.required !== undefined ? { required: field.required } : {}),
    ...(field.sensitive ? { sensitive: true } : {}),
    scope,
  });
  return {
    artifact: {
      id: row.artifact_id,
      title: manifest?.title ?? artifactRow?.title ?? row.artifact_id,
      ...(manifest?.description !== undefined ? { description: manifest.description } : {}),
      ...(family !== undefined && family !== null ? { family } : {}),
      links,
    },
    submission: {
      id: row.id,
      at: row.created_at,
      epoch: row.epoch,
      ...(row.previous_id !== null ? { previous: row.previous_id } : {}),
      policy: snapshot.policy,
      channel: row.channel,
      viewer: snapshot.viewer,
      versionId: row.version_id,
      version: snapshot.version,
      viewId: row.view_id,
      staleView: row.stale_view === 1,
      ...(row.latest_version_number !== null ? { latestVersion: row.latest_version_number } : {}),
      draftRevision: String(row.draft_revision),
      ...(row.state_revision !== null ? { stateRevision: String(row.state_revision) } : {}),
      digest: row.digest,
      delivery: overallDelivery(deliveries),
      deliveries,
    },
    answers: nestFields(draftFields),
    fields: [
      ...Object.keys(draftFields)
        .sort()
        .map((id) => describe(id, draftFields[id] as SnapshotField, "viewer")),
      ...Object.keys(stateFields ?? {})
        .sort()
        .map((id) =>
          describe(
            id,
            (stateFields as Record<string, SnapshotField>)[id] as SnapshotField,
            "artifact",
          ),
        ),
    ],
    ...(stateFields ? { state: nestFields(stateFields) } : {}),
    choices: Object.keys(draftFields)
      .sort()
      .flatMap((id) => {
        const match = CHOICE.exec(id);
        const value = (draftFields[id] as SnapshotField).value;
        return match && typeof value === "string"
          ? [{ reviewSetId: match[1] as string, candidateId: value }]
          : [];
      }),
    comments: [],
    orphaned: snapshot.orphaned,
    actions: [],
    signals: snapshot.signals,
  };
}

/** A value as one Markdown line, or an indented block for text with line breaks. */
function markdownValue(value: unknown): string {
  if (typeof value === "string") {
    if (!value.includes("\n")) return JSON.stringify(value);
    const fence = value.includes("```") ? "````" : "```";
    return `\n\n  ${fence}text\n${value
      .split("\n")
      .map((line) => `  ${line}`)
      .join("\n")}\n  ${fence}\n`;
  }
  return `\`${JSON.stringify(value)}\``;
}

function fieldLines(fields: Readonly<Record<string, SnapshotField>>): string[] {
  const ids = Object.keys(fields).sort();
  if (ids.length === 0) return ["- (none)"];
  return ids.map((id) => {
    const field = fields[id] as SnapshotField;
    const name = field.label !== undefined ? `${field.label} (\`${id}\`)` : `\`${id}\``;
    return `- ${name}: ${markdownValue(field.value)}`;
  });
}

/**
 * Results as Markdown for agents (ROUND-2 §1.1): a header with the IDs, then answers by label,
 * the artifact state, choices, comments with their crop paths, actions, signals, and what didn't
 * carry over. Every section is present, with "(none)" when empty, so an agent never wonders
 * whether a section was dropped.
 */
export function resultsMarkdown(results: Results, snapshot: Snapshot): string {
  const { submission } = results;
  const viewer = submission.viewer.name ?? submission.viewer.ref ?? submission.viewer.id;
  const lines = [
    `# ${results.artifact.title}: submission ${submission.id}`,
    "",
    `- Artifact: ${results.artifact.id}${results.artifact.family ? ` (${results.artifact.family})` : ""}`,
    `- Version: ${submission.versionId} (version ${submission.version})${submission.staleView ? `, a stale view: version ${submission.latestVersion ?? "?"} was the latest` : ""}`,
    `- View: ${submission.viewId}, channel ${submission.channel}, viewer ${viewer} (${submission.viewer.id})`,
    `- Submitted: ${submission.at}, epoch ${submission.epoch}${submission.previous ? ` (after ${submission.previous})` : ""}, policy ${submission.policy.policy}${submission.policy.policy === "once" ? ` ${submission.policy.scope ?? "per-artifact"}` : ""}`,
    `- Draft revision ${submission.draftRevision}${submission.stateRevision !== undefined ? `, artifact state revision ${submission.stateRevision}` : ""}, digest ${submission.digest}`,
    `- Delivery: ${submission.delivery}${submission.deliveries.length > 0 ? ` (${submission.deliveries.map((delivery) => `${delivery.owner}: ${delivery.state}${delivery.reason ? `, ${delivery.reason}` : ""}`).join("; ")})` : ""}`,
    ...(results.artifact.links.length > 0
      ? [
          `- Links: ${results.artifact.links.map((link) => `${link.rel} ${link.artifact}`).join(", ")}`,
        ]
      : []),
    "",
    "## Answers",
    ...fieldLines(snapshot.draft.fields),
    "",
    "## Artifact state",
    ...(snapshot.state ? fieldLines(snapshot.state.fields) : ["- (none)"]),
    "",
    "## Choices",
    ...(results.choices.length > 0
      ? results.choices.map(
          (choice) =>
            `- ${choice.reviewSetId}: ${choice.candidateId}${choice.label ? ` (${choice.label})` : ""}`,
        )
      : ["- (none)"]),
    "",
    "## Comments",
    ...(results.comments.length > 0
      ? results.comments.flatMap((comment) => [
          `- Thread ${comment.threadId} (${comment.status}), crop ${comment.crop.path}${comment.anchor.reviewId ? `, on \`${comment.anchor.reviewId}\`` : ""}${comment.anchor.page ? `, page ${comment.anchor.page}` : ""}`,
          ...comment.messages.map(
            (message) =>
              `  - ${message.author.name ?? message.author.id} at ${message.at}: ${JSON.stringify(message.text)}`,
          ),
        ])
      : ["- (none)"]),
    "",
    "## Actions run in this view",
    ...(results.actions.length > 0
      ? results.actions.map(
          (run) => `- ${run.action}: ${run.status} at ${run.at} (run ${run.runId})`,
        )
      : ["- (none)"]),
    "",
    "## Signals raised in this view",
    ...(results.signals.length > 0
      ? results.signals.map(
          (signal) =>
            `- ${signal.name} at ${signal.at}${signal.payload !== undefined ? `: \`${JSON.stringify(signal.payload)}\`` : ""}`,
        )
      : ["- (none)"]),
    "",
    "## Not carried over from an earlier version",
    ...(results.orphaned.length > 0
      ? results.orphaned.map(
          (orphan) =>
            `- ${orphan.label !== undefined ? `${orphan.label} (\`${orphan.id}\`)` : `\`${orphan.id}\``} from version ${orphan.fromVersion}: ${markdownValue(orphan.value)}`,
        )
      : ["- (none)"]),
    "",
  ];
  return lines.join("\n");
}
