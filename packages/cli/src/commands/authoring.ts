/**
 * Authoring: `new`, `verify`, `publish`, `export`, `run` and `add`, thin clients of
 * `artifact/create`, `artifact/verify`, `artifact/publish`, `artifact/export`, `artifact/import`
 * and `deps/add` (INTERFACES §6, §15).
 */
import { randomUUID } from "node:crypto";
import { readFile, realpath, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  ARTIFACT_PROGRESS,
  applyFixes,
  artifactCreateMethod,
  artifactExportMethod,
  artifactImportMethod,
  artifactPublishMethod,
  artifactVerifyMethod,
  type DiagnosticFix,
  depsAddMethod,
  packAddMethod,
  pluginExportMethod,
  type SubmissionPolicy,
  type VerifyVerdict,
} from "@mostra/protocol";
import { packVariables, parsePackAddress } from "@mostra/protocol/plugin";
import {
  type CommandContext,
  type CommandDef,
  type CommandOutcome,
  defineCommand,
} from "../command.ts";
import { EXIT } from "../exit.ts";
import { usage } from "../parse.ts";
import { arg, artifactRef, flag, sourceRef } from "./shared.ts";

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
  if (verdict.theme) {
    const how = verdict.theme.requested
      ? " (--theme)"
      : verdict.theme.default
        ? " (the default: the manifest names no kit.theme)"
        : "";
    lines.push(`  theme: ${verdict.theme.stack.join(", ")}${how}`);
  }
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

/** One file `--fix` changed, and how many fixes it took. */
export interface FixedFile {
  /** The file, relative to the artifact. */
  readonly file: string;
  readonly fixes: number;
}

/** The most rounds `--fix` makes: a fix that overlapped another is applied in the next one. */
const FIX_ROUNDS = 3;

/**
 * Applies the text fixes a verdict carries to the artifact's files (KT-08): `replace`, `insert`
 * and `delete` fixes of files inside the artifact, each file read and written whole. A fix naming
 * a file outside the artifact is left alone. Returns the files changed.
 */
export async function applyVerdictFixes(verdict: VerifyVerdict): Promise<FixedFile[]> {
  const path = verdict.artifact.path;
  // Real paths, so a link inside the artifact can't carry a write outside it.
  const root = await realpath((await stat(path)).isDirectory() ? path : dirname(path));
  const within = (file: string): boolean => {
    const inside = relative(root, file);
    return (
      inside !== "" && inside !== ".." && !inside.startsWith(`..${sep}`) && !isAbsolute(inside)
    );
  };
  const byFile = new Map<string, DiagnosticFix[]>();
  for (const diagnostic of verdict.diagnostics) {
    const fix = diagnostic.fix;
    if (fix === undefined || fix.kind === "command" || fix.file === undefined) continue;
    let file = resolve(root, fix.file);
    if (!within(file)) continue;
    try {
      file = await realpath(file);
    } catch {
      continue; // A file that isn't there has nothing to fix.
    }
    if (!within(file)) continue;
    byFile.set(file, [...(byFile.get(file) ?? []), fix]);
  }
  const fixed: FixedFile[] = [];
  for (const [file, fixes] of [...byFile].sort(([a], [b]) => a.localeCompare(b))) {
    const text = await readFile(file, "utf8");
    const after = applyFixes(text, fixes);
    if (after.applied === 0 || after.text === text) continue;
    await writeFile(file, after.text);
    fixed.push({ file: relative(root, file).replaceAll("\\", "/"), fixes: after.applied });
  }
  return fixed;
}

