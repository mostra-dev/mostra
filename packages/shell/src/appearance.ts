/**
 * Light or dark for the shell's own chrome (D171 item 6): the device's setting until the person
 * chooses with the chrome's one button, then their choice, kept in this origin's storage (a hosted
 * shell keeps no cookie, D165 item 8). The artifact keeps its own look: only the shell's document
 * changes.
 */

const KEY = "mostra.appearance";

export type Chosen = "light" | "dark";

function stored(): Chosen | undefined {
  try {
    const value = localStorage.getItem(KEY);
    return value === "light" || value === "dark" ? value : undefined;
  } catch {
    return undefined;
  }
}

/** Puts the person's choice, if any, on the shell's document. Call before the first render. */
export function applyAppearance(): void {
  const chosen = stored();
  if (chosen) document.documentElement.dataset["appearance"] = chosen;
  else delete document.documentElement.dataset["appearance"];
}

/** The appearance in force now: the person's choice, else the device's. */
export function currentAppearance(): Chosen {
  const chosen = document.documentElement.dataset["appearance"];
  if (chosen === "light" || chosen === "dark") return chosen;
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** Turns a light shell dark and a dark one light, and keeps the choice where it can. */
export function toggleAppearance(): Chosen {
  const next: Chosen = currentAppearance() === "dark" ? "light" : "dark";
  document.documentElement.dataset["appearance"] = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    // Storage refused (a full or blocked storage): the choice lasts this page.
  }
  return next;
}
