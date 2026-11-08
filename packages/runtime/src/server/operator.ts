/**
 * The remote server's operator boundary at run time (ARCHITECTURE §15.10, INTERFACES §18.6, D165
 * items 9, 11): the operator module a configuration names, loaded in process, and every call into
 * it. Each call has its time limit and its answer is checked against `@mostra/protocol/operator`'s
 * schemas; a call that throws, times out or answers what the schema refuses counts as no answer,
 * and each port's caller says what no answer means (`limits`: operations that create fail closed,
 * viewer input proceeds; `routing`: nothing is served; `policy`: nothing is added). Outbound
 * deliveries (`metering`, `events`) are kept in the directory's `outbound` table and retried with
 * backoff until the operator takes them, at least once and idempotent by their IDs, across
 * restarts.
 *
 * Without an operator module every port is its no-op default, and this module does nothing but
 * answer "allowed".
 */
import { pathToFileURL } from "node:url";
import { createDiagnostic, RpcError } from "@mostra/protocol";
import {
  AccountResolution,
  AuthenticatedCredential,
  type ChatHostPolicy,
  ChatHostPolicy as ChatHostPolicySchema,
  type CredentialResource,
  type IdentityProvider,
  LimitAnswer,
  type LimitQuery,
  LinkHost,
  LinkPolicy,
  type LinkQuery,
  type MeterBatch,
  OPERATOR_TIME_LIMITS,
  type OperatorEvent,
  type OperatorPorts,
  PushedAnswer,
  type PushedVersion,
  RoutingAnswer,
  type ServerHandle,
  type SignInIdentity,
} from "@mostra/protocol/operator";
import type * as z from "zod";
import type { Ledger } from "../ledger/index.ts";
import type { Log } from "../log.ts";

/** What `limits` decided: allowed, refused with the operator's words, or no answer in time. */
export type LimitVerdict =
  | { readonly allowed: true }
  | {
      readonly allowed: false;
      readonly code: string;
      readonly message: string;
      readonly retryAfterMs?: number;
    }
  | { readonly allowed: "unavailable" };

/** What `accounts.resolve` decided, or that the server's own accounts decide (no port). */
export type ResolveVerdict = AccountResolution | { readonly default: true } | "unavailable";

/** The operator module at run time. */
export interface Operator {
  /** Which ports the module implements. */
  readonly has: {
    readonly limits: boolean;
    readonly metering: boolean;
    readonly accounts: boolean;
    readonly authenticate: boolean;
    readonly abuse: boolean;
    readonly pushed: boolean;
    readonly policy: boolean;
    readonly routing: boolean;
    readonly linkHost: boolean;
    readonly events: boolean;
    readonly identity: boolean;
  };
  limit(q: LimitQuery): Promise<LimitVerdict>;
  linkPolicy(q: LinkQuery): Promise<LinkPolicy>;
  chatHost(client: { name: string; redirectHost?: string }): Promise<ChatHostPolicy | null>;
  /** The operator's answer for a host the server doesn't serve itself, or `unavailable`. */
  route(host: string): Promise<RoutingAnswer | "unavailable">;
  /** The shell host a new link of a route is minted on; `null` for the active domain. */
  linkHost(q: { account: string; home: string; routeId: string }): Promise<string | null>;
  /** The identity providers the module supplies now (none on failure). */
  providers(): Promise<readonly IdentityProvider[]>;
  resolve(identity: SignInIdentity, steps: number): Promise<ResolveVerdict>;
  /** An operator-issued credential, or `null` (unknown, refused, or no answer). */
  authenticate(
    bearer: string,
    resource: CredentialResource,
  ): Promise<z.infer<typeof AuthenticatedCredential>>;
  /** An account's status as the operator says, or `undefined` with no answer. */
  status(account: string): Promise<"active" | "suspended" | undefined>;
  report(r: Parameters<NonNullable<OperatorPorts["abuse"]>["report"]>[0]): Promise<void>;
  /** The after-push hook: never blocks serving; its answer may quarantine the version after. */
  pushed(v: PushedVersion, quarantine: (reason: string) => Promise<void>): void;
  /** Keeps an outbound delivery durably, to deliver at least once (INTERFACES §18.6). */
  enqueue(
    item:
      | { readonly port: "events"; readonly event: OperatorEvent }
      | { readonly port: "metering"; readonly batch: MeterBatch },
  ): void;
  /** Delivers what waits now (tests; the dispatcher does it on its own). */
  flush(): Promise<void>;
  stop(): void;
}

