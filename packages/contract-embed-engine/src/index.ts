/**
 * `@mostra/contract-embed-engine`: the contract an embed engine implements (D30, ROUND-3 §6.1). An
 * engine renders a kind of content Mostra's kit doesn't draw itself (a terminal, a video
 * composition, an animation timeline) into an element of an artifact's page, so the kit can mount
 * it, size it, snapshot it for `verify` and review, and dispose of it the same way whatever the
 * engine. Engines run in the page, in the browser.
 *
 * ```ts
 * import { defineEmbedEngine } from "@mostra/contract-embed-engine";
 *
 * export default defineEmbedEngine({
 *   id: "xterm",
 *   sources: ["terminal/asciicast"],
 *   capabilities: ["resize", "snapshot", "text"],
 *   async mount({ element, source }) {
 *     const terminal = await open(element, source);
 *     return {
 *       resize: (size) => terminal.fit(size),
 *       snapshot: async () => ({ text: terminal.text() }),
 *       dispose: () => terminal.dispose(),
 *     };
 *   },
 * });
 * ```
 *
 * @packageDocumentation
 */
import { type ContractStamp, checkId, type Json, stampCompatible } from "./common.ts";
import { VERSION } from "./version.ts";

export {
  CONTRIBUTION_ID,
  type ContractStamp,
  type Json,
  type JsonSchema,
  stampCompatible,
} from "./common.ts";
export { VERSION } from "./version.ts";

/** This contract's stamp: what {@link defineEmbedEngine} puts on every engine. */
export const CONTRACT: ContractStamp<"embed-engine"> = { name: "embed-engine", version: VERSION };

/**
 * An optional feature an engine offers, beyond mounting: `resize`, `snapshot` (an image),
 * `text` (a text dump, so an agent checks output without vision), `time` (seeking a timeline),
 * `input` (it takes keyboard or pointer input). Names a later release adds are additive.
 */
export type EmbedCapability = "resize" | "snapshot" | "text" | "time" | "input" | (string & {});

/** A size in CSS pixels. */
export interface EmbedSize {
  /** In CSS pixels. */
  readonly width: number;
  /** In CSS pixels. */
  readonly height: number;
}

/** What an engine renders: a kind it lists in {@link EmbedEngineDefinition.sources}, and its data. */
export interface EmbedSource {
  /** The kind: `terminal/asciicast`, `video/composition` … */
  readonly kind: string;
  /** Where its content is, same-origin with the page. */
  readonly url?: string;
  /** Or the content itself. */
  readonly data?: Json;
}

/** Something an engine tells the kit as it runs. */
export type EmbedEvent =
  | { readonly type: "ready" }
  | { readonly type: "error"; readonly message: string }
  | { readonly type: "size"; readonly size: EmbedSize }
  | { readonly type: "time"; readonly time: number; readonly duration?: number };

/** What `mount` receives. */
export interface EmbedMountInput {
  /** The element to render into; the engine owns its children until it is disposed. */
  readonly element: HTMLElement;
  /** What to render. */
  readonly source: EmbedSource;
  /** The element's size when mounted. */
  readonly size: EmbedSize;
  /** The options the page passed, as JSON. */
  readonly options: { readonly [key: string]: Json };
}

/** What `mount` receives besides its input. */
export interface EmbedContext {
  /** Fires when the kit no longer needs the mount (the component unmounted). */
  readonly signal: AbortSignal;
  /** The page's design tokens (`--background`, `--font-mono` …) with their values. */
  readonly tokens: { readonly [name: string]: string };
  /** The viewer prefers reduced motion. */
  readonly reducedMotion: boolean;
  /** Tells the kit what happened. */
  report(event: EmbedEvent): void;
}

/** What a snapshot asks for. */
export interface EmbedSnapshotRequest {
  /** `image` (a PNG), `text`, or both. */
  readonly kinds: readonly ("image" | "text")[];
  /** For a timeline, the time to show, in milliseconds. */
  readonly time?: number;
}

/** A snapshot of what the engine shows. */
export interface EmbedSnapshot {
  /** The image, as PNG bytes. */
  readonly png?: Uint8Array;
  /** What it shows, as text. */
  readonly text?: string;
}

/** A mounted engine. */
export interface EmbedHandle {
  /** The element was resized (capability `resize`). */
  resize?(size: EmbedSize): void;
  /** What it shows now (capabilities `snapshot` and `text`). */
  snapshot?(request: EmbedSnapshotRequest): Promise<EmbedSnapshot>;
  /** Moves a timeline to `time` milliseconds (capability `time`). */
  seek?(time: number): void | Promise<void>;
  /** Removes what it rendered and stops its work. */
  dispose(): void | Promise<void>;
}

/** What a plugin writes to define an embed engine. */
export interface EmbedEngineDefinition {
  /** The engine's ID: `xterm`, `remotion`. Unique among an artifact's plugins. */
  readonly id: string;
  /** A short name for people. */
  readonly title?: string;
  /** One sentence on what it does, for people and agents. */
  readonly description?: string;
  /** The source kinds it renders. */
  readonly sources: readonly string[];
  /** The optional features it has: `resize`, `snapshot`, `text`, `time`, `input`. */
  readonly capabilities?: readonly EmbedCapability[];
  /** Renders `input.source` into `input.element`. */
  mount(input: EmbedMountInput, context: EmbedContext): EmbedHandle | Promise<EmbedHandle>;
}

/** An embed engine, as {@link defineEmbedEngine} returns it: the definition with its stamp. */
export interface EmbedEngine extends EmbedEngineDefinition {
  /** The contract's stamp, its name and version, which the define function sets. */
  readonly contract: ContractStamp<"embed-engine">;
}

/**
 * Defines an embed engine: checks its ID and sources and stamps it with this contract's name and
 * version.
 *
 * @throws TypeError when the ID, the sources or `mount` aren't valid.
 */
export function defineEmbedEngine<const T extends EmbedEngineDefinition>(
  definition: T,
): T & { readonly contract: ContractStamp<"embed-engine"> } {
  checkId("defineEmbedEngine", definition.id);
  if (
    !Array.isArray(definition.sources) ||
    definition.sources.length === 0 ||
    !definition.sources.every((kind) => typeof kind === "string" && kind !== "")
  ) {
    throw new TypeError("defineEmbedEngine needs sources: the source kinds it renders.");
  }
  if (typeof definition.mount !== "function") {
    throw new TypeError("defineEmbedEngine needs a mount function.");
  }
  return { ...definition, contract: CONTRACT };
}

/** Whether `value` is an embed engine stamped with a version of this contract this copy serves. */
export function isEmbedEngine(value: unknown): value is EmbedEngine {
  return (
    typeof value === "object" &&
    value !== null &&
    stampCompatible((value as { contract?: unknown }).contract, CONTRACT.name, CONTRACT.version) &&
    typeof (value as { mount?: unknown }).mount === "function"
  );
}
