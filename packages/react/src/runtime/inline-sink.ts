"use client";

/**
 * Where hooks reach the inline chrome of a page in an MCP Apps host (D175 items 6, 7), without
 * loading it: the chrome, its host connection and its transport load only on an `mcp-app` page
 * (boot's dynamic import), and set this sink when they start. Anywhere else it stays empty and
 * every call here is a no-op.
 */
import type { ControlRequest } from "@mostra/protocol";

/** A feature a page inline can't have, each with its message (D175 item 7). */
export type Unavailable =
  | "presence"
  | "review"
  | "choose"
  | "versions"
  | "frames"
  | "origin"
  | "tools"
  | "streaming"
  | "calls"
  | "personal";

/** What the inline chrome offers hooks. */
export interface InlineSink {
  /** States in the bar that a feature isn't available here. */
  note(feature: Unavailable, detail?: string): void;
  /** Takes a trusted control's request: the bar offers the artifact channel's in its place. */
  control(request: ControlRequest): void;
  /** Asks the host to open a link. */
  openLink(url: string): Promise<boolean>;
}

let sink: InlineSink | undefined;

/** Installs the inline chrome; called once, as it starts. @internal */
export function setInlineSink(next: InlineSink): void {
  sink = next;
}

/** States that `feature` isn't available here, on a page inline; a no-op anywhere else. */
export function noteUnavailable(feature: Unavailable, detail?: string): void {
  sink?.note(feature, detail);
}

/** Where a trusted control's request goes on a page inline; `undefined` anywhere else. */
export function inlineControls(): ((request: ControlRequest) => void) | undefined {
  return sink === undefined ? undefined : (request) => sink?.control(request);
}

/** How a page inline opens a link (its host does); `undefined` anywhere else. */
export function inlineOpenLink(): ((url: string) => Promise<boolean>) | undefined {
  return sink === undefined ? undefined : (url) => sink?.openLink(url) ?? Promise.resolve(false);
}
