/**
 * The shell ↔ artifact bridge (INTERFACES §5, ROUND-3 §8, SH-04): JSON-RPC 2.0 over
 * `postMessage`, shaped like MCP Apps so exporting an artifact as an MCP App only swaps the
 * transport. Both ends accept a message only when it comes from the one window they talk to, at
 * its exact origin, and only when it is a message of the bridge's set with valid params; anything
 * else is dropped (or, for a request from the right window, answered with an error). It has no
 * I/O of its own: the caller hands it the window objects.
 *
 * ```ts
 * // In the shell:
 * const bridge = connectBridge({
 *   side: "shell",
 *   receiver: window,
 *   peer: () => frame.contentWindow,
 *   peerOrigin: "http://127.0.0.1:23457",
 *   onRequest: (message, params) => (message === uiInitialize ? initializeResult : undefined),
 * });
 * ```
 */
import * as z from "zod";
import type { MethodDefinition } from "./method.ts";
import { hostDiagnostic, JSON_RPC_ERROR_CODES, RpcError } from "./rpc/error.ts";
import { classifyMessage } from "./rpc/messages.ts";
import { RpcPeer } from "./rpc/peer.ts";
import { REVIEW_SET_ID_PATTERN, ViewContext } from "./view.ts";

/** Which end of the bridge: the trusted shell, or the artifact's frame. */
export type BridgeSide = "shell" | "artifact";

/** One message of the bridge's set. */
export interface BridgeMessage<P, R> {
  /** The JSON-RPC method name; MCP Apps' name where the concept exists. */
  readonly method: string;
  /** The side that sends it. */
  readonly from: BridgeSide;
  /** A request is answered; a notification isn't. */
  readonly kind: "request" | "notification";
  /** The schema of its params. */
  readonly params: z.ZodType<P>;
  /** The schema of a request's result (`z.undefined()` for notifications). */
  readonly result: z.ZodType<R>;
}

/** A bridge message of any params and result type. */
export type AnyBridgeMessage = BridgeMessage<unknown, unknown>;

/** The version of MCP Apps whose message shapes the bridge follows (VERIFIED_FACTS, MCP). */
export const MCP_APPS_PROTOCOL_VERSION = "2026-01-26";

/** An application's name and version (MCP's `Implementation`). */
export interface BridgeImplementation {
  /** A stable machine name, such as `mostra-shell`. */
  readonly name: string;
  /** Its release. */
  readonly version: string;
  /** A name for people. */
  readonly title?: string;
}

const Implementation: z.ZodType<BridgeImplementation> = z.looseObject({
  name: z.string(),
  version: z.string(),
  title: z.string().exactOptional(),
});

/** The params of `ui/initialize`: the artifact introduces itself (MCP Apps). */
export interface UiInitializeParams {
  /** The artifact's client runtime. */
  readonly appInfo: BridgeImplementation;
  /** What the artifact offers (MCP Apps' `McpUiAppCapabilities`). */
  readonly appCapabilities: Readonly<Record<string, unknown>>;
  /** The MCP Apps revision the artifact speaks, {@link MCP_APPS_PROTOCOL_VERSION}. */
  readonly protocolVersion: string;
  /**
   * What the page is (WP-07): the version whose build the frame loaded. An artifact origin serves
   * the version its frame session last entered (D98 item 5), so a frame reloaded after another
   * tab switched versions may hold another version than its view; the shell re-enters its own.
   */
  readonly mostra?: { readonly versionId: string };
}

/** What the shell tells the artifact about where it is shown (MCP Apps' `HostContext`). */
export interface BridgeHostContext {
  /** The viewer's color scheme. */
  readonly theme?: "light" | "dark";
  /** How the artifact is shown: the shell shows it `fullscreen`. */
  readonly displayMode?: "inline" | "fullscreen" | "pip";
  /** The display modes the shell offers. */
  readonly availableDisplayModes?: readonly string[];
  /** The viewer's language (BCP 47). */
  readonly locale?: string;
  /** The viewer's time zone (IANA). */
  readonly timeZone?: string;
  /** The kind of device. */
  readonly platform?: "web" | "desktop" | "mobile";
  /** Further MCP Apps context, passed through. */
  readonly [key: string]: unknown;
}

