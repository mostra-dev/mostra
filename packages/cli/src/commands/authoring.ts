/**
 * Authoring: `new`, `verify`, `publish` and `add`, thin clients of `artifact/create`,
 * `artifact/verify`, `artifact/publish` and `deps/add` (INTERFACES §6).
 */
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import {
  ARTIFACT_PROGRESS,
  artifactCreateMethod,
  artifactPublishMethod,
  artifactVerifyMethod,
  depsAddMethod,
  type SubmissionPolicy,
  type VerifyVerdict,
} from "@mostra/protocol";
import { type CommandDef, defineCommand } from "../command.ts";
import { EXIT } from "../exit.ts";
import { usage } from "../parse.ts";
import { arg, flag, sourceRef } from "./shared.ts";

/** `mostra new <dir>`. */
export const newCommand: CommandDef = defineCommand({
  path: ["new"],
  summary: "Create an artifact in an empty directory, with a generated ID.",
  args: [{ name: "dir", summary: "The directory to create it in; it must be empty or not exist." }],
  flags: [
    {
      name: "title",
      kind: "string",
      value: "<text>",
      summary: "The artifact's title. Default: the directory's name.",
    },
    {
      name: "template",
      kind: "string",
      value: "<family>",
      summary: "Start from a template (templates arrive in a later release).",
    },
    {
      name: "request-id",
      kind: "string",
      value: "<id>",
      summary: "Make a retry return the first attempt's result.",
    },
  ],
  output: { type: "ArtifactCreateResult", topic: "cli" },
  exits: [EXIT.failure],
  example: "new ./sidebar-review --title 'Sidebar review'",
  async run(context) {
    const title = flag(context, "title");
    const template = flag(context, "template");
    const requestId = flag(context, "request-id");
    const result = await context.call(artifactCreateMethod, {
      dir: resolve(context.cwd, arg(context, "dir")),
      ...(title !== undefined ? { title } : {}),
      ...(template !== undefined ? { template } : {}),
      ...(requestId !== undefined ? { requestId } : {}),
    });
    return {
      result,
      human: `Created ${result.artifactId} in ${result.dir}\n${result.files.map((file) => `  ${file}\n`).join("")}`,
    };
  },
});

/** The verdict for people: the status, each diagnostic, the screenshots worth looking at. */
function verdictText(verdict: VerifyVerdict): string {
  const lines = [`verify: ${verdict.status}`];
  for (const diagnostic of verdict.diagnostics) {
    const where =
      diagnostic.location && "file" in diagnostic.location
        ? ` ${diagnostic.location.file}:${diagnostic.location.line}:${diagnostic.location.column}`
        : "";
    const count =
      diagnostic.count !== undefined && diagnostic.count > 1 ? ` (×${diagnostic.count})` : "";
    lines.push(
      `  ${diagnostic.severity} ${diagnostic.code}${where}${count}: ${diagnostic.message}`,
    );
    if (diagnostic.hint) lines.push(`    ${diagnostic.hint}`);
  }
  for (const shot of verdict.screenshots.filter((screenshot) => screenshot.returned)) {
    lines.push(`  screenshot ${shot.viewport}: ${shot.path}`);
  }
  return `${lines.join("\n")}\n`;
}

/** `mostra verify <path>`. */
export const verifyCommand: CommandDef = defineCommand({
  path: ["verify"],
  summary: "Build, render and check an artifact's source; one verdict, nothing published.",
  args: [{ name: "path", summary: "The artifact's source: a file, a directory, or its ID." }],
  flags: [
    {
      name: "screenshots",
      kind: "string",
      value: "<when>",
      choices: ["on-failure", "always", "never"],
      default: "on-failure",
      summary: "Which screenshots the verdict marks as worth looking at.",
    },
  ],
  output: { type: "VerifyVerdict", topic: "cli" },
  exits: [EXIT.failure],
  example: "verify ./sidebar-review",
  async run(context) {
    const connection = await context.connection();
    const progressToken = randomUUID();
    connection?.onNotification(ARTIFACT_PROGRESS, (params) => {
      const { progressToken: token, stage } = (params ?? {}) as {
        progressToken?: string;
        stage?: string;
      };
      if (token === progressToken && typeof stage === "string") context.log(`verify: ${stage}`);
    });
    const screenshots = flag(context, "screenshots") as
      | "on-failure"
      | "always"
      | "never"
      | undefined;
    const verdict = await context.call(artifactVerifyMethod, {
      source: sourceRef(arg(context, "path"), context.cwd),
      progressToken,
      ...(screenshots !== undefined ? { screenshots } : {}),
    });
    context.record({
      event: "verify.result",
      fields: {
        status: verdict.status,
        codes: verdict.diagnostics.map((diagnostic) => diagnostic.code),
      },
    });
    return {
      result: verdict,
      human: verdictText(verdict),
      ...(verdict.status === "fail" ? { exit: EXIT.failure } : {}),
    };
  },
});