/** Options for {@link loadOperator}. */
export interface OperatorOptions {
  /** The module's path (`operator` in the configuration), or `undefined` for none. */
  readonly path: string | undefined;
  readonly handle: ServerHandle;
  readonly directory: Ledger;
  readonly log: Log;
  readonly now?: () => number;
  /** How often the outbound dispatcher looks for work; tests shorten it. */
  readonly dispatchMs?: number;
}

function configInvalid(message: string): RpcError {
  return new RpcError(createDiagnostic("MOSTRA_REMOTE_CONFIG_INVALID", { message }));
}

class Timeout extends Error {}

/** Races a call against its time limit. */
async function within<T>(limitMs: number, call: () => T | Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(call),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Timeout(`no answer within ${limitMs} ms`)), limitMs);
        timer.unref();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** The longest an outbound delivery waits between attempts. */
const OUTBOUND_MAX_BACKOFF_MS = 5 * 60_000;

/**
 * Loads the operator module a configuration names and starts its outbound dispatcher. A module
 * that can't be loaded, or whose default export isn't a function, stops the server before it
 * serves anything (`MOSTRA_REMOTE_CONFIG_INVALID`, naming `operator`).
 */
export async function loadOperator(options: OperatorOptions): Promise<Operator> {
  const { log, directory } = options;
  const now = options.now ?? (() => Date.now());
  let ports: OperatorPorts = {};
  if (options.path !== undefined) {
    let loaded: { default?: unknown };
    try {
      loaded = (await import(pathToFileURL(options.path).href)) as { default?: unknown };
    } catch (error) {
      throw configInvalid(
        `The configuration key \`operator\` names a module that can't be loaded: ${(error as Error).message}.`,
      );
    }
    if (typeof loaded.default !== "function") {
      throw configInvalid(
        "The configuration key `operator` names a module whose default export isn't a function of the server's handle.",
      );
    }
    try {
      ports = ((await (loaded.default as (server: ServerHandle) => unknown)(options.handle)) ??
        {}) as OperatorPorts;
    } catch (error) {
      throw configInvalid(
        `The operator module's default export failed: ${(error as Error).message}.`,
      );
    }
    if (typeof ports !== "object") {
      throw configInvalid("The operator module's default export didn't return its ports.");
    }
    log.info("operator.loaded", {
      ports: Object.keys(ports).filter((key) => (ports as Record<string, unknown>)[key]),
    });
  }

  /** One call into the module: time-limited, its answer checked; `undefined` for no answer. */
  const ask = async <T>(
    port: string,
    limitMs: number,
    schema: z.ZodType<T>,
    call: () => unknown,
  ): Promise<{ readonly value: T } | undefined> => {
    try {
      const answer = await within(limitMs, call);
      const checked = schema.safeParse(answer);
      if (!checked.success) {
        log.warn("operator.answer_refused", {
          port,
          issue: checked.error.issues[0]?.message ?? "invalid",
        });
        return undefined;
      }
      return { value: checked.data };
    } catch (error) {
      log.warn("operator.no_answer", {
        port,
        why: error instanceof Timeout ? "timeout" : "error",
        message: (error as Error).message,
      });
      return undefined;
    }
  };

  /** Answers the operator allowed to keep, by key, until their time. */
  const cache = new Map<string, { readonly value: unknown; readonly until: number }>();
  const cached = <T>(key: string): T | undefined => {
    const hit = cache.get(key);
    if (!hit) return undefined;
    if (hit.until <= now()) {
      cache.delete(key);
      return undefined;
    }
    return hit.value as T;
  };
  const keep = (key: string, value: unknown, forMs: number | undefined): void => {
    if (forMs === undefined || forMs <= 0) return;
    if (cache.size >= 10_000) cache.delete(cache.keys().next().value as string);
    cache.set(key, { value, until: now() + forMs });
  };

  // ── outbound ────────────────────────────────────────────────────────────────────────────

  let dispatching: Promise<void> | undefined;
  const deliverOne = async (row: {
    id: string;
    port: string;
    payload_json: string;
    attempts: number;
  }): Promise<void> => {
    const payload = JSON.parse(row.payload_json) as unknown;
    try {
      await within(OPERATOR_TIME_LIMITS.outbound, () =>
        row.port === "events"
          ? ports.events?.deliver(payload as OperatorEvent)
          : ports.metering?.record(payload as MeterBatch),
      );
      directory.write((db) => db.run("DELETE FROM outbound WHERE id = ?", row.id));
    } catch (error) {
      const delay = Math.min(OUTBOUND_MAX_BACKOFF_MS, 1_000 * 2 ** Math.min(row.attempts, 20));
      directory.write((db) =>
        db.run(
          "UPDATE outbound SET attempts = attempts + 1, next_attempt_at = ? WHERE id = ?",
          new Date(now() + delay).toISOString(),
          row.id,
        ),
      );
      log.warn("operator.outbound_failed", {
        port: row.port,
        attempts: row.attempts + 1,
        message: (error as Error).message,
      });
    }
  };
  const dispatch = (): Promise<void> => {
    dispatching ??= (async () => {
      // Yield first: a turn that found nothing would otherwise end, and clear `dispatching`,
      // before `??=` stored it, leaving a finished turn registered for ever (WP-29 met the same).
      await Promise.resolve();
      try {
        for (;;) {
          // The oldest rows of each port, due or not: a port whose oldest delivery waits for its
          // retry waits whole, so an operator sees a home's events in the order they happened.
          const rows = directory.read((db) =>
            (["events", "metering"] as const).flatMap((port) =>
              db.all<{
                id: string;
                port: string;
                payload_json: string;
                attempts: number;
                next_attempt_at: string;
              }>(
                "SELECT id, port, payload_json, attempts, next_attempt_at FROM outbound WHERE port = ? ORDER BY rowid LIMIT 50",
                port,
              ),
            ),
          );
          const due = new Date(now()).toISOString();
          if (rows.every((row) => row.next_attempt_at > due)) return;
          const blocked = new Set<string>();
          let delivered = 0;
          for (const row of rows) {
            if (blocked.has(row.port)) continue;
            if (row.next_attempt_at > due) {
              blocked.add(row.port);
              continue;
            }
            const before = row.attempts;
            await deliverOne(row);
            const still = directory.read((db) =>
              db.get<{ attempts: number }>("SELECT attempts FROM outbound WHERE id = ?", row.id),
            );
            if (still && still.attempts > before) blocked.add(row.port);
            else delivered += 1;
          }
          if (delivered === 0) return;
        }
      } finally {
        dispatching = undefined;
      }
    })();
    return dispatching;
  };
  const timer =
    ports.events || ports.metering
      ? setInterval(() => void dispatch(), options.dispatchMs ?? 1_000)
      : undefined;
  timer?.unref();

  const has = {
    limits: typeof ports.limits?.check === "function",
    metering: typeof ports.metering?.record === "function",
    accounts: typeof ports.accounts?.resolve === "function",
    authenticate: typeof ports.accounts?.authenticate === "function",
    abuse: typeof ports.abuse?.report === "function",
    pushed: typeof ports.abuse?.pushed === "function",
    policy: typeof ports.policy?.link === "function",
    routing: typeof ports.routing?.resolve === "function",
    linkHost: typeof ports.routing?.linkHost === "function",
    events: typeof ports.events?.deliver === "function",
    identity: typeof ports.identity?.providers === "function",
  };

  return {
    has,

    async limit(q) {
      if (!has.limits) return { allowed: true };
      const key = `limits\u0000${JSON.stringify(q)}`;
      const hit = cached<LimitVerdict>(key);
      if (hit) return hit;
      const answer = await ask("limits", OPERATOR_TIME_LIMITS.limits, LimitAnswer, () =>
        ports.limits?.check(q),
      );
      if (!answer) return { allowed: "unavailable" };
      const verdict: LimitVerdict = answer.value.allowed
        ? { allowed: true }
        : {
            allowed: false,
            code: answer.value.code,
            message: answer.value.message,
            ...(answer.value.retryAfterMs !== undefined
              ? { retryAfterMs: answer.value.retryAfterMs }
              : {}),
          };
      keep(key, verdict, answer.value.cacheForMs);
      return verdict;
    },

    async linkPolicy(q) {
      if (!has.policy) return {};
      const key = `policy\u0000${q.routeId}\u0000${q.tokenId ?? ""}`;
      const hit = cached<LinkPolicy>(key);
      if (hit) return hit;
      const answer = await ask("policy", OPERATOR_TIME_LIMITS.policy, LinkPolicy, () =>
        ports.policy?.link(q),
      );
      if (!answer) return {};
      keep(key, answer.value, answer.value.cacheForMs);
      return answer.value;
    },

    async chatHost(client) {
      if (typeof ports.policy?.chatHost !== "function") return null;
      const answer = await ask(
        "policy.chatHost",
        OPERATOR_TIME_LIMITS.policy,
        ChatHostPolicySchema.nullable(),
        () => ports.policy?.chatHost?.(client),
      );
      return answer?.value ?? null;
    },

    async route(host) {
      if (!has.routing) return null;
      const key = `routing\u0000${host}`;
      const hit = cache.get(key);
      if (hit && hit.until > now()) return hit.value as RoutingAnswer;
      const answer = await ask("routing", OPERATOR_TIME_LIMITS.routing, RoutingAnswer, () =>
        ports.routing?.resolve(host),
      );
      if (!answer) return "unavailable";
      keep(key, answer.value, answer.value?.cacheForMs);
      return answer.value;
    },

    async linkHost(q) {
      if (!has.linkHost) return null;
      const answer = await ask("routing.linkHost", OPERATOR_TIME_LIMITS.routing, LinkHost, () =>
        ports.routing?.linkHost?.(q),
      );
      return answer?.value ?? null;
    },

    async providers() {
      if (!has.identity) return [];
      try {
        const found = await within(OPERATOR_TIME_LIMITS.identity, () =>
          ports.identity?.providers(),
        );
        return (Array.isArray(found) ? found : []).filter(
          (provider: IdentityProvider) =>
            typeof provider?.id === "string" &&
            /^[a-z][a-z0-9-]{0,31}$/.test(provider.id) &&
            typeof provider.authorize === "function" &&
            typeof provider.callback === "function",
        );
      } catch (error) {
        log.warn("operator.no_answer", { port: "identity", message: (error as Error).message });
        return [];
      }
    },

    async resolve(identity, steps) {
      if (!has.accounts) return { default: true };
      const answer = await ask(
        "accounts.resolve",
        OPERATOR_TIME_LIMITS.accounts,
        AccountResolution,
        () => ports.accounts?.resolve(identity, { steps }),
      );
      return answer ? answer.value : "unavailable";
    },

    async authenticate(bearer, resource) {
      if (!has.authenticate) return null;
      const answer = await ask(
        "accounts.authenticate",
        OPERATOR_TIME_LIMITS.authenticate,
        AuthenticatedCredential,
        () => ports.accounts?.authenticate?.(bearer, { resource }),
      );
      return answer?.value ?? null;
    },

    async status(account) {
      if (typeof ports.accounts?.status !== "function") return undefined;
      try {
        const found = await within(OPERATOR_TIME_LIMITS.accounts, () =>
          ports.accounts?.status?.(account),
        );
        return found === "active" || found === "suspended" ? found : undefined;
      } catch {
        return undefined;
      }
    },

    async report(r) {
      if (!has.abuse) return;
      try {
        await within(OPERATOR_TIME_LIMITS.policy * 5, () => ports.abuse?.report(r));
      } catch (error) {
        log.warn("operator.no_answer", { port: "abuse.report", message: (error as Error).message });
      }
    },

    pushed(v, quarantine) {
      if (!has.pushed) return;
      void ask("abuse.pushed", OPERATOR_TIME_LIMITS.pushed, PushedAnswer, () =>
        ports.abuse?.pushed?.(v),
      ).then(async (answer) => {
        const reason = answer?.value?.quarantine?.reason;
        if (reason !== undefined) {
          await quarantine(reason).catch((error: unknown) =>
            log.error("operator.quarantine_failed", { error }),
          );
        }
      });
    },

    enqueue(item) {
      if (item.port === "events" ? !has.events : !has.metering) return;
      const id = item.port === "events" ? item.event.eventId : item.batch.batchId;
      const payload = item.port === "events" ? item.event : item.batch;
      directory.write((db) =>
        db.run(
          "INSERT OR IGNORE INTO outbound (id, port, payload_json, attempts, next_attempt_at) VALUES (?, ?, ?, 0, ?)",
          `${item.port}:${id}`,
          item.port,
          JSON.stringify(payload),
          new Date(now()).toISOString(),
        ),
      );
      void dispatch();
    },

    flush: () => dispatch(),

    stop() {
      if (timer) clearInterval(timer);
    },
  };
}
