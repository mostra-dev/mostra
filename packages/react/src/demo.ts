"use client";

/**
 * Web demos for the page (D185 item 6): `useDemo(name)` gives the address of a demo the version
 * keeps and how to show it, in every delivery target. Behind Mostra's gateway a demo is served from
 * the page's own origin under `/_mostra/demos/<name>/`; in a folder export from beside the page
 * (as built when the folder is served at its base, made relative when it is opened from disk); in
 * a single-file export from inside the page, when its build fits in one file. `<WebDemo>` in
 * `@mostra/kit/demo` frames it.
 */
import { useEffect, useMemo, useRef } from "react";

/** How a demo moves between its pages. */
export type DemoRouting = "history" | "hash";

/**
 * Where a demo stands: `ready` to show; `unknown` when the version declares no such demo;
 * `folder-only` in a single-file export that couldn't carry it; `unavailable` where no demo can
 * show (inline in a chat host).
 */
export type DemoStatus = "ready" | "unknown" | "folder-only" | "unavailable";

/** Options for {@link useDemo}. */
export interface DemoOptions {
  /** The page of the demo to open: `/settings`. Default its first page. */
  readonly path?: string;
}

/** A demo, as {@link useDemo} gives it. */
export interface DemoHandle {
  readonly name: string;
  readonly status: DemoStatus;
  /** The frame's address, when it is `ready` and served as files. */
  readonly src?: string;
  /** The demo's whole document, when it is `ready` inside a single-file export. */
  readonly srcdoc?: string;
  readonly routing: DemoRouting;
  /** Tells verify the frame loaded, so it stops waiting for it. */
  loaded(): void;
}

/** What an export says about its demos, in `<script id="mostra-export">` (written by the exporter). */
interface ExportFacts {
  /** The path the folder is meant to be served from; `/` unless `--base` named one. */
  readonly base?: string;
  readonly demos?: Readonly<
    Record<
      string,
      {
        /** The demo as built for `base`, relative to the page: `_mostra/demos/<name>/`. */
        readonly root?: string;
        /** The demo for opening from disk, relative to the page: `demos/<name>/`. */
        readonly disk?: string;
        /** A single-file export's demo: the ID of the element holding its document. */
        readonly document?: string;
        /** A single-file export that couldn't carry it. */
        readonly missing?: true;
      }
    >
  >;
}

/** The demos the version declares: `<meta name="mostra-demos">`. */
function declaredDemos(): Readonly<Record<string, { readonly routing?: DemoRouting }>> {
  if (typeof document === "undefined") return {};
  const content = document.querySelector('meta[name="mostra-demos"]')?.getAttribute("content");
  if (!content) return {};
  try {
    return JSON.parse(content) as Record<string, { routing?: DemoRouting }>;
  } catch {
    return {};
  }
}

function exportFacts(): ExportFacts | undefined {
  if (typeof document === "undefined") return undefined;
  const text = document.getElementById("mostra-export")?.textContent;
  if (!text) return undefined;
  try {
    return JSON.parse(text) as ExportFacts;
  } catch {
    return undefined;
  }
}

function target(): string {
  if (typeof document === "undefined") return "live";
  return (
    document.querySelector('meta[name="mostra-target"]')?.getAttribute("content")?.trim() ?? "live"
  );
}

/** A demo's page path without its leading `/`. */
function pagePath(path: string | undefined): string {
  return (path ?? "").replace(/^\/+/, "");
}

/** A single-file export's demo document, decoded from its base64 element. */
function documentOf(id: string): string | undefined {
  const text = document.getElementById(id)?.textContent?.trim();
  if (!text) return undefined;
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index !== binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return new TextDecoder().decode(bytes);
}

/**
 * Where a demo is, for this page now. Pure but for reading the page's own elements and address,
 * so every target answers the same way each render.
 */
export function resolveDemo(name: string, options: DemoOptions = {}): Omit<DemoHandle, "loaded"> {
  const declared = declaredDemos()[name];
  const routing: DemoRouting = declared?.routing ?? "history";
  if (declared === undefined) return { name, status: "unknown", routing };
  const where = target();
  const path = pagePath(options.path);
  if (where === "mcp-app") return { name, status: "unavailable", routing };
  if (where !== "static") {
    const page = routing === "hash" && path !== "" ? `#/${path}` : path;
    return { name, status: "ready", src: `/_mostra/demos/${name}/${page}`, routing };
  }
  const facts = exportFacts()?.demos?.[name];
  if (facts === undefined || facts.missing) return { name, status: "folder-only", routing };
  if (facts.document !== undefined) {
    const doc = documentOf(facts.document);
    return doc === undefined
      ? { name, status: "folder-only", routing }
      : { name, status: "ready", srcdoc: doc, routing };
  }
  const base = exportFacts()?.base ?? "/";
  const here = new URL(".", window.location.href);
  // As built, where the folder is served from the path it was built for; else the copy whose
  // paths are relative, which opens anywhere on its first page (D185 item 7).
  const served = here.protocol !== "file:" && here.pathname === base && facts.root !== undefined;
  const folder = served ? facts.root : (facts.disk ?? facts.root);
  if (folder === undefined) return { name, status: "folder-only", routing };
  const page = served
    ? path
    : routing === "hash" && path !== ""
      ? `index.html#/${path}`
      : "index.html";
  return { name, status: "ready", src: new URL(`${folder}${page}`, here).href, routing };
}

/** Demo frames still loading, which verify waits for. */
const loading = new Set<symbol>();

/** How many demo frames are still loading (`verify`'s probe counts them as pending work). */
export function pendingDemos(): number {
  return loading.size;
}

/** The longest verify waits for one demo's frame. */
const LOAD_WAIT_MS = 20_000;

/**
 * A demo the version keeps (D185 item 6), and where to show it: its frame's address (or, inside a
 * single-file export, its document), whether it is there at all, and how it routes. A name the
 * version doesn't declare is `unknown`, reported on the console as `MOSTRA_DEMO_UNKNOWN`.
 */
export function useDemo(name: string, options: DemoOptions = {}): DemoHandle {
  const path = options.path;
  const resolved = useMemo(
    () => resolveDemo(name, path !== undefined ? { path } : {}),
    [name, path],
  );
  const src = resolved.src;
  const token = useRef<symbol | undefined>(undefined);
  useEffect(() => {
    // A new address is a new load to wait for.
    void src;
    if (resolved.status === "unknown") {
      console.error(
        `MOSTRA_DEMO_UNKNOWN: the page shows the demo "${name}", which its version doesn't declare in defineArtifact({ demos }).`,
      );
      return;
    }
    if (resolved.status !== "ready") return;
    const mark = Symbol(name);
    token.current = mark;
    loading.add(mark);
    const timer = setTimeout(() => loading.delete(mark), LOAD_WAIT_MS);
    return () => {
      clearTimeout(timer);
      loading.delete(mark);
    };
  }, [name, resolved.status, src]);
  return {
    ...resolved,
    loaded: () => {
      if (token.current !== undefined) loading.delete(token.current);
    },
  };
}