/** The result of `ui/initialize`: the shell introduces itself (MCP Apps). */
export interface UiInitializeResult {
  /** The MCP Apps revision both ends speak. */
  readonly protocolVersion: string;
  /** The shell. */
  readonly hostInfo: BridgeImplementation;
  /** What the shell offers (MCP Apps' `McpUiHostCapabilities`). */
  readonly hostCapabilities: Readonly<Record<string, unknown>>;
  /** Where and how the artifact is shown. */
  readonly hostContext: BridgeHostContext;
  /** Mostra's shell: the view this frame load is, and what the host allows in it (WP-07). */
  readonly mostra?: ViewContext;
}

/** `ui/initialize`: the artifact's first request, answered with the shell's context. */
export const uiInitialize: BridgeMessage<UiInitializeParams, UiInitializeResult> = {
  method: "ui/initialize",
  from: "artifact",
  kind: "request",
  params: z.looseObject({
    appInfo: Implementation,
    appCapabilities: z.record(z.string(), z.unknown()),
    protocolVersion: z.string().min(1),
    mostra: z.looseObject({ versionId: z.string().min(1).max(64) }).exactOptional(),
  }),
  result: z.looseObject({
    protocolVersion: z.string().min(1),
    hostInfo: Implementation,
    hostCapabilities: z.record(z.string(), z.unknown()),
    hostContext: z.looseObject({
      theme: z.enum(["light", "dark"]).exactOptional(),
      displayMode: z.enum(["inline", "fullscreen", "pip"]).exactOptional(),
      availableDisplayModes: z.array(z.string()).readonly().exactOptional(),
      locale: z.string().exactOptional(),
      timeZone: z.string().exactOptional(),
      platform: z.enum(["web", "desktop", "mobile"]).exactOptional(),
    }),
    mostra: ViewContext.exactOptional(),
  }),
};

/** `ui/notifications/initialized`: the artifact finished initializing; the shell may now send. */
export const uiInitialized: BridgeMessage<Readonly<Record<string, unknown>>, undefined> = {
  method: "ui/notifications/initialized",
  from: "artifact",
  kind: "notification",
  params: z.record(z.string(), z.unknown()),
  result: z.undefined(),
};

/** `ui/notifications/size-changed`: the artifact's rendered size (MCP Apps). */
export const uiSizeChanged: BridgeMessage<
  { readonly width?: number; readonly height?: number },
  undefined
> = {
  method: "ui/notifications/size-changed",
  from: "artifact",
  kind: "notification",
  params: z.looseObject({
    width: z.number().min(0).exactOptional(),
    height: z.number().min(0).exactOptional(),
  }),
  result: z.undefined(),
};

/**
 * The URL schemes `ui/open-link` opens: the web, mail and phone numbers. Anything else, such as
 * `javascript:` or `data:`, would run or show content in the shell's own context.
 */
export const OPEN_LINK_SCHEMES: readonly string[] = ["http:", "https:", "mailto:", "tel:"];

/**
 * `ui/open-link`: the artifact asks the shell to open a URL in a new tab (MCP Apps). The frame
 * can't navigate the viewer's tab itself (D98 item 7), so this is how an artifact sends the
 * viewer anywhere. `isError` is `true` when the shell couldn't open it.
 */
export const uiOpenLink: BridgeMessage<
  { readonly url: string },
  { readonly isError?: boolean; readonly [key: string]: unknown }
> = {
  method: "ui/open-link",
  from: "artifact",
  kind: "request",
  params: z.looseObject({ url: z.string().min(1).max(8192) }),
  result: z.looseObject({ isError: z.boolean().exactOptional() }),
};

