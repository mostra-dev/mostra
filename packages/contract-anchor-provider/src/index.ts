/**
 * `@mostra/contract-anchor-provider`: the contract an anchor provider implements (D30, D23,
 * ROUND-3 §6.1). Review comments anchor to content in layers (a semantic ID, selectors,
 * coordinates, a crop); a provider adds a layer for content those can't name well, such as a datum
 * of a chart or a cell range of a table: it turns what the viewer pointed at into anchor data, and
 * finds that place again later, after a reload or in a newer version. Providers run in the page.
 *
 * ```ts
 * import { defineAnchorProvider } from "@mostra/contract-anchor-provider";
 *
 * export default defineAnchorProvider({
 *   id: "chart-datum",
 *   kind: "chart-datum",
 *   matches: ({ target }) => target.closest("[data-chart]") !== null,
 *   serialize: ({ target }) => {
 *     const point = target.closest("[data-series]");
 *     return point ? { series: point.getAttribute("data-series"), index: Number(point.getAttribute("data-index")) } : undefined;
 *   },
 *   resolve: ({ anchor, root }) => {
 *     const element = root.querySelector(`[data-series="${anchor.series}"][data-index="${anchor.index}"]`);
 *     return element ? { element } : undefined;
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

/** This contract's stamp: what {@link defineAnchorProvider} puts on every provider. */
export const CONTRACT: ContractStamp<"anchor-provider"> = {
  name: "anchor-provider",
  version: VERSION,
};

/** Anchor data: the JSON a provider writes and reads back. At most 16 KiB once serialized. */
export type AnchorData = { readonly [key: string]: Json };

/** What the viewer pointed at. */
export interface AnchorTarget {
  /** The element under the pointer, or holding the selection. */
  readonly target: Element;
  /** The point, in the target document's CSS pixels. */
  readonly point?: { readonly x: number; readonly y: number };
  /** The text selection, when there is one. */
  readonly selection?: Range;
}

/** Where an anchor resolved. */
export interface ResolvedAnchor {
  /** The element it names. */
  readonly element?: Element;
  /** Or a rectangle, in the root document's CSS pixels. */
  readonly rect?: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
  /** A short description for people: `Revenue, March`. */
  readonly label?: string;
}

/** What an anchor provider's functions receive besides their input. */
export interface AnchorContext {
  /** The version of the Mostra runtime calling. */
  readonly mostraVersion: string;
  /** Writes a line to the log Mostra keeps of the review session. */
  log(message: string): void;
}

/** An anchor `serialize` made: the data `resolve` reads back, and what people see of it. */
export interface SerializedAnchor {
  /** The provider's own data, kept with the comment. */
  readonly anchor: AnchorData;
  /** A short description for people: `Revenue, March`. */
  readonly label?: string;
}

/** What a plugin writes to define an anchor provider. */
export interface AnchorProviderDefinition {
  /** The provider's ID. Unique among an artifact's plugins. */
  readonly id: string;
  /** The anchor kind it writes and reads, recorded with every anchor: `chart-datum`. */
  readonly kind: string;
  /** A short name for people. */
  readonly title?: string;
  /** One sentence on what it does, for people and agents. */
  readonly description?: string;
  /**
   * Whether it can anchor at `input`, a predicate the overlay asks before `serialize`; without it,
   * `serialize` decides by answering.
   */
  matches?(input: AnchorTarget, context: AnchorContext): boolean;
  /** The anchor for what the viewer pointed at, or `undefined` when it has none. */
  serialize(input: AnchorTarget, context: AnchorContext): SerializedAnchor | undefined;
  /** Where `input.anchor` is now inside `input.root`, or `undefined` when it is gone. */
  resolve(
    input: { readonly anchor: AnchorData; readonly root: Element },
    context: AnchorContext,
  ): ResolvedAnchor | undefined;
}

/** An anchor provider, as {@link defineAnchorProvider} returns it: the definition with its stamp. */
export interface AnchorProvider extends AnchorProviderDefinition {
  /** The contract's stamp, its name and version, which the define function sets. */
  readonly contract: ContractStamp<"anchor-provider">;
}

/**
 * Defines an anchor provider: checks its ID and kind and stamps it with this contract's name and
 * version.
 *
 * @throws TypeError when the ID, the kind or a function isn't valid.
 */
export function defineAnchorProvider<const T extends AnchorProviderDefinition>(
  definition: T,
): T & { readonly contract: ContractStamp<"anchor-provider"> } {
  checkId("defineAnchorProvider", definition.id);
  checkId("defineAnchorProvider's kind", definition.kind);
  if (typeof definition.serialize !== "function" || typeof definition.resolve !== "function") {
    throw new TypeError("defineAnchorProvider needs serialize and resolve functions.");
  }
  return { ...definition, contract: CONTRACT };
}

/** Whether `value` is an anchor provider stamped with a version of this contract this copy serves. */
export function isAnchorProvider(value: unknown): value is AnchorProvider {
  return (
    typeof value === "object" &&
    value !== null &&
    stampCompatible((value as { contract?: unknown }).contract, CONTRACT.name, CONTRACT.version) &&
    typeof (value as { serialize?: unknown }).serialize === "function" &&
    typeof (value as { resolve?: unknown }).resolve === "function"
  );
}
