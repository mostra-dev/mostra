/**
 * What the page sends the shell, fitted to the bridge's limits (Claude review finding 11): a long
 * label or validation message is shortened, and a page with more fields than one message lists
 * sends those that matter first. A report the bridge refuses would leave the shell's rail and its
 * blocker list stale, and a refused flush answer would stop every trusted Submit.
 */
import { BRIDGE_FIELDS_MAX, BRIDGE_TEXT_MAX, type SubmitBlocker } from "@mostra/protocol";

/** Text shortened to what the bridge carries. */
export function clip(text: string): string {
  return text.length <= BRIDGE_TEXT_MAX ? text : `${text.slice(0, BRIDGE_TEXT_MAX - 1)}…`;
}

/** At most {@link BRIDGE_FIELDS_MAX} items, those that matter first, in their order otherwise. */
export function firstThatMatter<T>(items: readonly T[], matters: (item: T) => boolean): T[] {
  if (items.length <= BRIDGE_FIELDS_MAX) return [...items];
  return [...items.filter(matters), ...items.filter((item) => !matters(item))].slice(
    0,
    BRIDGE_FIELDS_MAX,
  );
}

/** Blockers as the bridge carries them: labels shortened, at most {@link BRIDGE_FIELDS_MAX}. */
export function blockersForShell(blockers: readonly SubmitBlocker[]): SubmitBlocker[] {
  return blockers
    .slice(0, BRIDGE_FIELDS_MAX)
    .map((blocker) =>
      blocker.label === undefined ? blocker : { ...blocker, label: clip(blocker.label) },
    );
}
