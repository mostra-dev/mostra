"use client";
/**
 * `@mostra/kit/page-context`: whether a part sits inside the kit's `Page` (#242), so a
 * questionnaire there titles itself as a section. A module of its own, which no artifact holds an
 * older copy of: the questionnaire and the layout each read it, and an artifact that copied
 * `layout.tsx` before it existed still builds with the questionnaire of a later kit (Opus review
 * of WP-19, finding 3). Internal to the kit's modules.
 *
 * @packageDocumentation
 */
import * as React from "react";

/** `true` inside the kit's `Page`. */
export const InsidePage: React.Context<boolean> = React.createContext(false);

/** Whether the calling part is inside the kit's `Page` (`@mostra/kit/layout`). */
export function useInsidePage(): boolean {
  return React.useContext(InsidePage);
}
