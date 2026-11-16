import * as z from "zod";
import { ArtifactId, ViewId } from "../../ids.ts";
import { defineMethod, type MethodDefinition } from "../../method.ts";
import { wireRegistry } from "../../wire-registry.ts";

/**
 * The browser-protocol routes an inline page reaches through `app/request` (INTERFACES §4, D175
 * item 4): every route a page's runtime uses, but the stream (a page in a chat host long-polls)
 * and the ticket and presence routes (no service worker, and presence isn't offered inline).
 */
export const APP_ROUTES = [
  "fields",
  "submit",
  "signal",
  "call",
  "runs",
  "runs/attach",
  "runs/cancel",
  "live",
  "respondents",
  "events/poll",
] as const;

/** One of {@link APP_ROUTES}. */
export type AppRoute = (typeof APP_ROUTES)[number];

/** The params of `app/request` (INTERFACES §6, D175 item 4). */
export interface AppRequestParams {
  /** The artifact the session is for. */
  readonly artifactId: string;
  /** The app session `app/open` answered. */
  readonly session: string;
  /** The route. */
  readonly route: AppRoute;
  /** The route's JSON body, as a browser sends it (`FieldsRequest`, `SubmitRequest` …). */
  readonly body?: Readonly<Record<string, unknown>>;
  /** The function a `call` names (`<module path>#<export>`). */
  readonly fnId?: string;
  /** The run a `runs/cancel` names. */
  readonly runId?: string;
  /** `events/poll`'s view: the page's own (`app/open`'s `viewId`). */
  readonly view?: string;
  /** `events/poll`'s cursor: the newest the page holds; without one the answer is a snapshot. */
  readonly cursor?: string;
  /** `events/poll`'s wait for an event, in seconds (0 to 25). */
  readonly wait?: number;
  /** The browser-protocol revision the page speaks (`BROWSER_PROTOCOL_REVISION` by default). */
  readonly revision?: string;
}

/**
 * The result of `app/request`: what the route answered, as a browser would read it. A refusal is
 * an answer too (its `status` and the diagnostic as `body`), so a page reads both the same way.
 */
export interface AppRequestResult {
  /** The route's HTTP status. */
  readonly status: number;
  /** Its JSON body, when it has one. */
  readonly body?: unknown;
  /** A `call`'s NDJSON lines (`CallLine`), in order, once it ended. */
  readonly lines?: readonly unknown[];
}

const params: z.ZodType<AppRequestParams> = z
  .object({
    artifactId: ArtifactId.schema,
    session: z.string().min(1).max(64),
    route: z.enum(APP_ROUTES),
    body: z.record(z.string(), z.unknown()).exactOptional(),
    fnId: z.string().min(1).max(1024).exactOptional(),
    runId: z.string().min(1).max(64).exactOptional(),
    view: ViewId.schema.exactOptional(),
    cursor: z
      .string()
      .regex(/^[0-9]{1,20}$/)
      .exactOptional(),
    wait: z.number().min(0).max(25).exactOptional(),
    revision: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .exactOptional(),
  })
  .register(wireRegistry, { id: "AppRequestParams" });

const result: z.ZodType<AppRequestResult> = z
  .object({
    status: z.int().min(100).max(599),
    body: z.unknown().exactOptional(),
    lines: z.array(z.unknown()).readonly().exactOptional(),
  })
  .register(wireRegistry, { id: "AppRequestResult" });

/**
 * `app/request` (D175 item 4): runs one browser-protocol route for an inline page, with its app
 * session, through the gateway's own checked route table: the session, its link's life and the
 * route's scope, exactly as for a browser. Idempotent by the route's own keys (a mutation ID, a
 * run's client key, a submit's expected revision), as in a browser.
 */
export const appRequestMethod: MethodDefinition<AppRequestParams, AppRequestResult> = defineMethod({
  method: "app/request",
  direction: "client-to-instance",
  mutating: true,
  params,
  result,
});