/** A bare name, which may name a kit item; a version, a range or a scope makes it an npm spec. */
const BARE_ITEM = /^[a-z0-9][a-z0-9._-]*$/;

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
    {
      name: "theme",
      kind: "list",
      value: "<theme,…>",
      summary:
        "Build the page in this theme stack for this verify only, in place of the manifest's kit.theme (mostra theme list).",
    },
    {
      name: "fix",
      kind: "boolean",
      summary:
        "Apply the fixes verify finds to the artifact's files, then verify again; `fixed` lists the files changed.",
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
    const source = sourceRef(arg(context, "path"), context.cwd);
    const theme = context.flags["theme"] as readonly string[] | undefined;
    const verifyOnce = () =>
      context.call(artifactVerifyMethod, {
        source,
        progressToken,
        ...(screenshots !== undefined ? { screenshots } : {}),
        ...(theme !== undefined && theme.length > 0 ? { theme } : {}),
      });
    let verdict = await verifyOnce();
    const fix = context.flags["fix"] === true;
    const fixed = new Map<string, number>();
    for (let round = 0; fix && round < FIX_ROUNDS; round++) {
      const changed = await applyVerdictFixes(verdict);
      if (changed.length === 0) break;
      for (const file of changed) fixed.set(file.file, (fixed.get(file.file) ?? 0) + file.fixes);
      context.log(`verify: fixed ${changed.map((file) => file.file).join(", ")}; verifying again`);
      verdict = await verifyOnce();
    }
    context.record({
      event: "verify.result",
      fields: {
        status: verdict.status,
        codes: verdict.diagnostics.map((diagnostic) => diagnostic.code),
      },
    });
    const fixedFiles = [...fixed].map(([file, fixes]) => ({ file, fixes }));
    const fixedText =
      fixedFiles.length === 0
        ? "fixed: nothing to fix\n"
        : `fixed: ${fixedFiles.map((file) => `${file.file} (${file.fixes})`).join(", ")}\n`;
    return {
      result: fix ? { ...verdict, fixed: fixedFiles } : verdict,
      human: (fix ? fixedText : "") + verdictText(verdict),
      // Only a verdict this CLI knows means passing exits 0: a newer instance's status it doesn't
      // know (#45 lets it arrive) fails the command, never passes it (Opus review of MT-01, 2).
      ...(verdict.status === "pass" ? {} : { exit: EXIT.failure }),
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

/** `mostra export <artifact> --as bundle --out <path>`. */
export const exportCommand: CommandDef = defineCommand({
  path: ["export"],
  summary: "Write a published version out of the home, as a portable bundle another home can run.",
  args: [{ name: "artifact", summary: "The artifact: its source path or its ID." }],
  flags: [
    {
      name: "as",
      kind: "string",
      value: "<exporter>",
      default: "bundle",
      summary:
        "What to write: `bundle`, the version's builds, manifest, lockfile and source; or the ID of an exporter a plugin of the artifact or the home contributes.",
    },
    {
      name: "option",
      kind: "list",
      value: "<name=value>",
      summary: "An option for a plugin's exporter; its value is read as JSON when it parses.",
    },
    {
      name: "out",
      kind: "string",
      value: "<path>",
      summary: "Where: a new directory, or one archive when it ends in .tar.zst.",
    },
    {
      name: "version",
      kind: "string",
      value: "<number|id>",
      summary: "The version. Default: the latest.",
    },
  ],
  output: { type: "ArtifactExportResult", topic: "cli" },
  exits: [EXIT.failure],
  example: "export ./sidebar-review --out ./sidebar-review.tar.zst",
  async run(context) {
    const out = flag(context, "out");
    if (out === undefined) throw usage('"mostra export" needs --out <path>.');
    const version = flag(context, "version");
    const as = flag(context, "as") ?? "bundle";
    if (as !== "bundle") return exportWithPlugin(context, as, out, version);
    const result = await context.call(artifactExportMethod, {
      artifact: artifactRef(arg(context, "artifact"), context.cwd),
      as: "bundle",
      out: resolve(context.cwd, out),
      ...(version !== undefined
        ? { version: /^\d+$/.test(version) ? Number(version) : version }
        : {}),
    });
    return {
      result,
      human: `Exported ${result.versionId} to ${result.files.join(", ")}\n`,
    };
  },
});

/** `export --as <id>` with an exporter a plugin contributes (`plugin/export`). */
async function exportWithPlugin(
  context: CommandContext,
  exporter: string,
  out: string,
  version: string | undefined,
): Promise<CommandOutcome> {
  const options: Record<string, unknown> = {};
  for (const pair of Array.isArray(context.flags["option"]) ? context.flags["option"] : []) {
    const at = pair.indexOf("=");
    if (at <= 0) throw usage(`--option ${pair} needs the form name=value.`);
    const raw = pair.slice(at + 1);
    let value: unknown = raw;
    try {
      value = JSON.parse(raw);
    } catch {
      // A plain string.
    }
    options[pair.slice(0, at)] = value;
  }
  const result = await context.call(pluginExportMethod, {
    artifact: artifactRef(arg(context, "artifact"), context.cwd),
    exporter,
    out: resolve(context.cwd, out),
    ...(Object.keys(options).length > 0 ? { options } : {}),
    ...(version !== undefined
      ? { version: /^\d+$/.test(version) ? Number(version) : version }
      : {}),
  });
  const lines = [
    `Exported ${result.versionId} with ${result.exporter.id} (${result.exporter.package}):`,
    ...result.files.map((file) => `  ${file}`),
    ...result.findings.map((finding) => `${finding.severity} ${finding.code}: ${finding.message}`),
  ];
  return { result, human: `${lines.join("\n")}\n` };
}

/** `mostra run <bundle>`. */
export const runCommand: CommandDef = defineCommand({
  path: ["run"],
  summary:
    "Make a bundle `mostra export` wrote a version of this home, with the same IDs, and print its link.",
  args: [{ name: "bundle", summary: "The bundle: its directory or its .tar.zst archive." }],
  flags: [
    {
      name: "request-id",
      kind: "string",
      value: "<id>",
      summary: "Make a retry return the first attempt's receipt.",
    },
  ],
  output: { type: "PublishReceipt", topic: "cli" },
  exits: [EXIT.failure],
  example: "run ./sidebar-review.tar.zst",
  async run(context) {
    const requestId = flag(context, "request-id");
    const receipt = await context.call(artifactImportMethod, {
      bundle: resolve(context.cwd, arg(context, "bundle")),
      ...(requestId !== undefined ? { requestId } : {}),
    });
    return {
      result: receipt,
      human: `${receipt.reused ? "Already here" : "Imported"}: version ${receipt.version} (${receipt.versionId}) of ${receipt.artifactId}\n${receipt.url ?? ""}\n`,
    };
  },
});

/** `mostra add <package|item…>`. */
export const addCommand: CommandDef = defineCommand({
  path: ["add"],
  summary:
    "Add npm packages to an artifact's lockfile, or copy source-pack items (the kit's, or any shadcn registry item) into it.",
  args: [
    {
      name: "package",
      summary:
        "Items: a kit part by name (button, dialog, mostra-questionnaire), a URL, a local .json, owner/repo/item on GitHub, @namespace/item, plugin:<package>/<item>; or npm specs (name, name@version, name@range, name@tag). A bare name the kit has is its item.",
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
      name: "overwrite",
      kind: "boolean",
      summary: "Replace files of the artifact that an item writes with other content.",
    },
    {
      name: "accept-license",
      kind: "list",
      value: "<id>",
      summary:
        "Acknowledge a license the items' packages bring (LicenseRef-…), recorded in the lockfile.",
    },
    {
      name: "request-id",
      kind: "string",
      value: "<id>",
      summary: "Make a retry return the first attempt's result.",
    },
  ],
  output: { type: "DepsAddResult | PackAddResult", topic: "cli" },
  exits: [EXIT.failure],
  example: "add button dialog --artifact ./review",
  async run(context) {
    const packages = context.args["package"];
    if (!Array.isArray(packages) || packages.length === 0)
      throw usage('"mostra add" needs <package…>.');
    const requestId = flag(context, "request-id");
    const artifact = sourceRef(flag(context, "artifact") ?? ".", context.cwd);
    // A local item is named from where the command runs.
    const specs = (packages as string[]).map((spec) => {
      const address = parsePackAddress(spec);
      return address?.kind === "file" ? resolve(context.cwd, address.path) : spec;
    });
    // A bare name may be a kit item (`mostra add button`, D181 item 7): the instance, which knows
    // the artifact's base and its kit, decides; a name with a version is always an npm package.
    if (!specs.some((spec) => parsePackAddress(spec) !== undefined || BARE_ITEM.test(spec))) {
      // Only npm packages: `deps/add`, as before packs existed.
      const accept = context.flags["accept-license"];
      const result = await context.call(depsAddMethod, {
        artifact,
        packages: specs,
        ...(Array.isArray(accept) && accept.length > 0 ? { acceptLicenses: [...accept] } : {}),
        ...(requestId !== undefined ? { requestId } : {}),
      });
      return {
        result,
        human: result.packages
          .map((added) => `${added.name}@${added.version}${added.warm ? " (warm set)" : ""}\n`)
          .join(""),
      };
    }
    const accept = context.flags["accept-license"];
    // The items are read with this shell's variables, not only the daemon's (which may have
    // started before a token was set): those the artifact's components.json names, GitHub's
    // tokens, shadcn's registry and the proxies (`packVariables`).
    const components =
      "path" in artifact
        ? await readFile(join(artifact.path, "components.json"), "utf8").catch(() => undefined)
        : undefined;
    const environment = Object.fromEntries(
      packVariables(components).flatMap((name) => {
        const value = context.env[name];
        return value !== undefined ? [[name, value]] : [];
      }),
    );
    const result = await context.call(packAddMethod, {
      artifact,
      specs,
      ...(context.flags["overwrite"] === true ? { overwrite: true } : {}),
      ...(Array.isArray(accept) && accept.length > 0 ? { acceptLicenses: [...accept] } : {}),
      ...(Object.keys(environment).length > 0 ? { environment } : {}),
      ...(requestId !== undefined ? { requestId } : {}),
    });
    for (const note of result.notes) context.warn(note);
    const lines = [
      ...result.items.map(
        (item) => `${item.name} (${item.type})${item.requiredBy ? `, for ${item.requiredBy}` : ""}`,
      ),
      ...result.files.map((file) => `  ${file.action} ${file.path}`),
      ...result.packages.map(
        (added) => `${added.name}@${added.version}${added.warm ? " (warm set)" : ""}`,
      ),
    ];
    return { result, human: lines.map((line) => `${line}\n`).join("") };
  },
});
