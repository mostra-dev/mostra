/**
 * A fake instance for the MCP server's unit tests: answers host protocol methods from a table,
 * records every call, and sends `artifact/progress` to the listeners a verify registers.
 */

import type { McpDocs, McpInstance } from "@mostra/mcp";
import type { ArtifactProgressParams, MethodDefinition } from "@mostra/protocol";

export interface FakeInstance extends McpInstance {
  readonly calls: { method: string; params: unknown }[];
}

export function fakeInstance(
  answers: Record<
    string,
    (params: Record<string, unknown>, progress: (stage: string) => void) => unknown
  >,
): FakeInstance {
  const calls: { method: string; params: unknown }[] = [];
  const listeners = new Map<string, (progress: ArtifactProgressParams) => void>();
  return {
    calls,
    async call<P, R>(method: MethodDefinition<P, R>, params: P): Promise<R> {
      calls.push({ method: method.method, params });
      const answer = answers[method.method];
      if (answer === undefined) throw new Error(`unexpected ${method.method}`);
      const token = (params as { progressToken?: string }).progressToken;
      const progress = (stage: string): void => {
        if (token !== undefined) listeners.get(token)?.({ progressToken: token, stage });
      };
      return (await answer(params as Record<string, unknown>, progress)) as R;
    },
    onProgress(token, listener) {
      listeners.set(token, listener);
      return () => listeners.delete(token);
    },
  };
}

export const fakeDocs: McpDocs = {
  topics: () => [
    { topic: "guide", title: "Mostra", url: "https://docs/guide" },
    { topic: "guide/answers", title: "Answers", url: "https://docs/guide/answers" },
    {
      topic: "MOSTRA_FIELD_DUPLICATE_ID",
      title: "Duplicate field ID",
      url: "https://docs/errors/x",
    },
  ],
  read: (topic) =>
    ({
      guide: "# Mostra\n\nWrite a page.\n\nEvery answer is a field with a stable ID.",
      "guide/answers":
        "# Answers\n\nuseField saves an answer.\n\nuseSubmitControl names the Submit button.",
      MOSTRA_FIELD_DUPLICATE_ID: "# Duplicate field ID\n\nTwo fields share one ID.",
    })[topic],
};
