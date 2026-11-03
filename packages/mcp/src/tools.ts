/**
 * The MCP server's tools (INTERFACES §12, D61, D164 item 2): stateless, each taking explicit
 * handles (a directory, an artifact, a cursor) and calling the instance through the host
 * protocol. A tool is a definition: its name, its input schema (a wire-schema bundle, so a change
 * that isn't additive fails the snapshot check, D32), its description and what it does. The server
 * module registers them; nothing here knows the transport.
 */
import { randomUUID } from "node:crypto";
import type { CallToolResult, ToolAnnotations } from "@modelcontextprotocol/server";
import {
  type ArtifactRef,
  artifactCreateMethod,
  artifactListMethod,
  artifactPublishMethod,
  artifactVerifyMethod,
  CapabilityScope,
  createDiagnostic,
  type Diagnostic,
  Duration,
  livePushMethod,
  MutationId,
  RpcError,
  resultsGetMethod,
  stateGetMethod,
  statePatchMethod,
  viewDefaultMethod,
  viewLaunchMethod,
  viewUrlMethod,
  WaitCondition,
  waitMethod,
} from "@mostra/protocol";
import * as z from "zod";
import { planPatch } from "./patch.ts";
import type { McpServerOptions } from "./ports.ts";
import { errorResult, jsonResult, textResult } from "./results.ts";
import { searchDocs } from "./search.ts";

/** The registry of every tool's input schema, published as the `mcp-tools` bundle. */
export const toolRegistry: z.core.$ZodRegistry<{ id: string; description?: string }> = z.registry<{
  id: string;
  description?: string;
}>();

/** The longest `artifact_wait`, in seconds (INTERFACES §12, FAILURE_MODEL §9). */
export const WAIT_MAX_SECONDS = 50;

/** What a tool's run gets besides its arguments. */
export interface ToolCall {
  /** The ports and settings the server was built with. */
  readonly options: McpServerOptions;
  /** Reports progress to a client that asked for it (`progressToken`); a no-op otherwise. */
  progress(message: string): void;
}

/** One tool. */
export interface ToolDefinition<Input> {
  /** Its name in `tools/list`: short and stable (D32). */
  readonly name: string;
  /** Its display name. */
  readonly title: string;
  /** What the model reads to choose it (agent-facing prose, D74). */
  readonly description: string;
  /** Its arguments' schema, published in the `mcp-tools` bundle. */
  readonly input: z.ZodType<Input>;
  /** Hints for the client: whether it reads only, changes or destroys anything. */
  readonly annotations: ToolAnnotations;
  /** Does the tool's work; a throw becomes an `isError` result with its diagnostic. */
  run(args: Input, call: ToolCall): Promise<CallToolResult>;
}

/** An input schema, registered for the wire bundle under `id`. */
function input<T extends z.ZodObject>(id: string, schema: T): T {
  toolRegistry.add(schema, { id });
  return schema;
}

function defineTool<Input>(tool: ToolDefinition<Input>): ToolDefinition<unknown> {
  return tool as ToolDefinition<unknown>;
}

const ARTIFACT_ID = /^art_[0-9A-HJKMNP-TV-Z]{26}$/;

/** An artifact named by its ID, or by its directory (absolute, or inside the workspace). */
function artifactRef(value: string, options: McpServerOptions): ArtifactRef {
  return ARTIFACT_ID.test(value)
    ? { artifactId: value }
    : { path: options.workspace.resolveDir(value) };
}

const dirField = z
  .string()
  .min(1)
  .describe(
    "The artifact's directory: an absolute path, or a name inside the workspace folder (the server's instructions name it).",
  );
const artifactField = z
  .string()
  .min(1)
  .describe("The artifact: its ID (art_…), or its directory as artifact_create returned it.");

// ── Authoring ────────────────────────────────────────────────────────────────────────────

const createInput = input(
  "ArtifactCreateInput",
  z.object({
    dir: dirField
      .optional()
      .describe(
        "Where to create it: a directory that doesn't exist yet or is empty. Without it, a new folder in the workspace, named after the title.",
      ),
    title: z.string().min(1).max(200).optional().describe("The artifact's title."),
    template: z.string().min(1).optional().describe("A template to start from (none by default)."),
  }),
);