/** `mostra/ready`: the artifact's page has rendered; `verify` waits for it (ROUND-3 §8). */
export const mostraReady: BridgeMessage<Readonly<Record<string, unknown>>, undefined> = {
  method: "mostra/ready",
  from: "artifact",
  kind: "notification",
  params: z.record(z.string(), z.unknown()),
  result: z.undefined(),
};

// ── Fields, pages, controls and versions (WP-07, INTERFACES §5, ROUND-3 §8) ──────────────

/** The page's save state, as the shell's rail shows it (D47). */
export type SaveState = "saved" | "saving" | "offline" | "conflict";

/** Why a field blocks a submit (INTERFACES §2.3). */
export interface SubmitBlocker {
  /** The field's ID. */
  readonly fieldId: string;
  /** Its label, when it has one. */
  readonly label?: string;
  /** `required` without a value, `invalid` by its `validate`, or a `conflict` not yet resolved. */
  readonly reason: "required" | "invalid" | "conflict";
}

/**
 * The longest label, validation message or other text a field carries over the bridge; a page
 * shortens longer ones before it sends them (Claude review finding 11).
 */
export const BRIDGE_TEXT_MAX = 1024;

/** The most fields or blockers one bridge message lists; a page sends those that matter first. */
export const BRIDGE_FIELDS_MAX = 10_000;

const SubmitBlockerSchema: z.ZodType<SubmitBlocker> = z.looseObject({
  fieldId: z.string().min(1).max(256),
  label: z.string().max(BRIDGE_TEXT_MAX).exactOptional(),
  reason: z.enum(["required", "invalid", "conflict"]),
});

/**
 * A field the page has mounted, with what the shell needs to list blockers by label (D52, D106).
 * The page reports it; the shell checks `required` against the draft it reads itself.
 */
export interface FieldRegistration {
  /** The field's ID. */
  readonly id: string;
  /** The label people see. */
  readonly label?: string;
  /** Whether a submit needs a value. */
  readonly required?: boolean;
  /** The viewer's draft or the artifact's shared state. */
  readonly scope: "viewer" | "artifact";
  /** Whether its value is kept out of events and logs. */
  readonly sensitive?: boolean;
  /** Its `validate` message for the current value, if any. */
  readonly error?: string;
  /** Whether it has a conflict the viewer hasn't resolved. */
  readonly conflict?: boolean;
}

/** The params of `mostra/fields`. */
export interface FieldsParams {
  /** Every mounted field, once per ID. */
  readonly fields: readonly FieldRegistration[];
  /** The page's save state. */
  readonly save: SaveState;
  /** Whether edits are waiting to be saved (typed, offline, or in the journal). */
  readonly unsaved: boolean;
}

/**
 * `mostra/fields`: the page's mounted fields and save state, sent whenever they change, so the
 * shell lists blockers by label and its rail shows "Saving" and "Saved" (INTERFACES §5).
 */
export const mostraFields: BridgeMessage<FieldsParams, undefined> = {
  method: "mostra/fields",
  from: "artifact",
  kind: "notification",
  params: z.looseObject({
    fields: z
      .array(
        z.looseObject({
          id: z.string().min(1).max(256),
          label: z.string().max(BRIDGE_TEXT_MAX).exactOptional(),
          required: z.boolean().exactOptional(),
          scope: z.enum(["viewer", "artifact"]),
          sensitive: z.boolean().exactOptional(),
          error: z.string().max(BRIDGE_TEXT_MAX).exactOptional(),
          conflict: z.boolean().exactOptional(),
        }),
      )
      .max(BRIDGE_FIELDS_MAX)
      .readonly(),
    save: z.enum(["saved", "saving", "offline", "conflict"]),
    unsaved: z.boolean(),
  }),
  result: z.undefined(),
};

/**
 * `mostra/page`: the page the viewer is on, inside a `pages/` artifact (D57), so comments record
 * it (WP-20). `path` is the route's path with its search and hash, whatever the history mode.
 */
export const mostraPage: BridgeMessage<
  { readonly path: string; readonly title?: string },
  undefined
