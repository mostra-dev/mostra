/**
 * The wire-schema bundle this package publishes (`schemas/`): every tool's input schema, read by
 * `mostra-tools schemas` (`pnpm --filter @mostra/mcp gen:schemas`, and the `api` job's
 * compatibility check). Clients and directories freeze a server's tool snapshot (D32), so a tool's
 * input changes only additively, which the check holds.
 */
import * as z from "zod";
import { toolRegistry } from "../src/tools.ts";

export const bundles = [
  {
    name: "mcp-tools",
    title: "Mostra's MCP tools: the input schema of each tool",
    revisions: {},
    definitions: (target: "draft-2020-12" | "draft-07", uri: (id: string) => string) =>
      z.toJSONSchema(toolRegistry, { target, io: "input", uri }).schemas as Record<
        string,
        Record<string, unknown>
      >,
  },
];
