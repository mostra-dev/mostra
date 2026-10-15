/**
 * The outbox (IN-12, H-04, D105; FAILURE_MODEL §4): delivers each submission, after it is
 * durable, to every host it was enqueued for, through the host's `submissions` port, and mirrors
 * drafts to hosts with a `drafts` port. Each host's deliveries go out one at a time in submission
 * order; a retryable failure keeps the head pending with backoff (1 s doubling to 5 min) and a host
 * that isn't connected gets its deliveries when it registers again, in order. A host's terminal
 * answer is recorded once and never retried. The delivery row is the state: after a crash, a
 * delivery the host acknowledged but Mostra didn't record goes out again with the same ID.
 */
import {
  type DeliveryState,
  type DraftMirror,
  MAX_LINE_LENGTH,
  portDraftsMirrorMethod,
  portSubmissionsDeliverMethod,
  type SubmissionEnvelope,
  type SubmissionsDeliverResult,
} from "@mostra/protocol";
import type { Faults } from "../faults.ts";
import type { Ledger, LedgerDb } from "../ledger/index.ts";
import type { Log } from "../log.ts";
import { appendEvent } from "./events.ts";
import { documentFor, liveFields } from "./fields.ts";
import { buildResults } from "./results.ts";
import { BUILT_IN_OWNER, type SubmissionRow } from "./submissions.ts";

/** How long a host has to answer one port call (FAILURE_MODEL §9). */
export const PORT_CALL_TIMEOUT_MS = 30_000;

/** Room for the JSON-RPC request around an envelope (`jsonrpc`, `id`, `method`, newline). */
const ENVELOPE_FRAME_SLACK = 1024;

/** The first retry's delay; each later one doubles, up to {@link MAX_BACKOFF_MS}. */
export const FIRST_BACKOFF_MS = 1_000;

/** The longest delay between retries (FAILURE_MODEL §4). */
export const MAX_BACKOFF_MS: number = 5 * 60_000;

/** The delay before retry number `attempts` + 1. */
export function backoffMs(attempts: number): number {
  return Math.min(MAX_BACKOFF_MS, FIRST_BACKOFF_MS * 2 ** Math.max(0, attempts - 1));
}

/** The connections that registered ports, as the outbox sees them. */
export interface HostConnections {
  /** The connections that registered `port`, newest last, with their hosts' client names. */
  registrants(port: string): readonly { readonly session: number; readonly owner: string }[];
  /** Calls a port method on one connection; rejects on a transport failure or the timeout. */
  call(session: number, method: string, params: unknown, timeoutMs: number): Promise<unknown>;
}

/** Options for {@link Outbox}. */
export interface OutboxOptions {
  readonly ledger: Ledger;
  readonly log: Log;
  readonly hosts: HostConnections;
  /** The hosts that always provide the submissions port (`HomeConfig.ports`, D105). */
  readonly expected: () => readonly string[];
  readonly faults: Faults;
  /** The clock (tests move it). */
  readonly now?: () => number;
  /** How long a host has to answer a port call; default {@link PORT_CALL_TIMEOUT_MS}. */
  readonly portTimeoutMs?: number;
}

interface DeliveryRow {
  readonly id: string;
  readonly submission_id: string;
  readonly position: number;
  readonly port_owner: string;
  readonly state: DeliveryState;
  readonly attempts: number;
  readonly next_attempt_at: string | null;
  readonly last_error_json: string | null;
}

type Outcome =
  | { readonly kind: "delivered"; readonly reason?: string }
  | {
      readonly kind: "terminal";
      readonly state: "rejected" | "undeliverable";
      readonly reason: string;
    }
  | { readonly kind: "retry"; readonly error: string };

/** The outbox of one instance. */
export class Outbox {
  readonly #options: OutboxOptions;
  readonly #now: () => number;
  readonly #running = new Set<string>();
  readonly #again = new Set<string>();
  readonly #timers = new Map<string, ReturnType<typeof setTimeout>>();
  readonly #mirroring = new Map<string, { dirty: boolean }>();
  #unsubscribe: (() => void) | undefined;
  #stopped = false;

  constructor(options: OutboxOptions) {
    this.#options = options;
    this.#now = options.now ?? Date.now;
  }

