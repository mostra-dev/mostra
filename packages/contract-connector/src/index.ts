/**
 * `@mostra/contract-connector`: the contract a data connector implements (D30, D56, ROUND-3
 * §6.1). A connector reads, follows and optionally writes one kind of data source (a folder of
 * JSON files, a database, a queue) for an artifact's live sources: `liveSource` turns a connector
 * and its configuration into what `defineLive` takes, so a page reads it with `useLive` like any
 * other source. Connectors run in the artifact's worker, on the owner's machine.
 *
 * ```ts
 * // live.ts
 * import { defineLive, secret } from "@mostra/server";
 * import { liveSource } from "@mostra/contract-connector";
 * import files from "mostra-connector-files";
 *
 * export const orders = defineLive(liveSource(files, { path: "./data/orders.json" }, { secret }));
 * ```
 *
 * @packageDocumentation
 */
import {
  type BaseContext,
  type Cancellation,
  type ContractStamp,
  checkId,
  type Json,
  type JsonSchema,
  stampCompatible,
} from "./common.ts";
import { VERSION } from "./version.ts";

export {
  type BaseContext,
  type Cancellation,
  CONTRIBUTION_ID,
  type ContractStamp,
  type Json,
  type JsonSchema,
  stampCompatible,
} from "./common.ts";
export { VERSION } from "./version.ts";

/** This contract's stamp: what {@link defineConnector} puts on every connector. */
export const CONTRACT: ContractStamp<"connector"> = { name: "connector", version: VERSION };

/** What a connector's calls receive besides their input. */
export interface ConnectorContext extends BaseContext {
  /** The value of a secret by name (D44), when the caller provides secrets; else `undefined`. */
  secret(name: string): string | undefined;
}

/** One value a connector read. */
export interface ConnectorValue<Value> {
  /** The value, as JSON. */
  readonly value: Value;
  /** The source's own revision of it (an ETag, a sequence), when it has one. */
  readonly revision?: string;
}

/** What a plugin writes to define a connector. */
export interface ConnectorDefinition<Config = { readonly [key: string]: Json }, Value = Json> {
  /** The connector's ID. Unique among an artifact's plugins. */
  readonly id: string;
  /** A short name for people. */
  readonly title?: string;
  /** One sentence on what it does, for people and agents. */
  readonly description?: string;
  /** A JSON Schema of its configuration. */
  readonly config: JsonSchema;
  /** Reads the current value. */
  read(
    input: { readonly config: Config },
    context: ConnectorContext,
  ): Promise<ConnectorValue<Value>>;
  /**
   * Follows the source: yields each new value as it changes, until `context.signal` fires. Without
   * it, a live source refreshes by reading again.
   */
  subscribe?(
    input: { readonly config: Config },
    context: ConnectorContext,
  ): AsyncIterable<ConnectorValue<Value>>;
  /** Writes a value back, when the source takes writes. */
  write?(
    input: { readonly config: Config; readonly value: Value },
    context: ConnectorContext,
  ): Promise<{ readonly revision?: string }>;
}

/** A connector, as {@link defineConnector} returns it: the definition with its stamp. */
export interface Connector<Config = { readonly [key: string]: Json }, Value = Json>
  extends ConnectorDefinition<Config, Value> {
  /** The contract's stamp, its name and version, which the define function sets. */
  readonly contract: ContractStamp<"connector">;
}

/**
 * Defines a connector: checks its ID and stamps it with this contract's name and version.
 *
 * @throws TypeError when the ID, the configuration schema or `read` isn't valid.
 */
export function defineConnector<Config = { readonly [key: string]: Json }, Value = Json>(
  definition: ConnectorDefinition<Config, Value>,
): Connector<Config, Value> {
  checkId("defineConnector", definition.id);
  if (typeof definition.config !== "object" || definition.config === null) {
    throw new TypeError("defineConnector needs config: a JSON Schema of its configuration.");
  }
  if (typeof definition.read !== "function") {
    throw new TypeError("defineConnector needs a read function.");
  }
  return { ...definition, contract: CONTRACT };
}

/** Whether `value` is a connector stamped with a version of this contract this copy serves. */
export function isConnector(value: unknown): value is Connector<unknown, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    stampCompatible((value as { contract?: unknown }).contract, CONTRACT.name, CONTRACT.version) &&
    typeof (value as { read?: unknown }).read === "function"
  );
}

/** A cancellation that never fires: a load ends when its read does. */
const NEVER: Cancellation = {
  aborted: false,
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
};

/** How {@link liveSource} runs a connector. */
export interface LiveSourceOptions {
  /** Reads again this often (`"30s"`), for a connector that can't follow its source. */
  readonly refresh?: string;
  /** Keeps it running without viewers (D63). */
  readonly always?: boolean;
  /** Keeps the last N values for append mode. */
  readonly ring?: number;
  /** Gives the connector secrets: pass `@mostra/server`'s `secret`. */
  readonly secret?: (name: string) => string;
}

/** What `defineLive` takes (INTERFACES §2.4), as {@link liveSource} builds it. */
export interface LiveSourceInput<Value> {
  /** Reads the value once: what a live source's `load` does. */
  load(): Promise<Value>;
  /** Follows the value as it changes, until `signal` fires: what a live source's `stream` does. */
  stream?: (signal: Cancellation) => AsyncIterable<Value>;
  /** How often to read again (`5s` to `24h`), as `defineLive` takes it. */
  readonly refresh?: string;
  /** Keep reading while nobody views the artifact (D63). */
  readonly always?: boolean;
  /** Keep the last N values for append mode. */
  readonly ring?: number;
}

/**
 * A live source of `connector` with `config`: what `defineLive` from `@mostra/server` takes, so
 * the artifact's worker runs the connector as it runs any producer.
 */
export function liveSource<Config, Value>(
  connector: Connector<Config, Value>,
  config: Config,
  options: LiveSourceOptions = {},
): LiveSourceInput<Value> {
  const context = (signal: Cancellation): ConnectorContext => ({
    signal,
    // A connector's lines join the worker's output, which the run log keeps (INTERFACES §2.4).
    log: (message) =>
      (globalThis as { console?: { log(line: string): void } }).console?.log(message),
    mostraVersion: "",
    secret: (name) => {
      if (options.secret === undefined) return undefined;
      try {
        return options.secret(name);
      } catch {
        return undefined;
      }
    },
  });
  const subscribe = connector.subscribe?.bind(connector);
  return {
    async load() {
      return (await connector.read({ config }, context(NEVER))).value;
    },
    ...(subscribe
      ? {
          async *stream(signal: Cancellation) {
            for await (const update of subscribe({ config }, context(signal))) yield update.value;
          },
        }
      : {}),
    ...(options.refresh !== undefined ? { refresh: options.refresh } : {}),
    ...(options.always !== undefined ? { always: options.always } : {}),
    ...(options.ring !== undefined ? { ring: options.ring } : {}),
  };
}