const writeInput = input(
  "ArtifactWriteInput",
  z.object({
    dir: dirField,
    files: z
      .array(
        z.object({
          path: z
            .string()
            .min(1)
            .describe(
              "Relative to the artifact's directory, such as index.tsx or components/chart.tsx.",
            ),
          content: z.string().describe("The file's whole content."),
          encoding: z
            .enum(["utf8", "base64"])
            .optional()
            .describe("utf8 (the default) for text; base64 for an image or other binary file."),
        }),
      )
      .default([])
      .describe("Files to write, each replaced whole."),
    deletes: z
      .array(z.string().min(1))
      .optional()
      .describe("Files to delete, relative to the artifact's directory."),
  }),
);

const patchInput = input(
  "ArtifactPatchInput",
  z.object({
    dir: dirField,
    path: z
      .string()
      .min(1)
      .optional()
      .describe(
        "The file to change, relative to the artifact's directory. Needed with edits; with a diff, it overrides the file the diff names.",
      ),
    edits: z
      .array(
        z.object({
          old: z
            .string()
            .describe("Text that appears exactly once in the file (empty to write a new file)."),
          new: z.string().describe("What replaces it."),
        }),
      )
      .min(1)
      .optional()
      .describe("Exact replacements, applied in order."),
    diff: z.string().min(1).optional().describe("A unified diff of one or more files."),
  }),
);

const verifyInput = input(
  "ArtifactVerifyInput",
  z.object({
    dir: dirField,
    screenshots: z
      .enum(["on-failure", "always", "never"])
      .optional()
      .describe(
        "Which screenshots come back as images: on-failure (the default), always (to look at the page), or never.",
      ),
  }),
);

const publishInput = input(
  "ArtifactPublishInput",
  z.object({
    dir: dirField,
    force: z
      .boolean()
      .optional()
      .describe("Publish even though verify reports errors; the version records them."),
  }),
);

// ── Viewing and interaction ──────────────────────────────────────────────────────────────

const openInput = input(
  "ArtifactOpenInput",
  z.object({
    artifact: artifactField,
    version: z
      .union([z.int().min(1), z.string().min(1)])
      .optional()
      .describe("A new link that opens only this version (its number or ID)."),
    viewer: z
      .object({
        ref: z
          .string()
          .min(1)
          .max(256)
          .describe("Your own stable key for the person, such as their email."),
        name: z.string().min(1).max(200).optional().describe("Their display name."),
      })
      .optional()
      .describe(
        "A new link for one person: their own draft and, under once per-viewer, their own submission.",
      ),
    scopes: z
      .array(CapabilityScope)
      .min(1)
      .optional()
      .describe(
        "A new link that allows only these: view, draft, submit, review, signal, action:*, action:<name>.",
      ),
    ttl: Duration.optional().describe(
      "A new link that stops working after this long, such as 24h or 7d.",
    ),
    open: z
      .boolean()
      .optional()
      .describe("Also open the link in a browser on this computer, for the person sitting at it."),
  }),
);

const waitInput = input(
  "ArtifactWaitInput",
  z.object({
    artifact: artifactField,
    until: WaitCondition.describe(
      "submitted, signal:<name>, state:<fieldId> or event:<type> (event:submission.* matches a family).",
    ),
    after: z
      .string()
      .regex(/^[0-9]{1,20}$/)
      .optional()
      .describe("Wait for what happens after this cursor: the one a previous wait returned."),
    timeoutSeconds: z
      .int()
      .min(0)
      .max(WAIT_MAX_SECONDS)
      .optional()
      .describe(
        `How long to wait, at most ${WAIT_MAX_SECONDS} seconds (the default); 0 checks once.`,
      ),
  }),
);

const resultsInput = input(
  "ArtifactResultsInput",
  z.object({
    artifact: artifactField,
    submission: z
      .string()
      .min(1)
      .optional()
      .describe("A submission's ID (sub_…); the latest by default."),
    format: z
      .enum(["md", "json"])
      .optional()
      .describe("md (the default): Markdown to read; json: the full Results structure."),
  }),
);