  /** The hosts a submission made now is delivered to: registered or expected (D105). */
  owners(): string[] {
    const registered = this.#options.hosts
      .registrants("submissions")
      .map((registrant) => registrant.owner);
    return [...new Set([...registered, ...this.#options.expected()])].sort();
  }

  /** Starts delivering: every commit may have enqueued something. */
  start(): void {
    this.#unsubscribe = this.#options.ledger.onCommit(() => this.kick());
    this.kick();
  }

  /** Stops delivering; a call in flight finishes but nothing new starts. */
  stop(): void {
    this.#stopped = true;
    this.#unsubscribe?.();
    for (const timer of this.#timers.values()) clearTimeout(timer);
    this.#timers.clear();
  }

  /**
   * A host registered its submissions port (again): its pending deliveries are due now, and replay
   * in submission order (FAILURE_MODEL §4).
   */
  registered(owner: string): void {
    const now = new Date(this.#now()).toISOString();
    this.#options.ledger.write((db) =>
      db.run(
        "UPDATE delivery SET next_attempt_at = ? WHERE port_owner = ? AND state = 'pending'",
        now,
        owner,
      ),
    );
    this.kick();
  }

  /** Looks for work for every host with pending deliveries. */
  kick(): void {
    if (this.#stopped) return;
    const owners = this.#options.ledger.read((db) =>
      db.all<{ port_owner: string }>(
        "SELECT DISTINCT port_owner FROM delivery WHERE state = 'pending'",
      ),
    );
    for (const { port_owner: owner } of owners) void this.#pump(owner);
  }

  /** Each host's deliveries by state, for `instance/status`. */
  counts(): {
    owner: string;
    connected: boolean;
    pending: number;
    delivered: number;
    rejected: number;
    undeliverable: number;
  }[] {
    const rows = this.#options.ledger.read((db) =>
      db.all<{ port_owner: string; state: DeliveryState; count: number }>(
        "SELECT port_owner, state, COUNT(*) AS count FROM delivery GROUP BY port_owner, state",
      ),
    );
    const connected = new Set(
      this.#options.hosts.registrants("submissions").map((registrant) => registrant.owner),
    );
    const byOwner = new Map<
      string,
      {
        owner: string;
        connected: boolean;
        pending: number;
        delivered: number;
        rejected: number;
        undeliverable: number;
      }
    >();
    for (const row of rows) {
      const entry = byOwner.get(row.port_owner) ?? {
        owner: row.port_owner,
        connected: row.port_owner === BUILT_IN_OWNER || connected.has(row.port_owner),
        pending: 0,
        delivered: 0,
        rejected: 0,
        undeliverable: 0,
      };
      entry[row.state] = row.count;
      byOwner.set(row.port_owner, entry);
    }
    return [...byOwner.values()].sort((a, b) => (a.owner < b.owner ? -1 : 1));
  }

  async #pump(owner: string): Promise<void> {
    if (this.#running.has(owner)) {
      this.#again.add(owner);
      return;
    }
    this.#running.add(owner);
    try {
      do {
        this.#again.delete(owner);
        while (!this.#stopped && (await this.#step(owner))) {
          // One delivery at a time, in order.
        }
      } while (this.#again.has(owner) && !this.#stopped);
    } catch (error) {
      this.#options.log.error("outbox.failed", { owner, error });
    } finally {
      this.#running.delete(owner);
    }
  }

  /** Delivers the owner's next pending delivery; `false` when there is nothing to do now. */
  async #step(owner: string): Promise<boolean> {
    const { ledger, hosts, log, faults } = this.#options;
    const head = ledger.read((db) =>
      db.get<DeliveryRow>(
        "SELECT * FROM delivery WHERE port_owner = ? AND state = 'pending' ORDER BY position LIMIT 1",
        owner,
      ),
    );
    if (!head) return false;
    if (owner === BUILT_IN_OWNER) {
      this.#record(head, { kind: "delivered" });
      return true;
    }
    const due = head.next_attempt_at === null ? 0 : Date.parse(head.next_attempt_at);
    const wait = due - this.#now();
    if (wait > 0) {
      this.#schedule(owner, wait);
      return false;
    }
    const registrant = hosts
      .registrants("submissions")
      .filter((entry) => entry.owner === owner)
      .at(-1);
    // Not connected: its deliveries wait for it to register again, and the viewer learns that
    // the submission is waiting (IN-13).
    if (!registrant) {
      if (head.last_error_json === null) this.#waiting(head, "The host isn't connected.");
      return false;
    }
    const attempt = head.attempts + 1;
    const envelope = ledger.write((db) => {
      db.run(
        "UPDATE delivery SET attempts = ?, updated_at = ? WHERE id = ?",
        attempt,
        new Date(this.#now()).toISOString(),
        head.id,
      );
      const submission = db.get<SubmissionRow>(
        "SELECT * FROM submission WHERE id = ?",
        head.submission_id,
      ) as SubmissionRow;
      const envelope: SubmissionEnvelope = {
        kind: "submission",
        deliveryId: head.id,
        submissionId: submission.id,
        artifactId: submission.artifact_id,
        attempt,
        results: buildResults(db, submission),
      };
      return envelope;
    });
    let outcome: Outcome;
    // An envelope no host could read would be retried forever and hold back every later delivery
    // to this host: it is undeliverable, with the reason, and never sent (Claude review finding 2).
    const length = JSON.stringify(envelope).length + ENVELOPE_FRAME_SLACK;
    if (length > MAX_LINE_LENGTH) {
      log.error("outbox.too_large", { owner, deliveryId: head.id, length });
      this.#record(
        { ...head, attempts: attempt },
        {
          kind: "terminal",
          state: "undeliverable",
          reason: `too-large: the submission's envelope is ${length} characters; one protocol message carries ${MAX_LINE_LENGTH}`,
        },
      );
      return true;
    }
    try {
      const answer = await hosts.call(
        registrant.session,
        portSubmissionsDeliverMethod.method,
        envelope,
        this.#options.portTimeoutMs ?? PORT_CALL_TIMEOUT_MS,
      );
      const parsed = portSubmissionsDeliverMethod.result.safeParse(answer);
      outcome = parsed.success
        ? outcomeOf(parsed.data)
        : {
            kind: "retry",
            error: "The host's answer doesn't match port/submissions.deliver's result.",
          };
    } catch (error) {
      outcome = { kind: "retry", error: (error as Error).message };
    }
    // A crash here, after the host answered and before Mostra records it, redelivers the same
    // delivery ID on the next start (FAILURE_MODEL §4).
    faults.at("deliver:after-answer");
    this.#record({ ...head, attempts: attempt }, outcome);
    if (outcome.kind === "retry") {
      log.warn("outbox.retry", { owner, deliveryId: head.id, attempt, error: outcome.error });
      return false;
    }
    return true;
  }

  #schedule(owner: string, delayMs: number): void {
    if (this.#timers.has(owner) || this.#stopped) return;
    const timer = setTimeout(() => {
      this.#timers.delete(owner);
      void this.#pump(owner);
    }, delayMs);
    timer.unref?.();
    this.#timers.set(owner, timer);
  }

  #record(head: DeliveryRow, outcome: Outcome): void {
    const now = new Date(this.#now()).toISOString();
    const { ledger } = this.#options;
    ledger.write((db) => {
      const current = db.get<{ state: DeliveryState }>(
        "SELECT state FROM delivery WHERE id = ?",
        head.id,
      );
      if (current?.state !== "pending") return;
      const submission = db.get<{ artifact_id: string }>(
        "SELECT artifact_id FROM submission WHERE id = ?",
        head.submission_id,
      ) as { artifact_id: string };
      if (outcome.kind === "retry") {
        const first = db.get<{ last_error_json: string | null }>(
          "SELECT last_error_json FROM delivery WHERE id = ?",
          head.id,
        );
        db.run(
          "UPDATE delivery SET next_attempt_at = ?, last_error_json = ?, updated_at = ? WHERE id = ?",
          new Date(this.#now() + backoffMs(head.attempts)).toISOString(),
          JSON.stringify({ message: outcome.error.slice(0, 500), at: now }),
          now,
          head.id,
        );
        if (first?.last_error_json === null) {
          appendRetrying(db, submission.artifact_id, head, outcome.error);
        }
        return;
      }
      const state = outcome.kind === "delivered" ? "delivered" : outcome.state;
      const reason = outcome.reason ?? null;
      db.run(
        "UPDATE delivery SET state = ?, reason = ?, next_attempt_at = NULL, updated_at = ? WHERE id = ?",
        state,
        reason,
        now,
        head.id,
      );
      appendEvent(db, {
        artifactId: submission.artifact_id,
        type: `submission.${state}`,
        actor:
          head.port_owner === BUILT_IN_OWNER
            ? { kind: "mostra" }
            : { kind: "host", id: head.port_owner },
        causation: { submissionId: head.submission_id },
        payload: {
          submissionId: head.submission_id,
          deliveryId: head.id,
          owner: head.port_owner,
          attempts: head.attempts,
          ...(reason !== null ? { reason } : {}),
        },
      });
    });
  }

  /**
   * Records that a delivery waits for a host that isn't connected, once: the viewer sees "Pending
   * delivery" instead of a submission that looks merely slow (IN-13, D47).
   */
  #waiting(head: DeliveryRow, reason: string): void {
    const now = new Date(this.#now()).toISOString();
    this.#options.ledger.write((db) => {
      const current = db.get<{ state: DeliveryState; last_error_json: string | null }>(
        "SELECT state, last_error_json FROM delivery WHERE id = ?",
        head.id,
      );
      if (current?.state !== "pending" || current.last_error_json !== null) return;
      db.run(
        "UPDATE delivery SET last_error_json = ?, updated_at = ? WHERE id = ?",
        JSON.stringify({ message: reason, at: now }),
        now,
        head.id,
      );
      const submission = db.get<{ artifact_id: string }>(
        "SELECT artifact_id FROM submission WHERE id = ?",
        head.submission_id,
      ) as { artifact_id: string };
      appendRetrying(db, submission.artifact_id, head, reason);
    });
  }

  /**
   * Mirrors a viewer's draft to every connection with a `drafts` port (D105): best effort, the
   * latest revision only, coalesced while one is in flight, never retried. A mirror is labelled
   * `kind: "draft"` and never goes through the submissions port (IN-06).
   */
  mirror(artifactId: string, viewerId: string): void {
    for (const registrant of this.#options.hosts.registrants("drafts")) {
      const key = `${registrant.session} ${artifactId} ${viewerId}`;
      const running = this.#mirroring.get(key);
      if (running) {
        running.dirty = true;
        continue;
      }
      const entry = { dirty: false };
      this.#mirroring.set(key, entry);
      void (async () => {
        try {
          do {
            entry.dirty = false;
            const mirror = this.#options.ledger.read((db): DraftMirror | undefined => {
              const draft = documentFor(db, artifactId, viewerId);
              if (!draft) return undefined;
              const fields = liveFields(db, draft.id);
              return {
                kind: "draft",
                artifactId,
                viewerId,
                epoch: draft.epoch,
                revision: String(draft.revision),
                fields: Object.fromEntries(
                  Object.entries(fields).map(([id, field]) => [id, field.value]),
                ),
              };
            });
            if (!mirror || this.#stopped) break;
            try {
              await this.#options.hosts.call(
                registrant.session,
                portDraftsMirrorMethod.method,
                mirror,
                this.#options.portTimeoutMs ?? PORT_CALL_TIMEOUT_MS,
              );
            } catch (error) {
              this.#options.log.warn("outbox.mirror_failed", {
                artifactId,
                owner: registrant.owner,
                error: (error as Error).message,
              });
            }
          } while (entry.dirty && !this.#stopped);
        } finally {
          this.#mirroring.delete(key);
        }
      })();
    }
  }
}

/**
 * `submission.retrying`: a delivery is waiting, its host away or its first attempt failed (D47's
 * "Pending delivery"). Appended once per delivery, so a long outage never fills the event log;
 * `submission.delivered` and the terminal events end it.
 */
function appendRetrying(db: LedgerDb, artifactId: string, head: DeliveryRow, reason: string): void {
  appendEvent(db, {
    artifactId,
    type: "submission.retrying",
    actor: { kind: "mostra" },
    causation: { submissionId: head.submission_id },
    payload: {
      submissionId: head.submission_id,
      deliveryId: head.id,
      owner: head.port_owner,
      attempts: head.attempts,
      reason: reason.slice(0, 500),
    },
  });
}

/** What a host's answer means (D105). */
function outcomeOf(answer: SubmissionsDeliverResult): Outcome {
  if (answer.accepted) return { kind: "delivered" };
  if (answer.retry) return { kind: "retry", error: `The host asked to retry: ${answer.reason}` };
  if (answer.reason === "duplicate") return { kind: "delivered", reason: "duplicate" };
  return {
    kind: "terminal",
    state: answer.reason === "undeliverable" ? "undeliverable" : "rejected",
    reason: answer.reason,
  };
}
