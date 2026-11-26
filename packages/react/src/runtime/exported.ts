/**
 * What an export tells its page (D185 items 7 and 8): the facts the exporter writes into
 * `<script type="application/json" id="mostra-export">` (the artifact, when it was exported, what
 * the page loses, its live values as they were) and a snapshot's frozen answers
 * (`id="mostra-snapshot"`); and the export's notice, a small bar at the foot of the page that
 * names what doesn't work here. Written by `@mostra/plugin-mcp-app`'s built-in exporters.
 */
import type { LiveState } from "@mostra/protocol";

/** An export's facts, as the exporter writes them. */
export interface ExportFacts {
  readonly as: "static" | "html" | "snapshot";
  readonly artifactId: string;
  readonly title?: string;
  /** When the page was exported. */
  readonly exportedAt: string;
  /** What the page loses here. */
  readonly unavailable?: {
    readonly actions: readonly string[];
    readonly live: readonly string[];
    readonly submit: boolean;
  };
  /** The live sources' values when the page was exported, as the gateway's `live` route gave them. */
  readonly live?: readonly LiveState[];
  /** The sentence about web servers, for a single file holding a history-routed demo (M106). */
  readonly notice?: string;
}

/** A snapshot's frozen answers and state (`snapshot.json`'s, D185 item 7). */
export interface SnapshotFacts {
  /** When the values are from. */
  readonly at: string;
  /** Viewer-scoped answers by field ID. */
  readonly answers: Readonly<Record<string, unknown>>;
  /** Artifact-scoped state by field ID, unless the export left it out. */
  readonly state?: Readonly<Record<string, unknown>>;
}

function jsonOf<T>(id: string): T | undefined {
  if (typeof document === "undefined") return undefined;
  const text = document.getElementById(id)?.textContent;
  if (!text) return undefined;
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined;
  }
}

/** The export's facts, in an exported page. */
export function readExport(): ExportFacts | undefined {
  return jsonOf<ExportFacts>("mostra-export");
}

/** A snapshot's answers, in a snapshot's page. */
export function readSnapshot(): SnapshotFacts | undefined {
  return jsonOf<SnapshotFacts>("mostra-snapshot");
}

/**
 * The store's storage for a snapshot: its frozen values, read under the store's key prefix, never
 * written (a snapshot's page is read-only).
 */
export function snapshotStorage(
  snapshot: SnapshotFacts,
  prefix: string,
): Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length"> {
  const entries = new Map<string, string>();
  for (const [id, value] of Object.entries(snapshot.answers)) {
    entries.set(`${prefix}viewer:${id}`, JSON.stringify(value));
  }
  for (const [id, value] of Object.entries(snapshot.state ?? {})) {
    entries.set(`${prefix}artifact:${id}`, JSON.stringify(value));
  }
  const keys = [...entries.keys()];
  return {
    getItem: (key) => entries.get(key) ?? null,
    setItem: () => undefined,
    removeItem: () => undefined,
    key: (index) => keys[index] ?? null,
    get length() {
      return keys.length;
    },
  };
}

/** A count and a noun: "1 action", "3 actions". */
function counted(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** What the page loses here, as one phrase: "Submit, 3 actions and live data". */
function lost(facts: ExportFacts): string | undefined {
  const parts: string[] = [];
  if (facts.unavailable?.submit) parts.push("Submit");
  if (facts.unavailable?.actions.length)
    parts.push(counted(facts.unavailable.actions.length, "action"));
  if (facts.unavailable?.live.length) parts.push("live data");
  if (parts.length === 0) return undefined;
  return parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}

/** The notice's words. */
export function noticeText(facts: ExportFacts): string {
  const day = new Date(facts.exportedAt).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const sentences: string[] = [];
  if (facts.as === "snapshot") {
    sentences.push(
      `A snapshot of this page as it was on ${day}. Nothing here can be changed or sent.`,
    );
  } else {
    sentences.push(`A copy of this page, exported on ${day}.`);
    const missing = lost(facts);
    if (missing) sentences.push(`${missing} work only on the live page.`);
  }
  if (facts.notice) sentences.push(facts.notice);
  return sentences.join(" ");
}

/** Shows the export's notice at the foot of the page, apart from the page's own styles. */
export function mountExportNotice(facts: ExportFacts): void {
  if (typeof document === "undefined") return;
  const host = document.createElement("div");
  host.setAttribute("data-mostra-export-notice", "");
  const root = host.attachShadow({ mode: "open" });
  const bar = document.createElement("div");
  bar.setAttribute("role", "note");
  bar.style.cssText = [
    "position:fixed",
    "left:12px",
    "right:12px",
    "bottom:12px",
    "z-index:2147483647",
    "display:flex",
    "gap:12px",
    "align-items:flex-start",
    "padding:10px 14px",
    "border-radius:10px",
    "background:rgba(24,24,27,0.92)",
    "color:#fafafa",
    "font:13px/1.45 system-ui,-apple-system,Segoe UI,sans-serif",
    "box-shadow:0 4px 16px rgba(0,0,0,0.2)",
  ].join(";");
  const text = document.createElement("span");
  text.textContent = noticeText(facts);
  text.style.flex = "1";
  const close = document.createElement("button");
  close.type = "button";
  close.textContent = "×";
  close.setAttribute("aria-label", "Dismiss");
  close.style.cssText =
    "border:0;background:transparent;color:inherit;font:inherit;font-size:16px;line-height:1;cursor:pointer;padding:0 2px";
  close.addEventListener("click", () => host.remove());
  bar.append(text, close);
  root.append(bar);
  const attach = (): void => {
    document.body.append(host);
  };
  if (document.body) attach();
  else document.addEventListener("DOMContentLoaded", attach, { once: true });
}