const listInput = input(
  "ArtifactListInput",
  z.object({
    filter: z
      .object({ family: z.string().min(1).optional().describe("Only artifacts of this family.") })
      .optional(),
  }),
);

const livePushInput = input(
  "LivePushInput",
  z.object({
    artifact: artifactField,
    key: z.string().min(1).max(128).describe("The live source's key."),
    value: z.unknown().describe("Any JSON value, at most 4 MiB."),
    mode: z
      .enum(["replace", "append"])
      .optional()
      .describe(
        "replace (the default): the new latest value; append: also kept in the source's ring.",
      ),
  }),
);

const stateGetInput = input(
  "StateGetInput",
  z.object({
    artifact: artifactField,
    ids: z
      .array(z.string().min(1))
      .optional()
      .describe("Only these field IDs; every field by default."),
  }),
);

const statePatchInput = input(
  "StatePatchInput",
  z.object({
    artifact: artifactField,
    ops: z
      .array(
        z.object({
          id: z.string().min(1).describe("The field ID."),
          value: z.unknown().optional().describe("The new value, any JSON."),
          delete: z.literal(true).optional().describe("Remove the field instead."),
        }),
      )
      .min(1)
      .describe("The changes, applied together."),
    baseRevision: z
      .string()
      .min(1)
      .optional()
      .describe(
        "The revision you last read: fields changed after it aren't overwritten and come back in conflicts.",
      ),
    mutationId: MutationId.schema
      .optional()
      .describe(
        "Your ID for this change (mut_ and a ULID), so a retry applies it once; one is made when you leave it out.",
      ),
  }),
);

const docsInput = input(
  "DocsSearchInput",
  z.object({
    query: z.string().min(1).max(500).optional().describe("What you want to know, in a few words."),
    topic: z
      .string()
      .min(1)
      .max(128)
      .optional()
      .describe(
        "A topic to read whole instead, such as guide, guide/answers or a diagnostic code.",
      ),
  }),
);

/** Reads a verdict's screenshots that are marked worth looking at, as image content. */
async function screenshotImages(
  verdict: {
    readonly screenshots: readonly {
      readonly path: string;
      readonly returned: boolean;
      readonly viewport: string;
    }[];
  },
  read: (path: string) => Promise<Uint8Array | undefined>,
): Promise<CallToolResult["content"]> {
  const content: CallToolResult["content"] = [];
  for (const shot of verdict.screenshots) {
    if (!shot.returned) continue;
    const bytes = await read(shot.path).catch(() => undefined);
    if (bytes === undefined) continue;
    content.push({ type: "text", text: `Screenshot ${shot.viewport}:` });
    content.push({
      type: "image",
      mimeType: "image/png",
      data: Buffer.from(bytes).toString("base64"),
    });
  }
  return content;
}

