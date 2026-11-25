/// <reference lib="dom" />
/**
 * The page's side of the shell's review overlay (WP-20): it answers `mostra/review.hitTest` and
 * `mostra/review.scrollTo`, follows `mostra/review.track` with `mostra/review.positions`, and tells
 * the shell the page's review sets (`mostra/surfaces`). The agent that reads the DOM loads only
 * when the shell first asks, so a page nobody reviews carries none of it.
 */
import {
  type Bridge,
  mostraReviewHitTest,
  mostraReviewPositions,
  mostraReviewScroll,
  mostraReviewScrollTo,
  mostraReviewSelection,
  mostraReviewTrack,
  mostraSurfaces,
  type ReviewAnchor,
  type ReviewSurface,
} from "@mostra/protocol";
import { listenShell } from "../shell-bridge.ts";

type Agent = typeof import("./agent.ts");
let agent: Promise<Agent> | undefined;
const loadAgent = (): Promise<Agent> => {
  agent ??= import("./agent.ts");
  return agent;
};

/** The review sets the page shows now, by ID (`useReviewSurface`). */
const surfaces = new Map<string, ReviewSurface>();
let surfaceBridge: Bridge | undefined;
let surfacesScheduled = false;

/** Tells the shell the page's review sets, once per change. */
function reportSurfaces(): void {
  if (surfacesScheduled) return;
  surfacesScheduled = true;
  queueMicrotask(() => {
    surfacesScheduled = false;
    try {
      surfaceBridge?.notify(mostraSurfaces, { sets: [...surfaces.values()] });
    } catch (error) {
      console.error("Mostra: the page's review sets couldn't be reported to the shell.", error);
    }
  });
}

/** Shows a review set to the shell, or changes it; returns the function that withdraws it. @internal */
export function showSurface(surface: ReviewSurface): () => void {
  surfaces.set(surface.id, surface);
  reportSurfaces();
  return () => {
    if (surfaces.get(surface.id) === surface) {
      surfaces.delete(surface.id);
      reportSurfaces();
    }
  };
}

/**
 * Tells the shell where the words the viewer selects are, and when the selection ends, so the shell
 * offers to comment on them beside it (WP-20, after Mirza's review). The agent that measures them
 * loads with the page's first selection of words, so a page nobody selects in carries none of it.
 */
function reportSelections(bridge: Bridge): void {
  const first = (): void => {
    const selection = document.getSelection();
    if (!selection || selection.isCollapsed) return;
    document.removeEventListener("selectionchange", first);
    void loadAgent().then(({ watchSelections }) =>
      watchSelections(document, (rect) => {
        try {
          bridge.notify(mostraReviewSelection, rect ? { rect } : {});
        } catch (error) {
          console.error("Mostra: the selection couldn't be reported to the shell.", error);
        }
      }),
    );
  };
  document.addEventListener("selectionchange", first);
}

/** Answers the shell's review messages on this page's bridge. */
export function wireReview(bridge: Bridge): void {
  surfaceBridge = bridge;
  reportSelections(bridge);
  if (surfaces.size > 0) reportSurfaces();
  let stopTracking: (() => void) | undefined;
  let generation = 0;
  listenShell({
    request: async (message, params) => {
      if (message === mostraReviewHitTest) {
        const { x, y, selection } = params as { x: number; y: number; selection?: true };
        const { hitTest, selectionHit } = await loadAgent();
        return selection ? selectionHit(document) : hitTest(document, x, y);
      }
      if (message === mostraReviewScrollTo) {
        const { anchor } = params as { anchor: ReviewAnchor };
        const { scrollTo } = await loadAgent();
        const placed = await scrollTo(document, anchor);
        return { found: placed.layer !== "none" && placed.rect !== undefined };
      }
      return undefined;
    },
    notification: (message, params) => {
      if (message === mostraReviewScroll) {
        const { x, y, dx, dy } = params as { x: number; y: number; dx: number; dy: number };
        void loadAgent().then(({ scrollAt }) => scrollAt(document, x, y, dx, dy));
        return;
      }
      if (message !== mostraReviewTrack) return;
      const anchors = (params as { anchors: { id: string; anchor: ReviewAnchor }[] }).anchors;
      generation += 1;
      const mine = generation;
      stopTracking?.();
      stopTracking = undefined;
      void loadAgent().then(({ trackAnchors }) => {
        if (mine !== generation) return;
        stopTracking = trackAnchors(document, anchors, (positions) => {
          try {
            bridge.notify(mostraReviewPositions, { positions });
          } catch (error) {
            console.error("Mostra: the anchors' places couldn't be reported to the shell.", error);
          }
        });
      });
    },
  });
}