> = {
  method: "mostra/page",
  from: "artifact",
  kind: "notification",
  params: z.looseObject({
    path: z.string().min(1).max(2048),
    title: z.string().max(1024).exactOptional(),
  }),
  result: z.undefined(),
};

/** A trusted control the artifact asks the shell for (INTERFACES §5): the artifact asks, the shell decides. */
export type ControlRequest =
  | {
      /** Relabel the shell's trusted Submit, with an optional confirmation text. */
      readonly control: "submit";
      readonly label?: string;
      readonly confirm?: string;
    }
  | {
      /** Render a trusted Choose for a review set's candidates (D113). */
      readonly control: "choose";
      readonly reviewSetId: string;
      readonly candidates: readonly { readonly id: string; readonly label?: string }[];
      /** The candidate the page shows now, which Choose names. */
      readonly current?: string;
    }
  | {
      /** Withdraw an earlier request: the Submit label, or a review set's Choose. */
      readonly control: "release";
      readonly submit?: true;
      readonly reviewSetId?: string;
    };

/** The longest Submit label the shell renders: one short line. */
export const CONTROL_LABEL_MAX = 48;

/**
 * `mostra/controls.request`: the artifact asks the shell for a trusted control (D06, SH-02). The
 * shell renders it in its own origin, where the artifact can neither click nor reach it, and
 * answers whether it is shown: a control the host's policy leaves out is not (D108).
 */
export const mostraControlsRequest: BridgeMessage<ControlRequest, { readonly shown: boolean }> = {
  method: "mostra/controls.request",
  from: "artifact",
  kind: "request",
  params: z.discriminatedUnion("control", [
    z.looseObject({
      control: z.literal("submit"),
      label: z.string().min(1).max(CONTROL_LABEL_MAX).exactOptional(),
      confirm: z.string().min(1).max(500).exactOptional(),
    }),
    z.looseObject({
      control: z.literal("choose"),
      reviewSetId: z.string().regex(REVIEW_SET_ID_PATTERN),
      candidates: z
        .array(
          z.looseObject({
            id: z.string().min(1).max(256),
            label: z.string().max(CONTROL_LABEL_MAX).exactOptional(),
          }),
        )
        .min(1)
        .max(64)
        .readonly(),
      current: z.string().min(1).max(256).exactOptional(),
    }),
    z.looseObject({
      control: z.literal("release"),
      submit: z.literal(true).exactOptional(),
      reviewSetId: z.string().regex(REVIEW_SET_ID_PATTERN).exactOptional(),
    }),
  ]) as unknown as z.ZodType<ControlRequest>,
  result: z.looseObject({ shown: z.boolean() }),
};

/** What the page answers `mostra/flush`. */
export interface FlushResult {
  /** The viewer's draft revision once every save landed. */
  readonly revision: string;
  /** Whether edits still wait (offline, or a save failed). */
  readonly unsaved: boolean;
  /** What blocks a submit now: invalid values and open conflicts, and required fields the page sees empty. */
  readonly blockers: readonly SubmitBlocker[];
}

/**
 * `mostra/flush`: the shell asks the page to save everything now, before its trusted Submit or a
 * switch to a newer version (IN-02, D110). For a submit, the page first writes the defaults the
 * viewer saw. The shell checks the answer against the draft it reads itself.
 */
export const mostraFlush: BridgeMessage<{ readonly reason: "submit" | "switch" }, FlushResult> = {
  method: "mostra/flush",
  from: "shell",
  kind: "request",
  params: z.looseObject({ reason: z.enum(["submit", "switch"]) }),
  result: z.looseObject({
    revision: z.string().regex(/^(0|[1-9][0-9]{0,15})$/),
    unsaved: z.boolean(),
    blockers: z.array(SubmitBlockerSchema).max(BRIDGE_FIELDS_MAX).readonly(),
  }),
};

/** The params of `mostra/version.available`. */
export interface VersionAvailableParams {
  /** The newer version's ID. */
  readonly versionId: string;
  /** Its number. */
  readonly version: number;
  /** How many of the viewer's answers it doesn't carry over (D42). */
  readonly orphans: number;
}

