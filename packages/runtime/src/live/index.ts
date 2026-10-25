/**
 * Live sources (D56, D63, LL-04, AC-07): values a page reads with `useLive(key)`, produced by the
 * `live.ts` of the artifact's latest version in its worker, or pushed by an agent or host
 * (`live/push`). The latest value persists with a revision that only grows, and in append mode a
 * ring keeps the recent values; updates reach the views reading them as ephemeral messages, never
 * as events, so a dashboard open all week never fills the event log.
 *
 * A producer runs while some view reads its source (a one-minute lease the page renews), while a
 * host subscribes to the artifact's events, or always when its source says `always: true`.
 */
import {
  type ArtifactRef,
  type Batches,
  createDiagnostic,
  type Frame,
  LIVE_RING_DEFAULT,
  LIVE_RING_MAX,
  LIVE_VALUE_MAX,
  type LiveSourceInfo,
  type LiveState,
  livePushMethod,
  RpcError,
  ServerLiveValueParams,
  serializeAll,
  type WireError,
} from "@mostra/protocol";
import type { EphemeralBus, Interaction, PageIdentity } from "../interaction/index.ts";
import type { Ledger, LedgerDb, RequestKey } from "../ledger/index.ts";
import { recordedResult, recordResult, requestKey } from "../ledger/index.ts";
import { type Log, redactFrames, redactValue } from "../log.ts";
import { handler, type MethodHandler } from "../protocol-server/index.ts";
import type { WorkerCrash, WorkerHandle, WorkerPool, WorkerVersion } from "../workers/index.ts";

/** What the live module knows of an artifact's latest version. */
export interface LatestLive {
  readonly versionId: string;
  /**
   * The sources its `live.ts` defines, from its registry: `always` is `true` or `false` when the
   * builder read it as a literal, `undefined` when it couldn't (the worker then tells).
   */
  readonly sources: readonly { readonly key: string; readonly always?: boolean }[];
}

/** Options for {@link createLive}. */
export interface LiveOptions {
  readonly ledger: Ledger;
  readonly log: Log;
  readonly bus: EphemeralBus;
  readonly pool: WorkerPool;
  readonly interaction: Pick<Interaction, "subscribedArtifacts" | "checkView">;
  /** The latest version of an artifact with live sources, or `undefined`. */
  readonly latest: (artifactId: string) => LatestLive | undefined;
  /** Every artifact whose latest version defines live sources. */
  readonly artifactsWithLive: () => readonly string[];
  /** What the pool needs to start a version's worker. */
  readonly version: (versionId: string) => WorkerVersion | undefined;
  /** How often the producers are checked against who wants them; default 5 s. */
  readonly reconcileMs?: number;
  /** Removes secrets from every value stored (AC-06). */
  readonly redactor?: { redact(text: string): string };
}

/** The live module. */
export interface Live {
  /** Reads sources for a page and keeps them produced for its view for a minute (LL-04). */
  read(
    page: PageIdentity,
    input: {
      readonly viewId: string;
      readonly keys: readonly {
        readonly key: string;
        readonly window?: number;
        readonly refresh?: boolean;
      }[];
    },
  ): LiveState[];
  /** `live/push` (D56): a value from an agent or a host. */
  push(
    artifactId: string,
    input: { readonly key: string; readonly value: unknown; readonly mode?: "replace" | "append" },
    requestKey?: RequestKey,
  ): Promise<{ revision: string }>;
  /** A worker's `server/live.value`. */
  produced(
    worker: { readonly artifactId: string; readonly versionId: string },
    params: unknown,
  ): void;
  /** A worker crashed: its producers start again when its backoff ends. */
  crashed(crash: WorkerCrash): void;
  /** Checks the producers against who wants them now. */
  reconcile(): void;
  /**
   * A publish cleared the artifact's park (FAILURE_MODEL §2): its producers may start again,
   * also when the publish reused the parked version.
   */
  unpark(artifactId: string): void;
  /**
   * A version's worker was replaced on purpose (a dev session's server code built again, D140
   * item 12): its producers ran in the old worker, so they start again in the new one, from the
   * sources it describes.
   */
  replaced(versionId: string): void;
  /** How many producers run: the daemon stays while any do (D62). */
  activity(): number;
  /** Starts checking producers. */
  start(): void;
  /** Stops checking; the pool stops the producers with their workers. */
  stop(): void;
  /** The artifact's sources whose producers failed last, with the error each reported (verify, D138). */
  failures(artifactId: string): { readonly key: string; readonly error: WireError }[];
}

