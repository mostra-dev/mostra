/**
 * What the MCP server needs from whoever serves it (D164 item 1): three small ports, so the tools
 * never know the transport or where the instance runs. `mostra mcp` gives the home's daemon, the
 * local file system and the bundled reference; WP-30's remote server gives its own.
 */
import type { ArtifactProgressParams, MethodDefinition } from "@mostra/protocol";

/** The Mostra instance the tools act on, through the host protocol (INTERFACES §6). */
export interface McpInstance {
  /**
   * Calls a host protocol method. Rejects with an `RpcError` carrying the instance's diagnostic,
   * which the tool hands the model as its error.
   */
  call<P, R>(method: MethodDefinition<P, R>, params: P): Promise<R>;
  /**
   * Listens for `artifact/progress` with this `progressToken` (sent while `artifact/verify`
   * runs); returns the function that stops listening.
   */
  onProgress(
    progressToken: string,
    listener: (progress: ArtifactProgressParams) => void,
  ): () => void;
}

/** One file to write into an artifact's directory. */
export interface WorkspaceFile {
  /** The path relative to the artifact's directory, with `/` between folders. */
  readonly path: string;
  /** The file's bytes. */
  readonly content: Uint8Array;
}

/** Where artifacts' files live, and how they are read and written. */
export interface McpWorkspace {
  /** The directory relative `dir` arguments resolve in, and where a new artifact goes by default. */
  readonly root: string;
  /**
   * The absolute directory `dir` names: itself when absolute, else inside the workspace's root.
   * Throws `MOSTRA_ARTIFACT_PATH_INVALID` for a name it can't use.
   */
  resolveDir(dir: string): string;
  /** A new directory for an artifact titled `title`, inside the root, that doesn't exist yet. */
  allocateDir(title: string | undefined): Promise<string>;
  /** Reads a file of the artifact, or `undefined` when it doesn't exist. */
  read(dir: string, path: string): Promise<Uint8Array | undefined>;
  /**
   * Writes and deletes files of the artifact in `dir` (created when missing). Every path is
   * checked before anything is written; a path outside the directory, or through a link, throws
   * `MOSTRA_ARTIFACT_PATH_INVALID`. Each file is replaced whole (written aside, then renamed).
   */
  apply(
    dir: string,
    changes: { readonly write: readonly WorkspaceFile[]; readonly delete: readonly string[] },
  ): Promise<{ readonly written: string[]; readonly deleted: string[] }>;
}

/** One topic of Mostra's bundled reference (`mostra docs`, D140 item 17). */
export interface DocsTopicSummary {
  /** Its stable slug: `guide`, `guide/answers`, `cli`, a diagnostic code. */
  readonly topic: string;
  /** Its title, from the page's first heading. */
  readonly title: string;
  /** Where the docs site serves it. */
  readonly url: string;
}

/** The reference the docs tools and resources read. */
export interface McpDocs {
  /** Every topic, the pages first. */
  topics(): readonly DocsTopicSummary[];
  /** A topic's Markdown, or `undefined` for a topic that doesn't exist. */
  read(topic: string): string | undefined;
}

/** Opens a link in a browser on the person's computer, for a server that runs there. */
export interface McpBrowser {
  /**
   * Opens a one-time launch URL (`view/launch`), never a link's own secret, which a command line
   * would show every local user (D140 item 15); whether a browser started.
   */
  open(launchUrl: string): Promise<boolean>;
}

/** The MCP client a session serves, as its `clientInfo` names it. */
export interface McpClientInfo {
  /** The client's own name (`clientInfo.name`). */
  readonly name: string;
  /** Its version, when it gives one. */
  readonly version?: string;
}

/** Everything the server is built from. */
export interface McpServerOptions {
  /** The instance the tools act on. */
  readonly instance: McpInstance;
  /** Where artifacts' files are. */
  readonly workspace: McpWorkspace;
  /** The reference `docs_search` and the docs resources read. */
  readonly docs: McpDocs;
  /** Present when the server runs on the person's computer. */
  readonly browser?: McpBrowser;
  /**
   * Reads a screenshot a verdict names, to return it as an image. Default: this computer's file
   * system, where the instance that ran verify wrote it.
   */
  readonly readScreenshot?: (path: string) => Promise<Uint8Array>;
  /** The server's version, as `serverInfo` reports it (the release's). */
  readonly version: string;
  /**
   * Told the client a server instance serves (one per stdio connection, one per HTTP request) the
   * first time it calls a tool or reads a resource, for whoever counts sessions (the standalone
   * CLI's telemetry, D164 item 4, which counts each client once per process). Never throws into a
   * tool.
   */
  readonly onClient?: (client: McpClientInfo) => void;
}