/**
 * `mostra/version.available`: a newer version was published while the page is open (VR-04). The
 * shell always shows its own trusted banner; the page may show a notice too.
 */
export const mostraVersionAvailable: BridgeMessage<VersionAvailableParams, undefined> = {
  method: "mostra/version.available",
  from: "shell",
  kind: "notification",
  params: z.looseObject({
    versionId: z.string().min(1),
    version: z.int().min(1),
    orphans: z.int().min(0),
  }),
  result: z.undefined(),
};

/** `mostra/field.focus`: the viewer picked a blocker in the shell; the page focuses that field. */
export const mostraFieldFocus: BridgeMessage<{ readonly id: string }, undefined> = {
  method: "mostra/field.focus",
  from: "shell",
  kind: "notification",
  params: z.looseObject({ id: z.string().min(1).max(256) }),
  result: z.undefined(),
};

/**
 * Every message of the bridge in this release. WP-20 adds review messages; a message never
 * changes meaning once released (D32).
 */
export const BRIDGE_MESSAGES: readonly AnyBridgeMessage[] = [
  uiInitialize,
  uiInitialized,
  uiSizeChanged,
  uiOpenLink,
  mostraReady,
  mostraFields,
  mostraPage,
  mostraControlsRequest,
  mostraFlush,
  mostraVersionAvailable,
  mostraFieldFocus,
] as readonly AnyBridgeMessage[];

/** The window events arrive on (`window` itself). */
export interface BridgeReceiver {
  /** Starts delivering `message` events to `listener`. */
  addEventListener(type: "message", listener: (event: BridgeEvent) => void): void;
  /** Stops delivering them. */
  removeEventListener(type: "message", listener: (event: BridgeEvent) => void): void;
}

/** The parts of a `MessageEvent` the bridge reads. */
export interface BridgeEvent {
  /** The message. */
  readonly data: unknown;
  /** The sender's origin, as the browser reports it. */
  readonly origin: string;
  /** The sending window. */
  readonly source: unknown;
}

/** The window messages go to: the frame's `contentWindow`, or the shell (`window.parent`). */
export interface BridgePeer {
  /** Posts `message` to the window, delivered only if its origin is `targetOrigin`. */
  postMessage(message: unknown, targetOrigin: string): void;
}

/** Why the bridge dropped a message, for logs and tests. */
export type BridgeRejection =
  | "wrong-source"
  | "wrong-origin"
  | "not-json-rpc"
  | "unknown-method"
  | "wrong-direction"
  | "invalid-params";

/** Options for {@link connectBridge}. */
export interface BridgeOptions {
  /** This end. It accepts only messages the other side sends. */
  readonly side: BridgeSide;
  /** Where messages arrive. */
  readonly receiver: BridgeReceiver;
  /** The window this end talks to, looked up on every message (a frame's window changes on reload). */
  readonly peer: () => BridgePeer | null | undefined;
  /** The peer's exact origin. Messages from any other origin are dropped. */
  readonly peerOrigin: string;
  /** Answers a request from the peer; throw an {@link RpcError} to answer with an error. */
  readonly onRequest?: (message: AnyBridgeMessage, params: unknown) => unknown;
  /** Receives a notification from the peer. */
  readonly onNotification?: (message: AnyBridgeMessage, params: unknown) => void;
  /** Hears about every dropped message. */
  readonly onRejected?: (reason: BridgeRejection, event: BridgeEvent) => void;
}

/** One end of a connected bridge. */
export interface Bridge {
  /** Sends a request this side may send and resolves with its validated result. */
  call<P, R>(message: BridgeMessage<P, R>, params: P, options?: { timeoutMs?: number }): Promise<R>;
  /** Sends a notification this side may send. */
  notify<P>(message: BridgeMessage<P, undefined>, params: P): void;
  /** Stops listening; waiting calls reject. */
  close(): void;
}

