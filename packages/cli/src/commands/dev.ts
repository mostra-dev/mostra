/**
 * `mostra dev` (VR-08, D140 item 12): a development preview of unpublished source with hot
 * reload, until Ctrl-C. It prints the preview's link and then what happens in the session (built,
 * reloaded, server restarted, submissions with their Results, diagnostics) as a stream: NDJSON
 * envelopes with `--json`, lines otherwise. Viewers never reach a preview; it isn't a version.
 */
import {
  createDiagnostic,
  DEV_NOTIFY,
  type DevNotifyParams,
  type Diagnostic,
  devStartMethod,
  devStopMethod,
  RpcError,
} from "@mostra/protocol";
import { type CommandDef, defineCommand } from "../command.ts";
import { EXIT } from "../exit.ts";
import { arg, sourceRef } from "./shared.ts";

/** One event's line without `--json`. */
function line(event: DevNotifyParams): string {
  const files = event.files && event.files.length > 0 ? `: ${event.files.join(", ")}` : "";
  switch (event.kind) {
    case "built":
      return `Updated${files}\n`;
    case "reloaded":
      return `Reloaded${files}\n`;
    case "server-restarted":
      return `Server code restarted${files}\n`;
    case "submission":
      return `Submission recorded (not delivered):\n${JSON.stringify(event.results, null, 2)}\n`;
    case "diagnostics":
      return `${(event.diagnostics ?? [])
        .map((diagnostic: Diagnostic) => `${diagnostic.code}: ${diagnostic.message}`)
        .join("\n")}\n`;
  }
}

export const devCommand: CommandDef = defineCommand({
  path: ["dev"],
  summary:
    "Preview an artifact's unpublished source with hot reload, until Ctrl-C; viewers never see it.",
  args: [{ name: "path", summary: "The artifact's source: a file, a directory, or its ID." }],
  flags: [
    {
      name: "port",
      kind: "number",
      value: "<port>",
      summary: "The preview's port on 127.0.0.1; default one the system picks.",
    },
  ],
  output: { type: "DevStartResult", topic: "cli" },
  exits: [EXIT.failure, EXIT.environment],
  example: "dev ./sidebar-review",
  streams: true,
  async run(context) {
    const connection = await context.connection();
    let sessionId: string | undefined;
    const early: DevNotifyParams[] = [];
    const show = (event: DevNotifyParams): void => {
      if (event.kind === "diagnostics") {
        for (const diagnostic of event.diagnostics ?? []) context.warn(diagnostic);
      }
      context.emit(event, line(event));
    };
    connection?.onNotification(DEV_NOTIFY, (params) => {
      const event = params as DevNotifyParams;
      if (sessionId === undefined) early.push(event);
      else if (event.sessionId === sessionId) show(event);
    });
    const portFlag = context.flags["port"];
    const started = await context.call(devStartMethod, {
      source: sourceRef(arg(context, "path"), context.cwd),
      ...(typeof portFlag === "number" ? { port: portFlag } : {}),
    });
    sessionId = started.sessionId;
    context.emit(
      { kind: "started", ...started },
      `Development preview, not published: ${started.url}\nPress Ctrl-C to stop.\n`,
    );
    for (const event of early.splice(0)) if (event.sessionId === sessionId) show(event);
    // The session lasts until Ctrl-C (or SIGTERM; Ctrl+Break on Windows), or until the instance
    // ends it.
    let stop: () => void = () => {};
    const signals = ["SIGINT", "SIGTERM", "SIGBREAK"] as const;
    const ended = await new Promise<"signal" | "closed">((done) => {
      stop = (): void => done("signal");
      for (const signal of signals) process.once(signal, stop);
      void connection?.closed.then(() => done("closed"));
    });
    for (const signal of signals) process.off(signal, stop);
    if (ended === "closed") {
      throw new RpcError(
        createDiagnostic("MOSTRA_HOST_CONNECTION_CLOSED", {
          message: "The instance ended the development preview (it stopped or restarted).",
          hint: "Run mostra dev again.",
        }),
      );
    }
    await context.call(devStopMethod, { sessionId }).catch(() => undefined);
    return {
      result: { sessionId, stopped: "signal" },
      human: "Stopped.\n",
    };
  },
});