/** Every tool, in the order clients list them: the authoring loop first. */
export function createTools(
  readScreenshot: (path: string) => Promise<Uint8Array | undefined>,
): readonly ToolDefinition<unknown>[] {
  return [
    defineTool({
      name: "artifact_create",
      title: "Create an artifact",
      description:
        "Create a new artifact: a directory with an index.tsx page, an AGENTS.md and a CLAUDE.md. The page's defineArtifact holds the artifact's id: keep that line when you rewrite the page. Returns the directory to pass to the other tools.",
      input: createInput,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
      async run(args, { options }) {
        const dir =
          args.dir !== undefined
            ? options.workspace.resolveDir(args.dir)
            : await options.workspace.allocateDir(args.title);
        return jsonResult(
          await options.instance.call(artifactCreateMethod, {
            dir,
            ...(args.title !== undefined ? { title: args.title } : {}),
            ...(args.template !== undefined ? { template: args.template } : {}),
          }),
        );
      },
    }),
    defineTool({
      name: "artifact_write",
      title: "Write artifact files",
      description:
        "Write files of an artifact, each replaced whole, and delete files, all or nothing. Paths are relative to the artifact's directory. Use it to write a page in full; for a small change to a file, artifact_patch sends less.",
      input: writeInput,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
      async run(args, { options }) {
        const dir = options.workspace.resolveDir(args.dir);
        const write = args.files.map((file) => ({
          path: file.path,
          content:
            file.encoding === "base64"
              ? new Uint8Array(Buffer.from(file.content, "base64"))
              : new TextEncoder().encode(file.content),
        }));
        const warnings = await droppedIds(options, dir, write);
        const changed = await options.workspace.apply(dir, { write, delete: args.deletes ?? [] });
        return jsonResult({ dir, ...changed, ...(warnings.length > 0 ? { warnings } : {}) });
      },
    }),
    defineTool({
      name: "artifact_patch",
      title: "Patch an artifact file",
      description:
        "Change files of an artifact with exact replacements in one file (each old text must appear exactly once), or with a unified diff of one or more files. All or nothing: when an edit or hunk doesn't apply, nothing is written and the result lists each one that didn't, and why.",
      input: patchInput,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
      async run(args, { options }) {
        const dir = options.workspace.resolveDir(args.dir);
        if ((args.edits === undefined) === (args.diff === undefined)) {
          throw usage("Give either edits (with path) or diff, not both.");
        }
        if (args.edits !== undefined && args.path === undefined) {
          throw usage("Edits need the path of the file they change.");
        }
        const request =
          args.edits !== undefined
            ? { path: args.path as string, edits: args.edits }
            : {
                ...(args.path !== undefined ? { path: args.path } : {}),
                diff: args.diff as string,
              };
        const plan = await planPatch(request, (path) => options.workspace.read(dir, path));
        if (!plan.ok) {
          return errorResult(
            createDiagnostic("MOSTRA_ARTIFACT_PATCH_REJECTED", {
              message: `${plan.rejected.length === 1 ? "One edit or hunk doesn't" : `${plan.rejected.length} edits or hunks don't`} apply; nothing was written.`,
            }),
            { rejected: plan.rejected },
          );
        }
        const write = plan.change.write.map((file) => ({
          path: file.path,
          content: new TextEncoder().encode(file.content),
        }));
        const warnings = await droppedIds(options, dir, write);
        const changed = await options.workspace.apply(dir, { write, delete: plan.change.delete });
        return jsonResult({
          dir,
          patched: changed.written,
          deleted: changed.deleted,
          ...(warnings.length > 0 ? { warnings } : {}),
        });
      },
    }),
    defineTool({
      name: "artifact_verify",
      title: "Verify an artifact",
      description:
        "Check an artifact before anyone sees it: type-check, build, render it headlessly, click through it, check accessibility and screenshot it at 1280×800 and 390×844. Returns the verdict (status pass or fail, with diagnostics that carry codes and hints) and the screenshots worth looking at. Fix every error and verify again until the status is pass, then look at the screenshots. Can take a few minutes.",
      input: verifyInput,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      async run(args, { options, progress }) {
        const progressToken = randomUUID();
        const stop = options.instance.onProgress(progressToken, (update) =>
          progress(`verify: ${update.stage}`),
        );
        try {
          const verdict = await options.instance.call(artifactVerifyMethod, {
            source: { path: options.workspace.resolveDir(args.dir) },
            progressToken,
            ...(args.screenshots !== undefined ? { screenshots: args.screenshots } : {}),
          });
          return {
            content: [
              { type: "text", text: JSON.stringify(verdict) },
              ...(await screenshotImages(verdict, readScreenshot)),
            ],
          };
        } finally {
          stop();
        }
      },
    }),
    defineTool({
      name: "artifact_publish",
      title: "Publish an artifact",
      description:
        "Publish an artifact as a new immutable version people can open. Publish verifies the source first (reusing a verdict for the same source) and refuses when verify reports errors. Returns the version and the artifact's link (url): a private link, so whoever holds it can use the page.",
      input: publishInput,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      async run(args, { options, progress }) {
        progress("publish: verifying and building");
        return jsonResult(
          await options.instance.call(artifactPublishMethod, {
            source: { path: options.workspace.resolveDir(args.dir) },
            ...(args.force === true ? { force: true } : {}),
          }),
        );
      },
    }),
    defineTool({
      name: "artifact_open",
      title: "Get an artifact's link",
      description:
        "Get a link to an artifact's page to hand to a person. Without options it is the artifact's default link. A link made without viewer is shared by everyone who holds it: they edit one draft and, under the once policy, have one submission between them. For several people, call once per person with viewer, so each gets their own. open: true also opens it in a browser on this computer.",
      input: openInput,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
      async run(args, { options }) {
        const artifact = artifactRef(args.artifact, options);
        const fresh =
          args.version !== undefined ||
          args.viewer !== undefined ||
          args.scopes !== undefined ||
          args.ttl !== undefined;
        const link = fresh
          ? await options.instance.call(viewUrlMethod, {
              artifact,
              ...(args.version !== undefined ? { version: args.version } : {}),
              ...(args.viewer !== undefined
                ? {
                    viewer: {
                      ref: args.viewer.ref,
                      ...(args.viewer.name !== undefined ? { name: args.viewer.name } : {}),
                    },
                  }
                : {}),
              ...(args.scopes !== undefined ? { scopes: args.scopes } : {}),
              ...(args.ttl !== undefined ? { ttl: args.ttl } : {}),
            })
          : await options.instance.call(viewDefaultMethod, { artifact });
        if (args.open !== true) return jsonResult(link);
        if (options.browser === undefined) return jsonResult({ ...link, opened: false });
        const launch = await options.instance.call(viewLaunchMethod, { tokenId: link.tokenId });
        return jsonResult({ ...link, opened: await options.browser.open(launch.url) });
      },
    }),
    defineTool({
      name: "artifact_wait",
      title: "Wait for an answer",
      description: `Wait until a person submits (until: submitted), raises a signal (signal:<name>), changes shared state (state:<fieldId>) or an event happens (event:<type>). Waits at most timeoutSeconds (${WAIT_MAX_SECONDS} at most). Returns satisfied with the event once it happens, or still_waiting with a cursor: nothing is lost, so call again with after set to that cursor, or do other work and check later.`,
      input: waitInput,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      async run(args, { options }) {
        return jsonResult(
          await options.instance.call(waitMethod, {
            artifact: artifactRef(args.artifact, options),
            until: args.until,
            ...(args.after !== undefined ? { after: args.after } : {}),
            timeoutMs: (args.timeoutSeconds ?? WAIT_MAX_SECONDS) * 1000,
          }),
        );
      },
    }),
    defineTool({
      name: "artifact_results",
      title: "Read the results",
      description:
        "Read a submission: the person's answers by label, their choices, comments, actions and signals. Markdown by default; format json gives the full structure. The latest submission unless submission names one.",
      input: resultsInput,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      async run(args, { options }) {
        const format = args.format ?? "md";
        const results = await options.instance.call(resultsGetMethod, {
          artifact: artifactRef(args.artifact, options),
          ...(args.submission !== undefined ? { submission: args.submission } : {}),
          format,
        });
        return format === "md" && "markdown" in results
          ? textResult(results.markdown)
          : jsonResult(results);
      },
    }),
    defineTool({
      name: "artifact_list",
      title: "List artifacts",
      description:
        "List the artifacts published in this Mostra home, with their IDs, titles, source directories and latest versions.",
      input: listInput,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      async run(args, { options }) {
        return jsonResult(
          await options.instance.call(artifactListMethod, {
            ...(args.filter?.family !== undefined
              ? { filter: { family: args.filter.family } }
              : {}),
          }),
        );
      },
    }),
    defineTool({
      name: "live_push",
      title: "Push a live value",
      description:
        "Push a value to an artifact's live source (a key its live.ts defines, or a new one); open pages show it at once. mode append also keeps it in the source's ring, for charts of recent values.",
      input: livePushInput,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
      async run(args, { options }) {
        return jsonResult(
          await options.instance.call(livePushMethod, {
            artifact: artifactRef(args.artifact, options),
            key: args.key,
            value: args.value,
            ...(args.mode !== undefined ? { mode: args.mode } : {}),
          }),
        );
      },
    }),
    defineTool({
      name: "state_get",
      title: "Read shared state",
      description:
        "Read an artifact's shared state (the fields with scope artifact that every viewer sees), with its revision.",
      input: stateGetInput,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      async run(args, { options }) {
        return jsonResult(
          await options.instance.call(stateGetMethod, {
            artifact: artifactRef(args.artifact, options),
            ...(args.ids !== undefined ? { ids: args.ids } : {}),
          }),
        );
      },
    }),
    defineTool({
      name: "state_patch",
      title: "Change shared state",
      description:
        "Change an artifact's shared state as a viewer's edit would: set fields ({ id, value }) or delete them ({ id, delete: true }), together. With baseRevision, a field someone changed after it isn't overwritten and comes back in conflicts. Open pages update at once.",
      input: statePatchInput,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
      async run(args, { options }) {
        return jsonResult(
          await options.instance.call(statePatchMethod, {
            artifact: artifactRef(args.artifact, options),
            ops: args.ops.map((op) => {
              if (op.delete === true) return { id: op.id, delete: true as const };
              if (!("value" in op))
                throw usage(`The op for ${op.id} needs a value, or delete: true.`);
              return { id: op.id, value: op.value };
            }),
            ...(args.baseRevision !== undefined ? { baseRevision: args.baseRevision } : {}),
            mutationId: args.mutationId ?? MutationId.create(),
            as: "agent",
          }),
        );
      },
    }),
    defineTool({
      name: "docs_search",
      title: "Search Mostra's reference",
      description:
        "Search Mostra's reference: the guide to writing pages (fields, submission, design, server actions, live data, sharing), the CLI and every diagnostic code. Returns the best passages and each topic's URI; give topic instead of query to read one topic whole (start with topic guide).",
      input: docsInput,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      async run(args, { options }) {
        if ((args.query === undefined) === (args.topic === undefined)) {
          throw usage("Give either query or topic.");
        }
        if (args.topic !== undefined) {
          const markdown = options.docs.read(args.topic);
          if (markdown !== undefined) return textResult(markdown);
          return errorResult(
            createDiagnostic("MOSTRA_CLI_USAGE", {
              message: `No topic "${args.topic}" in the reference.`,
            }),
            { nearest: searchDocs(options.docs, args.topic, 3).map((hit) => hit.topic) },
          );
        }
        return jsonResult({ hits: searchDocs(options.docs, args.query as string) });
      },
    }),
  ];
}

