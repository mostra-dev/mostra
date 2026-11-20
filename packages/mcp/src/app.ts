/**
 * The app-only tools (INTERFACES §12, D175 item 5): what an inline page in a chat host calls, through
 * the host's `tools/call`, to act through its link as a browser page does. Each is one route of
 * the app channel (`app/open`, `app/request`), so the gateway's own checks hold for every call; the
 * gateway checks each body against the browser protocol's own schemas. Their `_meta.ui.visibility`
 * is `["app"]`: a host never lists them to its model (MCP Apps, VERIFIED_FACTS, WP-17).
 */
import type { CallToolResult } from "@modelcontextprotocol/server";
import {
  APP_TOOLS,
  type AppRoute,
  appOpenMethod,
  appRequestMethod,
  createDiagnostic,
  linkSecret,
  RpcError,
} from "@mostra/protocol";
import * as z from "zod";
import type { McpServerOptions } from "./ports.ts";

/** The `_meta` of a tool only an app calls. */
export const APP_ONLY_META: Readonly<Record<string, unknown>> = { ui: { visibility: ["app"] } };

const artifactId = z
  .string()
  .regex(/^art_[0-9A-HJKMNP-TV-Z]{26}$/)
  .describe("The artifact the page shows (art_…).");
const session = z
  .string()
  .min(1)
  .max(64)
  .describe("The page's app session, as app_open answered it.");
const revision = z
  .string()
  .regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/)
  .optional()
  .describe(
    "The browser protocol's revision the page speaks; the newest the gateway serves when left out.",
  );
const body = z
  .record(z.string(), z.unknown())
  .describe("The browser protocol's request body for this route (INTERFACES §4).");

/** One app-only tool: its route, input and how its arguments become `app/request`'s. */
export interface AppToolDefinition {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly input: z.ZodObject;
  run(args: Record<string, unknown>, options: McpServerOptions): Promise<CallToolResult>;
}

/** The answer of an app tool: the same value as text and as structured content. */
function answer(value: unknown): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(value) }],
    structuredContent: value as Record<string, unknown>,
  };
}

/** A tool over one browser-protocol route of the app channel. */
function routeTool(
  name: string,
  title: string,
  description: string,
  route: AppRoute,
  extra: Readonly<Record<string, z.ZodType>> = {},
): (register: (id: string, schema: z.ZodObject) => z.ZodObject) => AppToolDefinition {
  return (register) => {
    const input = register(
      `${name
        .split("_")
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join("")}Input`,
      z.object({ artifactId, session, revision, ...extra }),
    );
    return {
      name,
      title,
      description,
      input,
      async run(args, options) {
        const {
          artifactId: id,
          session: token,
          ...rest
        } = args as {
          artifactId: string;
          session: string;
        } & Record<string, unknown>;
        return answer(
          await options.instance.call(appRequestMethod, {
            artifactId: id,
            session: token,
            route,
            ...rest,
          }),
        );
      },
    };
  };
}

/** Every app-only tool, registered in the wire bundle through `register`. */
export function createAppTools(
  register: (id: string, schema: z.ZodObject) => z.ZodObject,
): readonly AppToolDefinition[] {
  const openInput = register(
    "AppOpenInput",
    z.object({
      artifactId,
      url: z
        .string()
        .min(1)
        .max(4096)
        .describe("The link the page acts through: artifact_open's structuredContent.mostra.url."),
      version: z.int().min(1).optional().describe("The version to open, by number."),
    }),
  );
  return [
    {
      name: APP_TOOLS.open,
      title: "Open the page's view",
      description:
        "Opens the inline page's view through its link: its session, the view and what the link allows. Called by the page, never the model.",
      input: openInput,
      async run(args, options) {
        const {
          artifactId: id,
          url,
          version,
        } = args as {
          artifactId: string;
          url: string;
          version?: number;
        };
        const token = linkSecret(url);
        if (token === undefined) {
          throw new RpcError(
            createDiagnostic("MOSTRA_HYGIENE_TOKEN_INVALID", {
              message: "The page's link carries no secret (#t=…).",
            }),
          );
        }
        return answer(
          await options.instance.call(appOpenMethod, {
            artifactId: id,
            token,
            ...(version !== undefined ? { version } : {}),
          }),
        );
      },
    },
    ...[
      routeTool(
        APP_TOOLS.fields,
        "Save the page's fields",
        "Saves a change to the page's fields (the browser protocol's fields route).",
        "fields",
        { body },
      ),
      routeTool(
        APP_TOOLS.submit,
        "Submit the page",
        "Submits the page's draft through the artifact channel (the submit route).",
        "submit",
        { body },
      ),
      routeTool(
        APP_TOOLS.signal,
        "Raise a signal",
        "Raises a signal the page sends, as its useSignal does (the signal route).",
        "signal",
        { body },
      ),
      routeTool(
        APP_TOOLS.call,
        "Call a server function",
        "Calls one of the page's server functions; its result's lines arrive whole (the call route).",
        "call",
        { fnId: z.string().min(1).max(1024).describe("The function's ID."), body },
      ),
      routeTool(
        APP_TOOLS.run,
        "Start or join an action run",
        "Starts an action run, or joins one (the runs route).",
        "runs",
        { body },
      ),
      routeTool(
        APP_TOOLS.runStatus,
        "Read action runs",
        "Reads the page's action runs and follows them for a minute (the runs/attach route).",
        "runs/attach",
        { body },
      ),
      routeTool(
        APP_TOOLS.runCancel,
        "Cancel an action run",
        "Cancels an action run (the runs/cancel route).",
        "runs/cancel",
        { runId: z.string().min(1).max(64).describe("The run (run_…)."), body },
      ),
      routeTool(
        APP_TOOLS.live,
        "Read live sources",
        "Reads live sources and keeps them produced for a minute (the live route).",
        "live",
        { body },
      ),
      routeTool(
        APP_TOOLS.respondents,
        "Read the respondents",
        "Reads who is expected to answer, as the page may see it (the respondents route).",
        "respondents",
        { body },
      ),
      routeTool(
        APP_TOOLS.events,
        "Read the page's events",
        "Long-polls the page's events after a cursor, or answers its snapshot without one (the events/poll route).",
        "events/poll",
        {
          view: z.string().min(1).max(64).describe("The page's view (vw_…)."),
          cursor: z
            .string()
            .regex(/^[0-9]{1,20}$/)
            .optional()
            .describe("The last cursor the page read."),
          wait: z
            .number()
            .min(0)
            .max(25)
            .optional()
            .describe("How long to wait for an event, in seconds (0 to 25)."),
        },
      ),
    ].map((make) => make(register)),
  ];
}
