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
export const CHOICE: RegExp = /^review\.(.+)\.choice$/;

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
        const field = draftFields[id] as SnapshotField;
        // The trusted Choose keeps the candidate's label as the field's (D113).
        return match && typeof field.value === "string"
          ? [
              {
                reviewSetId: match[1] as string,
                candidateId: field.value,
                ...(field.label !== undefined ? { label: field.label } : {}),
              },
            ]
          : [];
      }),
    comments: [],
    orphaned: snapshot.orphaned,
    actions: snapshot.actions ?? [],
    signals: snapshot.signals,
    ...(snapshot.signalsOmitted !== undefined ? { signalsOmitted: snapshot.signalsOmitted } : {}),
    ...(snapshot.signalsCompacted ? { signalsCompacted: true as const } : {}),
  };
}

/**
 * Text from viewers and hosts is data in the Markdown, never structure (Claude review finding 4):
 * labels and string values are JSON strings, identifiers and JSON are code spans whose delimiters
 * outrun any backticks inside, multi-line text sits in a fence longer than any backtick run in it,
 * and everything else is folded onto one line.
 */
const LINE_BREAKS = /\r\n|\r|\n|\u2028|\u2029/;

/** Control characters and line separators as spaces: the text stays on its line. */
function oneLine(text: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: replacing them is the point.
  return text.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, " ");
}

/** The longest run of backticks in `text`. */
function longestBacktickRun(text: string): number {
  let longest = 0;
  for (const run of text.match(/`+/g) ?? []) longest = Math.max(longest, run.length);
  return longest;
}

/** `text` as an inline code span that nothing inside can close. */
export function code(text: string): string {
  const line = oneLine(text);
  const ticks = "`".repeat(longestBacktickRun(line) + 1);
  const pad = line.startsWith("`") || line.endsWith("`") || line.trim() === "" ? " " : "";
  return `${ticks}${pad}${line}${pad}${ticks}`;
}

/** `text` as a JSON string: quoted, with its line breaks and controls escaped. */
function quoted(text: string): string {
  return oneLine(JSON.stringify(text));
}

/** A value as one Markdown line, or a fenced block for text with line breaks. */
function markdownValue(value: unknown): string {
  if (typeof value === "string") {
    if (!LINE_BREAKS.test(value)) return quoted(value);
    const fence = "`".repeat(Math.max(3, longestBacktickRun(value) + 1));
    const body = value
      .split(LINE_BREAKS)
      .map((line) => `  ${line}`)
      .join("\n");
    return `\n\n  ${fence}text\n${body}\n  ${fence}\n`;
  }
  return code(JSON.stringify(value));
}

/** A field's name: its label as a JSON string, then its ID as code. */
function fieldName(id: string, label: string | undefined): string {
  return label !== undefined ? `${quoted(label)} (${code(id)})` : code(id);
}

function fieldLines(fields: Readonly<Record<string, SnapshotField>>): string[] {
  const ids = Object.keys(fields).sort();
  if (ids.length === 0) return ["- (none)"];
  return ids.map((id) => {
    const field = fields[id] as SnapshotField;
    return `- ${fieldName(id, field.label)}: ${markdownValue(field.value)}`;
  });
}

/**
 * Results as Markdown for agents (ROUND-2 §1.1): a header with the IDs, then answers by label,
 * the artifact state, choices, comments with their crop paths, actions, signals, and what didn't
 * carry over. Every section is present, with "(none)" when empty, so an agent never wonders
 * whether a section was dropped. Viewers' and hosts' text is rendered as data, so no answer,
 * label or reason can forge a section.
 */
export function resultsMarkdown(results: Results, snapshot: Snapshot): string {
  const { submission } = results;
  const viewer = submission.viewer.name ?? submission.viewer.ref ?? submission.viewer.id;
  const signalNotes = [
    ...(results.signalsOmitted !== undefined
      ? [`- (${results.signalsOmitted} older signals of this view left out)`]
      : []),
    ...(results.signalsCompacted ? ["- (some signals may have been removed by compaction)"] : []),
  ];
  const lines = [
    `# ${oneLine(results.artifact.title)}: submission ${submission.id}`,
    "",
    `- Artifact: ${results.artifact.id}${results.artifact.family ? ` (${code(results.artifact.family)})` : ""}`,
    `- Version: ${submission.versionId} (version ${submission.version})${submission.staleView ? `, a stale view: version ${submission.latestVersion ?? "?"} was the latest` : ""}`,
    `- View: ${submission.viewId}, channel ${submission.channel}, viewer ${quoted(viewer)} (${submission.viewer.id})`,
    `- Submitted: ${submission.at}, epoch ${submission.epoch}${submission.previous ? ` (after ${submission.previous})` : ""}, policy ${submission.policy.policy}${submission.policy.policy === "once" ? ` ${submission.policy.scope ?? "per-artifact"}` : ""}`,
    `- Draft revision ${submission.draftRevision}${submission.stateRevision !== undefined ? `, artifact state revision ${submission.stateRevision}` : ""}, digest ${submission.digest}`,
    `- Delivery: ${submission.delivery}${submission.deliveries.length > 0 ? ` (${submission.deliveries.map((delivery) => `${delivery.owner === "" ? "built-in" : quoted(delivery.owner)}: ${delivery.state}${delivery.reason ? `, ${quoted(delivery.reason)}` : ""}`).join("; ")})` : ""}`,
    ...(results.artifact.links.length > 0
      ? [
          `- Links: ${results.artifact.links.map((link) => `${code(link.rel)} ${code(link.artifact)}`).join(", ")}`,
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
            `- ${code(choice.reviewSetId)}: ${quoted(choice.candidateId)}${choice.label ? ` (${quoted(choice.label)})` : ""}`,
        )
      : ["- (none)"]),
    "",
    "## Comments",
    ...(results.comments.length > 0
      ? results.comments.flatMap((comment) => [
          `- Thread ${comment.threadId} (${comment.status}), crop ${code(comment.crop.path)}${comment.anchor.reviewId ? `, on ${code(comment.anchor.reviewId)}` : ""}${comment.anchor.page ? `, page ${code(comment.anchor.page)}` : ""}`,
          ...comment.messages.map(
            (message) =>
              `  - ${quoted(message.author.name ?? message.author.id)} at ${message.at}: ${quoted(message.text)}`,
          ),
        ])
      : ["- (none)"]),
    "",
    "## Actions run in this view",
    ...(results.actions.length > 0
      ? results.actions.map(
          (run) => `- ${code(run.action)}: ${run.status} at ${run.at} (run ${run.runId})`,
        )
      : ["- (none)"]),
    "",
    "## Signals raised in this view",
    ...(results.signals.length > 0 || signalNotes.length > 0
      ? [
          ...signalNotes,
          ...results.signals.map(
            (signal) =>
              `- ${code(signal.name)} at ${signal.at}${signal.payload !== undefined ? `: ${code(JSON.stringify(signal.payload))}` : ""}`,
          ),
        ]
      : ["- (none)"]),
    "",
    "## Not carried over from an earlier version",
    ...(results.orphaned.length > 0
      ? results.orphaned.map(
          (orphan) =>
            `- ${fieldName(orphan.id, orphan.label)} from version ${orphan.fromVersion}: ${markdownValue(orphan.value)}`,
        )
      : ["- (none)"]),
    "",
  ];
  return lines.join("\n");
}