interface LiveRow {
  readonly revision: number;
  readonly value_json: string;
  readonly at: string;
}

const keyOf = (artifactId: string, key: string): string => `${artifactId}\u0000${key}`;

/** After a worker couldn't start to describe its sources, how long before it is tried again. */
const DISCOVERY_RETRY_MS = 60_000;

function tooLarge(key: string): RpcError {
  return new RpcError(
    createDiagnostic("MOSTRA_LIVE_TOO_LARGE", {
      message: `The value for the live source ${key} is larger than 4 MiB once serialized; it was not stored.`,
    }),
  );
}

/** Creates the live module. */
export function createLive(options: LiveOptions): Live {
  const { ledger, log, bus, pool } = options;
  /** Producers running now, by artifact and key, with the version producing. */
  const running = new Map<
    string,
    { artifactId: string; key: string; versionId: string; handle: WorkerHandle }
  >();
  /** Producers being started. */
  const starting = new Set<string>();
  /** Each version's sources as its worker described them (`ring`, `always`). */
  const described = new Map<string, readonly LiveSourceInfo[]>();
  /** The last failure of each source, shown until its next good value. */
  const failures = new Map<string, WireError>();
  /** Versions whose producers wait for their worker's backoff. */
  const retryAt = new Map<string, number>();
  /** Versions whose producers stopped because their worker is parked, by version, to their artifact. */
  const parkedVersions = new Map<string, string>();
  let timer: ReturnType<typeof setInterval> | undefined;
  let scheduled = false;
  let stopped = false;
  /** A worker is starting only to say which of its version's sources are `always`. */
  let discovering = false;

  const ringOf = (key: string, versionId: string | undefined): number | undefined => {
    if (!versionId) return undefined;
    return described.get(versionId)?.find((source) => source.key === key)?.ring;
  };

  /** Stores a value under the next revision, and in the ring when the source keeps one. */
  const store = (
    db: LedgerDb,
    artifactId: string,
    key: string,
    value: Batches,
    producerVersionId: string | null,
    ring: number | undefined,
  ): { revision: number; at: string } => {
    const current = db.get<{ revision: number }>(
      "SELECT revision FROM live_value WHERE artifact_id = ? AND key = ?",
      artifactId,
      key,
    );
    const revision = (current?.revision ?? 0) + 1;
    const at = new Date().toISOString();
    const json = JSON.stringify(redactBatches(value));
    db.run(
      `INSERT INTO live_value (artifact_id, key, revision, value_json, producer_version_id, at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (artifact_id, key) DO UPDATE SET revision = excluded.revision,
         value_json = excluded.value_json, producer_version_id = excluded.producer_version_id,
         at = excluded.at`,
      artifactId,
      key,
      revision,
      json,
      producerVersionId,
      at,
    );
    if (ring !== undefined && ring > 0) {
      db.run(
        "INSERT INTO live_ring (artifact_id, key, revision, value_json, at) VALUES (?, ?, ?, ?, ?)",
        artifactId,
        key,
        revision,
        json,
        at,
      );
      db.run(
        "DELETE FROM live_ring WHERE artifact_id = ? AND key = ? AND revision <= ?",
        artifactId,
        key,
        revision - Math.min(ring, LIVE_RING_MAX),
      );
    }
    return { revision, at };
  };

  const publishValue = (
    artifactId: string,
    key: string,
    revision: number,
    at: string,
    value: Batches,
  ): void => {
    bus.publishLive(artifactId, {
      kind: "live",
      live: {
        key,
        revision: String(revision),
        at,
        value: redactBatches(value),
      },
    });
  };

  /** A live value's batches as frames, redacted as values (D131; Opus review 7). */
  const redactBatches = (value: Batches): Batches => {
    const redactor = options.redactor;
    return redactor ? value.map((batch) => redactFrames([...batch], redactor)) : value;
  };

  const fail = (artifactId: string, key: string, raw: WireError): void => {
    // An error is output too: a producer's message may carry a secret it read (AC-06).
    const error = options.redactor ? redactValue(raw, options.redactor) : raw;
    failures.set(keyOf(artifactId, key), error);
    bus.publishLive(artifactId, { kind: "live", live: { key, error } });
  };

  const wanted = (): Map<string, { artifactId: string; key: string }> => {
    const out = new Map<string, { artifactId: string; key: string }>();
    const add = (artifactId: string, key: string): void => {
      out.set(keyOf(artifactId, key), { artifactId, key });
    };
    for (const entry of bus.liveInterest()) add(entry.artifactId, entry.key);
    const subscribed = options.interaction.subscribedArtifacts();
    for (const artifactId of options.artifactsWithLive()) {
      const latest = options.latest(artifactId);
      if (!latest) continue;
      const known = described.get(latest.versionId);
      for (const source of latest.sources) {
        const always = known?.find((info) => info.key === source.key)?.always ?? source.always;
        if (subscribed.has(artifactId) || always === true) add(artifactId, source.key);
      }
    }
    return out;
  };

  const startProducer = async (
    artifactId: string,
    key: string,
    versionId: string,
  ): Promise<void> => {
    const id = keyOf(artifactId, key);
    const version = options.version(versionId);
    if (!version) return;
    starting.add(id);
    try {
      const handle = await pool.acquire(version);
      described.set(versionId, handle.started.live);
      if (!handle.started.live.some((source) => source.key === key)) return;
      // Known before it starts: its first value can arrive before the start's answer.
      running.set(id, { artifactId, key, versionId, handle });
      try {
        await handle.liveStart(key);
      } catch (error) {
        running.delete(id);
        throw error;
      }
    } catch (error) {
      // A start the park cut short: the park's own failure stands (#42).
      if (parkedVersions.has(versionId)) return;
      const diagnostic = error instanceof RpcError ? error.diagnostic : undefined;
      fail(artifactId, key, {
        message: diagnostic?.message ?? String(error),
        code: diagnostic?.code ?? "MOSTRA_LIVE_SOURCE_FAILED",
      });
    } finally {
      starting.delete(id);
    }
  };

  const reconcileNow = (): void => {
    if (stopped) return;
    const want = wanted();
    const now = Date.now();
    // Versions whose `always` the registry couldn't read: their worker says. One at a time, and
    // a worker started only to say stops at once unless it has a producer to run, so a home of
    // many such artifacts never starts many workers together (Opus review 2).
    if (!discovering) {
      for (const artifactId of options.artifactsWithLive()) {
        const latest = options.latest(artifactId);
        if (!latest || described.has(latest.versionId)) continue;
        if (!latest.sources.some((source) => source.always === undefined)) continue;
        if ((retryAt.get(latest.versionId) ?? 0) > now) continue;
        const version = options.version(latest.versionId);
        if (!version) continue;
        discovering = true;
        void pool
          .acquire(version)
          .then(
            (handle) => {
              described.set(latest.versionId, handle.started.live);
              const needed =
                handle.started.live.some((source) => source.always === true) ||
                [...want.values()].some((entry) => entry.artifactId === artifactId);
              if (!needed) pool.release(latest.versionId);
            },
            () => {
              // Never sooner than a crash's backoff or park asked for.
              const later = Date.now() + DISCOVERY_RETRY_MS;
              retryAt.set(latest.versionId, Math.max(retryAt.get(latest.versionId) ?? 0, later));
            },
          )
          .finally(() => {
            discovering = false;
            schedule();
          });
        break;
      }
    }
    for (const [id, producer] of running) {
      const latest = options.latest(producer.artifactId);
      if (!want.has(id) || latest?.versionId !== producer.versionId) {
        running.delete(id);
        void producer.handle.liveStop(producer.key);
      }
    }
    for (const [id, entry] of want) {
      if (running.has(id) || starting.has(id)) continue;
      const latest = options.latest(entry.artifactId);
      if (!latest?.sources.some((source) => source.key === entry.key)) continue;
      if ((retryAt.get(latest.versionId) ?? 0) > now) continue;
      void startProducer(entry.artifactId, entry.key, latest.versionId);
    }
  };

  const schedule = (): void => {
    if (scheduled || stopped) return;
    scheduled = true;
    setImmediate(() => {
      scheduled = false;
      try {
        reconcileNow();
      } catch (error) {
        log.error("live.reconcile_failed", { error });
      }
    });
  };

  const stateOf = (db: LedgerDb, artifactId: string, key: string, window?: number): LiveState => {
    const row = db.get<LiveRow>(
      "SELECT revision, value_json, at FROM live_value WHERE artifact_id = ? AND key = ?",
      artifactId,
      key,
    );
    const failure = failures.get(keyOf(artifactId, key));
    const ring =
      window === undefined
        ? undefined
        : db
            .all<LiveRow>(
              "SELECT revision, value_json, at FROM live_ring WHERE artifact_id = ? AND key = ? ORDER BY revision DESC LIMIT ?",
              artifactId,
              key,
              window,
            )
            .reverse()
            .map((entry) => ({
              revision: String(entry.revision),
              at: entry.at,
              value: JSON.parse(entry.value_json) as Batches,
            }));
    return {
      key,
      ...(row
        ? {
            revision: String(row.revision),
            at: row.at,
            value: JSON.parse(row.value_json) as Batches,
          }
        : {}),
      ...(ring ? { ring } : {}),
      ...(failure ? { error: failure } : {}),
    };
  };

  return {
    failures(artifactId) {
      const prefix = keyOf(artifactId, "");
      return [...failures]
        .filter(([id]) => id.startsWith(prefix))
        .map(([id, error]) => ({ key: id.slice(prefix.length), error }));
    },
    read(page, input) {
      options.interaction.checkView(page, input.viewId);
      bus.watchLive(page.artifactId, input.viewId, input.keys);
      for (const entry of input.keys) {
        if (entry.refresh)
          running.get(keyOf(page.artifactId, entry.key))?.handle.liveRefresh(entry.key);
      }
      schedule();
      return ledger.read((db) =>
        input.keys.map((entry) => stateOf(db, page.artifactId, entry.key, entry.window)),
      );
    },

    async push(artifactId, input, requestKey) {
      let batches: Batches;
      try {
        batches = await serializeAll(input.value, { mode: "argument" });
      } catch {
        throw new RpcError(
          createDiagnostic("MOSTRA_HOST_INVALID_PARAMS", {
            message: `The value pushed to ${input.key} isn't JSON.`,
          }),
        );
      }
      if (JSON.stringify(batches).length > LIVE_VALUE_MAX) throw tooLarge(input.key);
      const latest = options.latest(artifactId);
      const ring =
        input.mode === "append"
          ? (ringOf(input.key, latest?.versionId) ?? LIVE_RING_DEFAULT)
          : ringOf(input.key, latest?.versionId);
      const result = ledger.write((db) => {
        if (requestKey) {
          const replay = recordedResult<{ revision: string }>(db, requestKey);
          if (replay) return { replay };
        }
        const stored = store(db, artifactId, input.key, batches, null, ring);
        const answer = { revision: String(stored.revision) };
        if (requestKey) recordResult(db, requestKey, answer);
        return { stored, answer };
      });
      if ("replay" in result && result.replay) return result.replay;
      const { stored, answer } = result as {
        stored: { revision: number; at: string };
        answer: { revision: string };
      };
      failures.delete(keyOf(artifactId, input.key));
      publishValue(artifactId, input.key, stored.revision, stored.at, batches);
      return answer;
    },

    produced(worker, params) {
      const parsed = ServerLiveValueParams.safeParse(params);
      if (!parsed.success) return;
      const { key } = parsed.data;
      const producer = running.get(keyOf(worker.artifactId, key));
      // Only the producer of the latest version writes the source; a stale one is ignored.
      if (!producer || producer.versionId !== worker.versionId) return;
      if (parsed.data.error) {
        fail(worker.artifactId, key, parsed.data.error);
        return;
      }
      const value = parsed.data.value as Batches | undefined;
      if (!value) return;
      if (JSON.stringify(value).length > LIVE_VALUE_MAX) {
        fail(worker.artifactId, key, {
          code: "MOSTRA_LIVE_TOO_LARGE",
          message: tooLarge(key).diagnostic.message,
        });
        return;
      }
      const ring = ringOf(key, worker.versionId);
      try {
        const stored = ledger.write((db) =>
          store(db, worker.artifactId, key, value as Frame[][], worker.versionId, ring),
        );
        failures.delete(keyOf(worker.artifactId, key));
        publishValue(worker.artifactId, key, stored.revision, stored.at, value);
      } catch (error) {
        log.error("live.store_failed", { key, error });
      }
    },

    crashed(crash) {
      const ended = new Set(crash.liveKeys);
      for (const [id, producer] of running) {
        if (producer.versionId !== crash.versionId) continue;
        running.delete(id);
        ended.add(producer.key);
      }
      if (crash.parked) {
        // Every source of the parked version says so, not only the producers the worker had
        // started when it crashed: one being started then, or due after the backoff, never runs
        // again either, and its page would otherwise wait on it without a word (#42).
        for (const source of described.get(crash.versionId) ?? []) ended.add(source.key);
        for (const key of ended) {
          fail(crash.artifactId, key, {
            code: "MOSTRA_RUNTIME_WORKER_PARKED",
            message: `The artifact's server code keeps crashing, so its live sources stopped (${crash.cause}).`,
          });
        }
        retryAt.set(crash.versionId, Number.POSITIVE_INFINITY);
        parkedVersions.set(crash.versionId, crash.artifactId);
        return;
      }
      retryAt.set(crash.versionId, Date.now() + crash.backoffMs);
      setTimeout(() => {
        retryAt.delete(crash.versionId);
        schedule();
      }, crash.backoffMs + 10).unref?.();
    },

    reconcile: schedule,

    replaced(versionId) {
      for (const [id, producer] of running) {
        if (producer.versionId === versionId) running.delete(id);
      }
      described.delete(versionId);
      retryAt.delete(versionId);
      schedule();
    },

    unpark(artifactId) {
      let cleared = false;
      for (const [versionId, owner] of parkedVersions) {
        if (owner !== artifactId) continue;
        parkedVersions.delete(versionId);
        retryAt.delete(versionId);
        cleared = true;
      }
      if (!cleared) return;
      for (const [id, error] of failures) {
        if (id.startsWith(keyOf(artifactId, "")) && error.code === "MOSTRA_RUNTIME_WORKER_PARKED") {
          failures.delete(id);
        }
      }
      schedule();
    },

    activity() {
      return running.size + starting.size;
    },

    start() {
      stopped = false;
      bus.onLiveInterest(schedule);
      timer = setInterval(schedule, options.reconcileMs ?? 5_000);
      timer.unref?.();
      schedule();
    },

    stop() {
      stopped = true;
      if (timer !== undefined) clearInterval(timer);
    },
  };
}

/** `live/push` (D56): a value from an agent or host into an artifact's live source. */
export function liveMethods(
  live: Live,
  resolveArtifact: (ref: ArtifactRef) => string,
): MethodHandler[] {
  return [
    handler(livePushMethod, (params) =>
      live.push(
        resolveArtifact(params.artifact),
        {
          key: params.key,
          value: params.value,
          ...(params.mode !== undefined ? { mode: params.mode } : {}),
        },
        requestKey(livePushMethod.method, params),
      ),
    ),
  ];
}
