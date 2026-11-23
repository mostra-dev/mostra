/**
 * The review layer's shapes (WP-20; D23, RV-01 to RV-05, CO-06): where a comment points (its
 * anchor, every layer that applies), the threads and comments a page shows, a person as a page may
 * know them, and the crop each thread keeps. The bridge's review messages, the shell's review
 * routes, results, `review/export` and the `reviews` and `capture` ports share them, so they live in
 * a module of their own that the bridge, which every version embeds, imports without the
 * interaction schemas.
 */
import * as z from "zod";
import { REVIEW_SET_ID_PATTERN } from "./view.ts";
import { wireRegistry } from "./wire-registry.ts";

/** The longest comment, in characters. */
export const REVIEW_TEXT_MAX = 10_000;
/** The most people one comment mentions. */
export const REVIEW_MENTIONS_MAX = 20;
/** The most W3C selectors one anchor keeps. */
export const ANCHOR_SELECTORS_MAX = 4;
/** The longest selector text, CSS or quoted. */
export const ANCHOR_TEXT_MAX = 2_048;
/** The most nested frames an anchor descends through. */
export const ANCHOR_FRAMES_MAX = 8;
/** An anchor provider's data, as JSON, at most this many characters (the contract's 16 KiB). */
export const ANCHOR_PROVIDER_DATA_MAX: number = 16 * 1024;

/** A rectangle in CSS pixels. */
export interface AnchorRect {
  /** Its left edge. */
  readonly x: number;
  /** Its top edge. */
  readonly y: number;
  /** Its width. */
  readonly width: number;
  /** Its height. */
  readonly height: number;
}

const Finite = z.number().min(-1e7).max(1e7);
const Size = z.number().min(0).max(1e7);

/** The Zod schema of the `AnchorRect` type. */
export const AnchorRect: z.ZodType<AnchorRect> = z
  .object({ x: Finite, y: Finite, width: Size, height: Size })
  .register(wireRegistry, {
    id: "AnchorRect",
    description: "A rectangle in CSS pixels.",
  });

/**
 * A W3C Web Annotation selector (D23): CSS, a quote of the text with what surrounds it, or a media
 * fragment (`xywh=percent:…`) of the element the anchor names.
 */
export type AnchorSelector =
  | { readonly type: "CssSelector"; readonly value: string }
  | {
      readonly type: "TextQuoteSelector";
      readonly exact: string;
      readonly prefix?: string;
      readonly suffix?: string;
    }
  | { readonly type: "FragmentSelector"; readonly conformsTo: string; readonly value: string };

const Text = z.string().max(ANCHOR_TEXT_MAX);

/** The Zod schema of the `AnchorSelector` type. */
export const AnchorSelector: z.ZodType<AnchorSelector> = z
  .discriminatedUnion("type", [
    z.object({ type: z.literal("CssSelector"), value: Text.min(1) }),
    z.object({
      type: z.literal("TextQuoteSelector"),
      exact: Text.min(1),
      prefix: Text.exactOptional(),
      suffix: Text.exactOptional(),
    }),
    z.object({
      type: z.literal("FragmentSelector"),
      conformsTo: z.string().max(256),
      value: z.string().min(1).max(256),
    }),
  ])
  .register(wireRegistry, {
    id: "AnchorSelector",
    description: "A W3C Web Annotation selector: CSS, a text quote, or a media fragment.",
  }) as z.ZodType<AnchorSelector>;

/**
 * Where a comment points: every layer that applies, resolved in this order when the page shows
 * it again: an anchor provider's data, the semantic `data-review-id`, the CSS selector (refined by
 * the quote), the quote alone, then the rectangle; past all of them, the crop shows the place.
 */