const POLICIES: Readonly<Record<string, SubmissionPolicy>> = {
  once: { policy: "once", scope: "per-artifact" },
  "once-per-viewer": { policy: "once", scope: "per-viewer" },
  epochs: { policy: "epochs" },
  none: { policy: "none" },
};

/** `mostra publish <path>`. */
export const publishCommand: CommandDef = defineCommand({
  path: ["publish"],
  summary:
    "Publish an artifact's source as a new immutable version, gated by verify, and print its link.",
  args: [{ name: "path", summary: "The artifact's source: a file, a directory, or its ID." }],
  flags: [
    {
      name: "force",
      kind: "boolean",
      summary: "Publish despite verify's errors and record their codes; never what didn't build.",
    },
    {
      name: "policy",
      kind: "string",
      value: "<policy>",
      choices: Object.keys(POLICIES),
      summary: "The submission policy to use, instead of the manifest's.",
    },
    {
      name: "request-id",
      kind: "string",
      value: "<id>",
      summary: "Make a retry return the first attempt's receipt.",
    },
  ],
  output: { type: "PublishReceipt", topic: "cli" },
  exits: [EXIT.failure, EXIT.conflict],
  example: "publish ./sidebar-review",
  async run(context) {
    const policyName = flag(context, "policy");
    const requestId = flag(context, "request-id");
    const force = context.flags["force"] === true;
    const receipt = await context.call(artifactPublishMethod, {
      source: sourceRef(arg(context, "path"), context.cwd),
      ...(force ? { force: true } : {}),
      ...(policyName !== undefined ? { policy: POLICIES[policyName] as SubmissionPolicy } : {}),
      ...(requestId !== undefined ? { requestId } : {}),
    });
    context.record({ event: "publish.done", fields: { reused: receipt.reused, forced: force } });
    const forced =
      receipt.forcedDiagnostics !== undefined && receipt.forcedDiagnostics.length > 0
        ? `Forced past: ${receipt.forcedDiagnostics.join(", ")}\n`
        : "";
    return {
      result: receipt,
      human: `${receipt.reused ? "Already published" : "Published"} version ${receipt.version} (${receipt.versionId}) of ${receipt.artifactId}\n${forced}${receipt.url ?? ""}\n`,
    };
  },
});

/** `mostra add <package…>`. */
export const addCommand: CommandDef = defineCommand({
  path: ["add"],
  summary:
    "Add npm packages to an artifact's lockfile at exact versions, installing them into the home's store.",
  args: [
    {
      name: "package",
      summary: "npm specs: name, name@version, name@range or name@tag.",
      variadic: true,
    },
  ],
  flags: [
    {
      name: "artifact",
      kind: "string",
      value: "<path|id>",
      summary: "The artifact. Default: the one in the current directory.",
    },
    {
      name: "request-id",
      kind: "string",
      value: "<id>",
      summary: "Make a retry return the first attempt's result.",
    },
  ],
  output: { type: "DepsAddResult", topic: "cli" },
  exits: [EXIT.failure],
  example: "add recharts@3 --artifact ./dashboard",
  async run(context) {
    const packages = context.args["package"];
    if (!Array.isArray(packages) || packages.length === 0)
      throw usage('"mostra add" needs <package…>.');
    const requestId = flag(context, "request-id");
    const result = await context.call(depsAddMethod, {
      artifact: sourceRef(flag(context, "artifact") ?? ".", context.cwd),
      packages: packages as string[],
      ...(requestId !== undefined ? { requestId } : {}),
    });
    return {
      result,
      human: result.packages
        .map((added) => `${added.name}@${added.version}${added.warm ? " (warm set)" : ""}\n`)
        .join(""),
    };
  },
});
