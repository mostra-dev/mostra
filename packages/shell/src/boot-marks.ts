/**
 * The shell's start, step by step, in the browser's performance timeline: `mostra:shell:<step>`
 * marks (the script ran, the person's appearance was read, the session asked for and read, the
 * browser key read, a frame ticket asked for, the frame greeted, each `data-shell` state). A
 * person's tools and Mostra's tests read them (`performance.getEntriesByType("mark")`), so a
 * start that stalls names the step it stalled after (#95, #39: Firefox on Windows once spent 25 s
 * between loading the shell's scripts and its first request). Nothing is shown or sent.
 */
export function bootMark(step: string): void {
  try {
    globalThis.performance?.mark(`mostra:shell:${step}`);
  } catch {
    // A browser without the User Timing API: nothing to mark.
  }
}