const ENTRIES = new Set(["index.tsx", "index.jsx", "index.mdx"]);
const MANIFEST_ID = /\bid\s*:\s*["'`]?(art_[0-9A-HJKMNP-TV-Z]{26})\b/;

/**
 * A warning for each entry a write replaces with text that no longer names the artifact ID its
 * manifest held: the write goes ahead (the agent's choice), but the next publish would bind the
 * artifact by its path under a new ID, which the agent can't see from here (D51, D164).
 */
async function droppedIds(
  options: McpServerOptions,
  dir: string,
  write: readonly { readonly path: string; readonly content: Uint8Array }[],
): Promise<Diagnostic[]> {
  const warnings: Diagnostic[] = [];
  const decoder = new TextDecoder();
  for (const file of write) {
    if (!ENTRIES.has(file.path)) continue;
    const before = await options.workspace.read(dir, file.path);
    const id = before === undefined ? undefined : MANIFEST_ID.exec(decoder.decode(before))?.[1];
    if (id === undefined || decoder.decode(file.content).includes(id)) continue;
    warnings.push(
      createDiagnostic("MOSTRA_ARTIFACT_ID_DROPPED", {
        message: `${file.path} no longer names the artifact's id, ${id}; it was written as given.`,
      }),
    );
  }
  return warnings;
}

/** A usage error the model can correct: the arguments don't fit together. */
function usage(message: string): RpcError {
  return new RpcError(createDiagnostic("MOSTRA_HOST_INVALID_PARAMS", { message }));
}