export interface ReviewAnchor {
  /** The nearest `data-review-id` around the target: the layer agents act on. */
  readonly reviewId?: string;
  /** W3C selectors of the target, most specific first. */
  readonly selectors?: readonly AnchorSelector[];
  /** The target's box, in the top page's document coordinates (CSS pixels). */
  readonly rect?: AnchorRect;
  /** Where the viewer pointed, in the same coordinates. */
  readonly point?: { readonly x: number; readonly y: number };
  /** The frame's viewport when the comment was made. */
  readonly viewport?: { readonly width: number; readonly height: number; readonly dpr: number };
  /** Whether the viewer saw the page light or dark, so its crop shows it as they saw it. */
  readonly appearance?: "light" | "dark";
  /** How far the page was scrolled then. */
  readonly scroll?: { readonly x: number; readonly y: number };
  /** The page of a `pages/` artifact (D57). */
  readonly page?: string;
  /** The review set and candidate the target is in (ROUND-3 §2). */
  readonly reviewSetId?: string;
  /** The candidate of that review set it is on. */
  readonly candidateId?: string;
  /** An anchor provider's layer: what a chart's datum, a slide or a timeline adds (D172 item 2). */
  readonly provider?: {
    readonly id: string;
    readonly kind: string;
    readonly data: Readonly<Record<string, unknown>>;
    readonly label?: string;
  };
  /**
   * The nested frames the target is in, outermost first: each frame element's CSS selector in its
   * document. `served`: the frame's page answered with its own anchor (an injected bridge or the
   * client runtime); otherwise it is opaque and the anchor is its coordinates and crop.
   */
  readonly frames?: readonly { readonly selector: string; readonly served: boolean }[];
  /** What the target is, for people: `Button "Send"`, `Revenue, March`. */
  readonly label?: string;
  /** A slide and its step (decks, WP-21). */
  readonly slide?: { readonly index: number; readonly step: number };
  /** A time, in seconds (timelines and video, WP-21). */
  readonly time?: number;
}

const ID = z.string().min(1).max(256);

/** The Zod schema of the `ReviewAnchor` type. */
export const ReviewAnchor: z.ZodType<ReviewAnchor> = z
  .object({
    reviewId: ID.exactOptional(),
    selectors: z.array(AnchorSelector).max(ANCHOR_SELECTORS_MAX).readonly().exactOptional(),
    rect: AnchorRect.exactOptional(),
    point: z.object({ x: Finite, y: Finite }).exactOptional(),
    viewport: z
      .object({ width: Size, height: Size, dpr: z.number().min(0.1).max(16) })
      .exactOptional(),
    appearance: z.enum(["light", "dark"]).exactOptional(),
    scroll: z.object({ x: Finite, y: Finite }).exactOptional(),
    page: z.string().min(1).max(2048).exactOptional(),
    reviewSetId: z.string().regex(REVIEW_SET_ID_PATTERN).exactOptional(),
    candidateId: ID.exactOptional(),
    provider: z
      .object({
        id: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,63}$/),
        kind: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,63}$/),
        data: z.record(z.string(), z.unknown()),
        label: z.string().max(256).exactOptional(),
      })
      .exactOptional(),
    frames: z
      .array(z.object({ selector: Text.min(1), served: z.boolean() }))
      .max(ANCHOR_FRAMES_MAX)
      .readonly()
      .exactOptional(),
    label: z.string().max(256).exactOptional(),
    slide: z.object({ index: z.int().min(0), step: z.int().min(0) }).exactOptional(),
    time: z.number().min(0).exactOptional(),
  })
  .register(wireRegistry, {
    id: "ReviewAnchor",
    description:
      "Where a comment points: provider data, data-review-id, W3C selectors, coordinates with viewport, page and candidate.",
  });

/** Which layer of an anchor found its place again, or `none` (the crop shows it). */
export type AnchorLayer = "provider" | "reviewId" | "selector" | "text" | "rect" | "none";

/** The Zod schema of the `AnchorLayer` type. */
export const AnchorLayer: z.ZodType<AnchorLayer> = z.enum([
  "provider",
  "reviewId",
  "selector",
  "text",
  "rect",
  "none",
]);