const asMethod = <P, R>(message: BridgeMessage<P, R>): MethodDefinition<P, R> => ({
  method: message.method,
  direction: "client-to-instance",
  mutating: false,
  params: message.params,
  result: message.result,
});

/**
 * Connects one end of the bridge. Every incoming message must come from `peer()` at exactly
 * `peerOrigin`, be a JSON-RPC message, name a message the other side sends, and carry valid params.
 */
export function connectBridge(options: BridgeOptions): Bridge {
  const known = new Map(BRIDGE_MESSAGES.map((message) => [message.method, message]));
  const send = (message: unknown): void => {
    const peer = options.peer();
    if (!peer) throw new Error("The bridge's peer window is gone.");
    peer.postMessage(message, options.peerOrigin);
  };
  const rpc = new RpcPeer({
    send,
    onRequest: (method, params) => {
      const message = known.get(method);
      if (!message || message.from === options.side || message.kind !== "request") {
        throw new RpcError(
          hostDiagnostic("MOSTRA_HOST_METHOD_UNKNOWN", {
            message: `The bridge has no request ${method} for this side.`,
          }),
          JSON_RPC_ERROR_CODES.methodNotFound,
        );
      }
      if (!options.onRequest) {
        throw new RpcError(
          hostDiagnostic("MOSTRA_HOST_METHOD_UNKNOWN", {
            message: `This side doesn't answer ${method}.`,
          }),
          JSON_RPC_ERROR_CODES.methodNotFound,
        );
      }
      const parsed = message.params.safeParse(params ?? {});
      if (!parsed.success) {
        throw new RpcError(
          hostDiagnostic("MOSTRA_HOST_INVALID_PARAMS", {
            message: `Invalid params for ${method}.`,
          }),
          JSON_RPC_ERROR_CODES.invalidParams,
        );
      }
      return options.onRequest(message, parsed.data);
    },
    onNotification: (method, params) => {
      const message = known.get(method);
      if (message?.kind !== "notification" || message.from === options.side) return;
      const parsed = message.params.safeParse(params ?? {});
      if (parsed.success) options.onNotification?.(message, parsed.data);
    },
  });

  /** Why an incoming message must be dropped, or `undefined` when the RPC peer may take it. */
  const screen = (event: BridgeEvent): BridgeRejection | undefined => {
    const peer = options.peer();
    if (!peer || event.source !== peer) return "wrong-source";
    if (event.origin !== options.peerOrigin) return "wrong-origin";
    const classified = classifyMessage(event.data);
    if (classified.kind === "invalid") return "not-json-rpc";
    if (classified.kind !== "request" && classified.kind !== "notification") return undefined;
    const message = known.get(classified.message.method);
    if (!message) return "unknown-method";
    if (message.from === options.side) return "wrong-direction";
    if (!message.params.safeParse(classified.message.params ?? {}).success) return "invalid-params";
    return undefined;
  };
  const listener = (event: BridgeEvent): void => {
    const rejection = screen(event);
    if (rejection !== undefined) {
      options.onRejected?.(rejection, event);
      // A request from the right window still gets its error answer from the RPC peer.
      const answerable =
        rejection !== "wrong-source" &&
        rejection !== "wrong-origin" &&
        rejection !== "not-json-rpc" &&
        classifyMessage(event.data).kind === "request";
      if (!answerable) return;
    }
    rpc.receive(event.data);
  };
  options.receiver.addEventListener("message", listener);

  const sendable = (message: AnyBridgeMessage): void => {
    if (message.from !== options.side) {
      throw new Error(`The ${options.side} doesn't send ${message.method}.`);
    }
  };
  return {
    call(message, params, callOptions) {
      sendable(message as AnyBridgeMessage);
      return rpc.call(asMethod(message), params, callOptions ?? {});
    },
    notify(message, params) {
      sendable(message as AnyBridgeMessage);
      const parsed = message.params.parse(params);
      rpc.notify(message.method, parsed as Readonly<Record<string, unknown>>);
    },
    close() {
      options.receiver.removeEventListener("message", listener);
      rpc.close();
    },
  };
}
