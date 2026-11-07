/**
 * `mostra login` and `mostra logout` (INTERFACES §18.7, D165 items 2, 15): this home signs in to a
 * remote server by the OAuth device authorization grant, so `mostra share --cloud` can host its
 * artifacts there, and signs out again. The instance keeps the refresh token in the home,
 * owner-only; signing out keeps its instance link, so the artifacts it shared stay its own at the
 * next sign-in, unless `--forget`. Clients of `remote/login`, `remote/login.wait` and
 * `remote/logout`.
 */
import { remoteLoginMethod, remoteLoginWaitMethod, remoteLogoutMethod } from "@mostra/protocol";
import { type CommandDef, defineCommand } from "../command.ts";
import { EXIT } from "../exit.ts";

/** How long `mostra login` waits for the person to approve, in all (the code lives 10 minutes). */
const LOGIN_WAIT_MS = 10 * 60_000;
/** Each wait asks the instance for this long, so a slow approval never meets a request timeout. */
const LOGIN_STEP_MS = 30_000;

/** `mostra login [<server>] [--default]`. */
export const loginCommand: CommandDef = defineCommand({
  path: ["login"],
  summary:
    "Sign this machine's Mostra in to a remote server, so mostra share --cloud can host pages there.",
  args: [
    {
      name: "server",
      summary:
        "The server's address, such as https://api.example.com. Default: the server signed in to last.",
      optional: true,
    },
  ],
  flags: [
    {
      name: "default",
      kind: "boolean",
      summary:
        "Make this machine the account's default, the one chat apps create pages on. Default: the first machine linked.",
    },
  ],
  output: { type: "RemoteLoginWaitResult", topic: "cli" },
  exits: [EXIT.failure, EXIT.environment],
  example: "login https://api.example.com",
  async run(context) {
    const server = context.args["server"];
    const started = await context.call(remoteLoginMethod, {
      ...(typeof server === "string" ? { server: server.replace(/\/+$/, "") } : {}),
      ...(context.flags["default"] === true ? { default: true } : {}),
    });
    const where = started.verificationUriComplete ?? started.verificationUri;
    context.emit(
      { kind: "code", ...started },
      `Open ${where} and check that it shows the code ${started.userCode}, then approve.\nWaiting for you to approve…`,
    );
    const deadline = Date.now() + LOGIN_WAIT_MS;
    for (;;) {
      const waited = await context.call(remoteLoginWaitMethod, {
        loginId: started.loginId,
        timeoutMs: Math.max(0, Math.min(LOGIN_STEP_MS, deadline - Date.now())),
      });
      if (waited.status === "signed-in") {
        return {
          result: waited,
          human: `Signed in to ${waited.server} as ${waited.account.name ?? waited.account.id}. This machine is ${waited.instanceId}.\n`,
        };
      }
      if (Date.now() >= deadline) {
        return {
          result: waited,
          human: "The code wasn't approved in time. Run mostra login again for a new one.\n",
          exit: EXIT.timeout,
        };
      }
    }
  },
});

/** `mostra logout [<server>] [--forget]`. */
export const logoutCommand: CommandDef = defineCommand({
  path: ["logout"],
  summary:
    "Sign this machine's Mostra out of a remote server; its hosted pages keep working, and their answers wait for the next sign-in.",
  args: [
    {
      name: "server",
      summary: "The server's address. Default: the server signed in to last.",
      optional: true,
    },
  ],
  flags: [
    {
      name: "forget",
      kind: "boolean",
      summary:
        "Also forget this machine's link to the server: the pages it shared there are no longer its own.",
    },
  ],
  output: { type: "RemoteLogoutResult", topic: "cli" },
  exits: [EXIT.failure, EXIT.environment],
  example: "logout",
  async run(context) {
    const server = context.args["server"];
    const result = await context.call(remoteLogoutMethod, {
      ...(typeof server === "string" ? { server: server.replace(/\/+$/, "") } : {}),
      ...(context.flags["forget"] === true ? { forget: true } : {}),
    });
    return {
      result,
      human:
        result.servers.length === 0
          ? "This machine wasn't signed in to a server.\n"
          : `Signed out of ${result.servers.join(", ")}.\n`,
    };
  },
});
