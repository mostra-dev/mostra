/**
 * Reading source pack items (D30, EX-03): shadcn registry items, by any of shadcn's address forms,
 * with their registry dependencies, read before anything is written. Every remote read is bounded
 * (30 s, 8 MiB), `https:` (or `http:` to this machine), and offline fails at once.
 *
 * - a URL: the item's JSON;
 * - a file: a local item, its files' `path`s read beside it when they carry no `content`;
 * - GitHub (`owner/repo/item[#ref]`): the ref resolved to a commit, the repository's root
 *   `registry.json` (and its `include`s) at that commit, the item found by name, each file read
 *   at that commit; anonymously, or with `GH_TOKEN` or `GITHUB_TOKEN` for a repository that isn't
 *   public, sent only to GitHub's API;
 * - `@namespace/item`: through the artifact's `components.json` `registries`, a URL template
 *   (`{name}`, `{style}`) or `{ url, params, headers }` with `${VAR}` read from the environment;
 * - a bare name (in `registryDependencies`): shadcn's own registry (`REGISTRY_URL`, as shadcn
 *   reads it, else `https://ui.shadcn.com/r`), at the style `components.json` names
 *   (`new-york-v4` when it names none);
 * - `plugin:<package>/<item>`: a pack an installed plugin carries (`contributes.packs`).
 */
import { realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, join, posix, relative, resolve, sep } from "node:path";
import { createDiagnostic, RpcError } from "@mostra/protocol";
import {
  type PackAddress,
  parsePackAddress,
  type Registry,
  type RegistryItem,
  RegistryItemSchema,
  RegistrySchema,
} from "@mostra/protocol/plugin";
import { EnvHttpProxyAgent, fetch as undiciFetch } from "undici";
import type { Environment } from "../log.ts";

/** How long one read may take. */
export const FETCH_TIMEOUT_MS: number = 30_000;

/** The most one read may return. */
export const FETCH_LIMIT_BYTES: number = 8 * 1024 * 1024;

/** The most items one `mostra add` may install, its registry dependencies included. */
const ITEM_LIMIT = 200;

/** An item as it was read, with where it came from and how its files' contents are read. */
export interface ReadItem {
  readonly item: RegistryItem;
  /** The address it was asked for by. */
  readonly address: string;
  /** Where it was read: a URL, or a file. */
  readonly source: string;
  /** The item whose `registryDependencies` named it. */
  readonly requiredBy?: string;
  /** Each file's content, in the item's order. */
  readonly contents: readonly string[];
}

/** What reading needs of the artifact and the instance. */
export interface ReadContext {
  /** The artifact's `components.json`, when it has one. */
  readonly components?: ComponentsJson;
  readonly env: Environment;
  readonly offline: boolean;
  /** An installed plugin's pack item file, for `plugin:` addresses. */
  readonly pluginItem: (pkg: string, item: string) => Promise<string | undefined>;
  /** Where GitHub's API and raw files are (tests point them at a local fake). */
  readonly github?: { readonly api: string; readonly raw: string };
}

/** The parts of a `components.json` Mostra reads. */
export interface ComponentsJson {
  readonly style?: string;
  readonly tailwind?: { readonly css?: string };
  readonly aliases?: Readonly<Record<string, string>>;
  readonly registries?: Readonly<
    Record<
      string,
      | string
      | {
          readonly url: string;
          readonly params?: Readonly<Record<string, string>>;
          readonly headers?: Readonly<Record<string, string>>;
        }
    >
  >;
}

/** An address as reading follows it: a pack address, or a GitHub item's relative dependency. */
type Address =
  | PackAddress
  | {
      readonly kind: "repo-file";
      readonly owner: string;
      readonly repo: string;
      readonly sha: string;
      readonly path: string;
    };

/** Where an item was read, for its relative dependencies. */
interface From {
  /** A local item's directory. */
  readonly base?: string;
  /** A GitHub item's repository and commit, and the directory of its registry entry. */
  readonly github?: { readonly owner: string; readonly repo: string; readonly sha: string };
  readonly githubBase?: string;
  /** A URL item's URL. */
  readonly url?: string;
}

/** `inner` is `outer` or inside it (both real paths), by whole segments. */
function isInside(outer: string, inner: string): boolean {
  const from = relative(outer, inner);
  return from === "" || (from !== ".." && !from.startsWith(`..${sep}`) && !isAbsolute(from));
}

const SHADCN_REGISTRY = "https://ui.shadcn.com/r";
const DEFAULT_STYLE = "new-york-v4";

const fail = (code: Parameters<typeof createDiagnostic>[0], message: string): RpcError =>
  new RpcError(createDiagnostic(code, { message }));

/** Whether a URL names this machine. */
function isLoopback(url: URL): boolean {
  return (
    url.hostname === "localhost" ||
    url.hostname === "[::1]" ||
    /^127(?:\.\d{1,3}){3}$/.test(url.hostname)
  );
}

/** Whether a URL may be read: `https:`, or `http:` to this machine. */
function readable(url: URL): boolean {
  if (url.protocol === "https:") return true;
  return url.protocol === "http:" && isLoopback(url);
}

/**
 * Whether a read of `first` may follow a redirect to `next`: `next` is readable, and a registry
 * elsewhere never sends a read to this machine (WP-16 review, R01's addendum): only an address
 * the caller named on this machine leads to another one here.
 */
export function mayFollow(first: URL, next: URL): boolean {
  return readable(next) && (!isLoopback(next) || isLoopback(first));
}

const agents = new Map<string, EnvHttpProxyAgent>();

/** The proxy agent for the environment's `HTTPS_PROXY`, `HTTP_PROXY` and `NO_PROXY`. */
function agentFor(env: Environment): EnvHttpProxyAgent {
  const pick = (name: string): string | undefined => env[name.toLowerCase()] ?? env[name];
  const httpsProxy = pick("HTTPS_PROXY");
  const httpProxy = pick("HTTP_PROXY");
  const noProxy = pick("NO_PROXY");
  const key = JSON.stringify([httpsProxy, httpProxy, noProxy]);
  let agent = agents.get(key);
  if (agent === undefined) {
    agent = new EnvHttpProxyAgent({
      ...(httpsProxy !== undefined ? { httpsProxy } : {}),
      ...(httpProxy !== undefined ? { httpProxy } : {}),
      ...(noProxy !== undefined ? { noProxy } : {}),
    });
    agents.set(key, agent);
  }
  return agent;
}

/** Reads a URL's text, bounded; 404 is `undefined`, anything else that fails throws. */
export async function readUrl(
  text: string,
  context: ReadContext,
  headers: Readonly<Record<string, string>> = {},
): Promise<string | undefined> {
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw fail("MOSTRA_PACK_ADDRESS_INVALID", `"${text}" isn't a URL.`);
  }
  if (!readable(url)) {
    throw fail(
      "MOSTRA_PACK_ADDRESS_INVALID",
      `${url.origin} isn't https: Mostra reads registry items over https, or http from this machine.`,
    );
  }
  if (context.offline) {
    throw fail("MOSTRA_PACK_OFFLINE", `Mostra is offline, so it can't read ${redactUrl(url)}.`);
  }
  // Redirects are followed here, at most five, each target checked before it is asked, and the
  // caller's headers (a registry's token, GitHub's) kept only while the origin stays the same:
  // a registry that redirects elsewhere never hands its credentials on.
  const deadline = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  let response: Awaited<ReturnType<typeof undiciFetch>>;
  let current = url;
  for (let hop = 0; ; hop += 1) {
    try {
      response = await undiciFetch(current, {
        headers: {
          accept: "application/json, text/plain;q=0.9, */*;q=0.1",
          ...(current.origin === url.origin ? headers : {}),
        },
        signal: deadline,
        redirect: "manual",
        dispatcher: agentFor(context.env),
      });
    } catch (error) {
      throw fail(
        "MOSTRA_PACK_FETCH_FAILED",
        `Reading ${redactUrl(current)} failed: ${reasonOf(error)}.`,
      );
    }
    const location = response.headers.get("location");
    if (response.status < 300 || response.status >= 400 || location === null) break;
    await response.body?.cancel();
    const next = new URL(location, current);
    if (!mayFollow(url, next)) {
      throw fail(
        "MOSTRA_PACK_FETCH_FAILED",
        `${redactUrl(url)} redirected to ${isLoopback(next) ? "this machine" : "an address that isn't https"}, which Mostra doesn't follow.`,
      );
    }
    if (hop >= 4) {
      throw fail("MOSTRA_PACK_FETCH_FAILED", `${redactUrl(url)} redirected more than five times.`);
    }
    current = next;
  }
  if (response.status === 404) {
    await response.body?.cancel();
    return undefined;
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw fail(
      "MOSTRA_PACK_FETCH_FAILED",
      `${redactUrl(url)} answered ${response.status} ${response.statusText}.`,
    );
  }
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (declared > FETCH_LIMIT_BYTES) {
    await response.body?.cancel();
    throw fail("MOSTRA_PACK_FETCH_FAILED", `${redactUrl(url)} is larger than 8 MiB.`);
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for await (const chunk of response.body ?? []) {
      size += chunk.byteLength;
      if (size > FETCH_LIMIT_BYTES) {
        throw fail("MOSTRA_PACK_FETCH_FAILED", `${redactUrl(url)} sent more than 8 MiB.`);
      }
      chunks.push(chunk);
    }
  } catch (error) {
    if (error instanceof RpcError) throw error;
    // The deadline, or the connection, ended the body part-way.
    throw fail("MOSTRA_PACK_FETCH_FAILED", `Reading ${redactUrl(url)} failed: ${reasonOf(error)}.`);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** Why a request failed, in words. */
function reasonOf(error: unknown): string {
  if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
    return `it didn't answer within ${FETCH_TIMEOUT_MS / 1000} s`;
  }
  if (error instanceof Error) {
    return error.cause instanceof Error ? error.cause.message : error.message;
  }
  return String(error);
}

/** A URL without its credentials or query, for messages. */
function redactUrl(url: URL): string {
  return `${url.origin}${url.pathname}`;
}

/** Parses an item's JSON, refusing anything shadcn's schema (and Mostra's block) refuses. */
export function parseItem(text: string, where: string): RegistryItem {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw fail("MOSTRA_PACK_ITEM_INVALID", `${where} isn't JSON.`);
  }
  const parsed = RegistryItemSchema.safeParse(data);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw fail(
      "MOSTRA_PACK_ITEM_INVALID",
      `${where} isn't a registry item: ${first ? `${first.path.join(".") || "(top)"}: ${first.message}` : "its shape is wrong"}.`,
    );
  }
  for (const [index, file] of (parsed.data.files ?? []).entries()) {
    if (
      (file.type === "registry:file" || file.type === "registry:page") &&
      file.target === undefined
    ) {
      throw fail(
        "MOSTRA_PACK_ITEM_INVALID",
        `${where}: files[${index}] is a ${file.type}, which needs a target.`,
      );
    }
  }
  return parsed.data;
}

/** `${VAR}` in `text`, from the environment (shadcn's registry headers and params). */
function expand(text: string, env: Environment): string {
  return text.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, name: string) => env[name] ?? "");
}

/**
 * Reads every item `specs` name, with their registry dependencies, depth first, each once (by
 * address), dependencies before the items that need them.
 */
export async function readItems(
  specs: readonly string[],
  context: ReadContext,
  cwd: string,
): Promise<ReadItem[]> {
  const done = new Map<string, ReadItem>();
  const order: ReadItem[] = [];
  const visiting = new Set<string>();
  const github = context.github ?? {
    api: "https://api.github.com",
    raw: "https://raw.githubusercontent.com",
  };
  const shas = new Map<string, string>();
  const registries = new Map<string, Promise<{ item: unknown; base: string }[]>>();

  const githubToken = (): string | undefined =>
    context.env["GH_TOKEN"] || context.env["GITHUB_TOKEN"] || undefined;

  /** A ref of a repository as its commit SHA (a full SHA as it is). */
  const commitOf = async (
    owner: string,
    repo: string,
    ref: string | undefined,
  ): Promise<string> => {
    if (ref !== undefined && /^[0-9a-f]{40}$/.test(ref)) return ref;
    const key = `${owner}/${repo}#${ref ?? ""}`;
    const known = shas.get(key);
    if (known !== undefined) return known;
    const token = githubToken();
    const answer = await readUrl(
      `${github.api}/repos/${owner}/${repo}/commits/${encodeURIComponent(ref ?? "HEAD")}`,
      context,
      {
        accept: "application/vnd.github.sha",
        ...(token !== undefined ? { authorization: `Bearer ${token}` } : {}),
      },
    ).catch((error: unknown) => {
      // GitHub answers 422 for a ref that names no commit.
      if (error instanceof RpcError && /answered 422/.test(error.diagnostic.message))
        return undefined;
      throw error;
    });
    const sha = answer?.trim();
    if (sha === undefined || !/^[0-9a-f]{40}$/.test(sha)) {
      throw fail(
        "MOSTRA_PACK_ITEM_NOT_FOUND",
        `GitHub has no ${ref === undefined ? "default branch" : `ref "${ref}"`} in ${owner}/${repo}${token === undefined ? " that it shows without a token (set GH_TOKEN for a repository that isn't public)" : ""}.`,
      );
    }
    shas.set(key, sha);
    return sha;
  };

  /** A file of a repository at a commit: raw anonymously, else the API with a token. */
  const repoFile = async (
    owner: string,
    repo: string,
    sha: string,
    path: string,
  ): Promise<string | undefined> => {
    const clean = posix.normalize(path).replace(/^\/+/, "");
    if (clean.startsWith("..")) {
      throw fail("MOSTRA_PACK_ITEM_INVALID", `${path} leaves ${owner}/${repo}.`);
    }
    const encoded = clean.split("/").map(encodeURIComponent).join("/");
    const anonymous = await readUrl(`${github.raw}/${owner}/${repo}/${sha}/${encoded}`, context);
    if (anonymous !== undefined) return anonymous;
    const token = githubToken();
    if (token === undefined) return undefined;
    return readUrl(`${github.api}/repos/${owner}/${repo}/contents/${encoded}?ref=${sha}`, context, {
      accept: "application/vnd.github.raw+json",
      authorization: `Bearer ${token}`,
    });
  };

  /**
   * A repository's registry, its `include`s read in, each item with the directory it came from;
   * read once per commit for every item of the call.
   */
  const registryOf = (
    owner: string,
    repo: string,
    sha: string,
  ): Promise<{ item: unknown; base: string }[]> => {
    const key = `${owner}/${repo}@${sha}`;
    let known = registries.get(key);
    if (known === undefined) {
      known = readRegistry(owner, repo, sha);
      registries.set(key, known);
    }
    return known;
  };
  const readRegistry = async (
    owner: string,
    repo: string,
    sha: string,
  ): Promise<{ item: unknown; base: string }[]> => {
    const found: { item: unknown; base: string }[] = [];
    const seen = new Set<string>();
    const visit = async (path: string): Promise<void> => {
      if (seen.has(path) || seen.size > 50) return;
      seen.add(path);
      const text = await repoFile(owner, repo, sha, path);
      if (text === undefined) {
        if (path === "registry.json") {
          throw fail(
            "MOSTRA_PACK_ITEM_NOT_FOUND",
            `${owner}/${repo} has no registry.json at its root (commit ${sha.slice(0, 12)}).`,
          );
        }
        throw fail("MOSTRA_PACK_ITEM_NOT_FOUND", `${owner}/${repo}'s ${path} isn't there.`);
      }
      let data: unknown;
      try {
        data = JSON.parse(text);
      } catch {
        throw fail("MOSTRA_PACK_ITEM_INVALID", `${owner}/${repo}'s ${path} isn't JSON.`);
      }
      const registry = RegistrySchema.safeParse(data);
      if (!registry.success) {
        throw fail("MOSTRA_PACK_ITEM_INVALID", `${owner}/${repo}'s ${path} isn't a registry.`);
      }
      const base = posix.dirname(path);
      for (const raw of (data as { items?: unknown[] }).items ?? [])
        found.push({ item: raw, base });
      for (const include of (registry.data as Registry).include ?? []) {
        await visit(posix.join(base, include));
      }
    };
    await visit("registry.json");
    return found;
  };

  /** Reads one address into an item and its files' contents. */
  const read = async (
    address: Address,
    text: string,
    from: From | undefined,
  ): Promise<{ item: RegistryItem; source: string; contents: string[]; context?: From }> => {
    if (address.kind === "file") {
      const path = isAbsolute(address.path)
        ? address.path
        : from?.base !== undefined
          ? resolve(from.base, address.path)
          : resolve(cwd, address.path);
      let body: string;
      try {
        body = await readFile(path, "utf8");
      } catch {
        throw fail("MOSTRA_PACK_ITEM_NOT_FOUND", `There's no item at ${path}.`);
      }
      const item = parseItem(body, path);
      const contents: string[] = [];
      // A local item's files are read from its own directory, never from elsewhere on the
      // machine (WP-16 review R03 finding 10): their content is copied into a published source.
      const dir = realpathSync(dirname(path));
      for (const file of item.files ?? []) {
        if (file.content !== undefined) contents.push(file.content);
        else {
          let real: string;
          try {
            real = realpathSync(resolve(dir, file.path));
          } catch {
            throw fail(
              "MOSTRA_PACK_ITEM_INVALID",
              `${path}'s file ${file.path} has no content and isn't beside the item.`,
            );
          }
          if (!isInside(dir, real)) {
            throw fail(
              "MOSTRA_PACK_ITEM_INVALID",
              `${path}'s file ${file.path} is outside the item's directory, which Mostra doesn't read from.`,
            );
          }
          contents.push(await readFile(real, "utf8"));
        }
      }
      return { item, source: path, contents, context: { base: dirname(path) } };
    }
    if (address.kind === "plugin") {
      const file = await context.pluginItem(address.package, address.item);
      if (file === undefined) {
        throw fail(
          "MOSTRA_PACK_ITEM_NOT_FOUND",
          `No installed plugin ${address.package} carries a pack "${address.item}".`,
        );
      }
      return read({ kind: "file", path: file }, file, undefined);
    }
    if (address.kind === "repo-file") {
      // A GitHub item's relative dependency: an item file of the same repository, at its commit.
      const body = await repoFile(address.owner, address.repo, address.sha, address.path);
      const where = `${address.owner}/${address.repo}/${address.path}@${address.sha.slice(0, 12)}`;
      if (body === undefined) {
        throw fail("MOSTRA_PACK_ITEM_NOT_FOUND", `There's no item ${where}.`);
      }
      const item = parseItem(body, where);
      const contents: string[] = [];
      for (const file of item.files ?? []) {
        if (file.content !== undefined) {
          contents.push(file.content);
          continue;
        }
        const fileBody = await repoFile(
          address.owner,
          address.repo,
          address.sha,
          posix.join(posix.dirname(address.path), file.path),
        );
        if (fileBody === undefined) {
          throw fail("MOSTRA_PACK_ITEM_INVALID", `${where}: ${file.path} isn't in the repository.`);
        }
        contents.push(fileBody);
      }
      return {
        item,
        source: `https://github.com/${address.owner}/${address.repo}/blob/${address.sha}/${address.path}`,
        contents,
        context: {
          github: { owner: address.owner, repo: address.repo, sha: address.sha },
          githubBase: posix.dirname(address.path),
        },
      };
    }
    if (address.kind === "github") {
      const sha = await commitOf(address.owner, address.repo, address.ref);
      const entries = await registryOf(address.owner, address.repo, sha);
      const entry = entries.find(
        (candidate) =>
          typeof candidate.item === "object" &&
          candidate.item !== null &&
          (candidate.item as { name?: unknown }).name === address.item,
      );
      if (entry === undefined) {
        throw fail(
          "MOSTRA_PACK_ITEM_NOT_FOUND",
          `${address.owner}/${address.repo}'s registry has no item "${address.item}" (commit ${sha.slice(0, 12)}).`,
        );
      }
      const where = `${address.owner}/${address.repo}/${address.item}@${sha.slice(0, 12)}`;
      const item = parseItem(JSON.stringify(entry.item), where);
      const contents: string[] = [];
      for (const file of item.files ?? []) {
        if (file.content !== undefined) {
          contents.push(file.content);
          continue;
        }
        const body = await repoFile(
          address.owner,
          address.repo,
          sha,
          posix.join(entry.base, file.path),
        );
        if (body === undefined) {
          throw fail("MOSTRA_PACK_ITEM_INVALID", `${where}: ${file.path} isn't in the repository.`);
        }
        contents.push(body);
      }
      return {
        item,
        source: `https://github.com/${address.owner}/${address.repo}/tree/${sha}`,
        contents,
        context: {
          github: { owner: address.owner, repo: address.repo, sha },
          githubBase: entry.base,
        },
      };
    }
    // url, namespace and name read one item's JSON from a URL.
    let url: string;
    let headers: Record<string, string> = {};
    if (address.kind === "url") url = address.url;
    else if (address.kind === "namespace") {
      const registry = context.components?.registries?.[address.namespace];
      if (registry === undefined) {
        throw fail(
          "MOSTRA_PACK_ADDRESS_INVALID",
          `The artifact's components.json registers no ${address.namespace} registry; add it to "registries" ("${address.namespace}": "https://…/{name}.json").`,
        );
      }
      const template = typeof registry === "string" ? registry : registry.url;
      // A variable names a credential or a parameter, never where the request goes: one in the
      // URL's scheme or host could send the others anywhere (WP-16 review, R01's addendum).
      const origin = /^[a-z][a-z0-9+.-]*:\/\/[^/?#]*/i.exec(template)?.[0] ?? template;
      if (origin.includes("${")) {
        throw fail(
          "MOSTRA_PACK_ADDRESS_INVALID",
          `The artifact's components.json names the ${address.namespace} registry's host through a variable (${origin}); write the host itself, and keep variables to its params and headers.`,
        );
      }
      const style = context.components?.style ?? DEFAULT_STYLE;
      const target = new URL(
        expand(template, context.env)
          .replaceAll("{name}", address.item)
          .replaceAll("{style}", style),
      );
      if (typeof registry !== "string") {
        for (const [name, value] of Object.entries(registry.params ?? {})) {
          target.searchParams.set(name, expand(value, context.env));
        }
        headers = Object.fromEntries(
          Object.entries(registry.headers ?? {}).map(([name, value]) => [
            name,
            expand(value, context.env),
          ]),
        );
      }
      url = target.href;
    } else {
      const style = context.components?.style ?? DEFAULT_STYLE;
      const base = (context.env["REGISTRY_URL"] || SHADCN_REGISTRY).replace(/\/+$/, "");
      url = `${base}/styles/${encodeURIComponent(style)}/${encodeURIComponent(address.name)}.json`;
    }
    const body = await readUrl(url, context, headers);
    if (body === undefined) {
      throw fail(
        "MOSTRA_PACK_ITEM_NOT_FOUND",
        `There's no item ${text} (${new URL(url).origin}${new URL(url).pathname} answered 404).`,
      );
    }
    const item = parseItem(body, text);
    const contents: string[] = [];
    for (const file of item.files ?? []) {
      if (file.content === undefined) {
        throw fail(
          "MOSTRA_PACK_ITEM_INVALID",
          `${text}: ${file.path} has no content; an item read from a URL carries its files' content.`,
        );
      }
      contents.push(file.content);
    }
    // Where it was read, without the query a registry's params (a token) may fill.
    return { item, source: redactUrl(new URL(url)), contents, context: { url } };
  };

  /**
   * A registry dependency's address, read as shadcn reads it. A relative item file is relative to
   * the item that names it: beside a local item, in a GitHub item's repository at its commit,
   * under a URL item's URL. A remote item never names a file on this machine.
   */
  const dependencyAddress = (text: string, from: From | undefined): Address => {
    const parsed = parsePackAddress(text);
    if (parsed !== undefined) {
      if (parsed.kind === "file" && (from?.github !== undefined || from?.url !== undefined)) {
        if (isAbsolute(parsed.path)) {
          throw fail(
            "MOSTRA_PACK_ADDRESS_INVALID",
            `A remote item names "${text}", a file on this machine, which Mostra doesn't read for it.`,
          );
        }
        if (from.github !== undefined) {
          const path = posix.normalize(posix.join(from.githubBase ?? ".", parsed.path));
          if (path.startsWith("..")) {
            throw fail("MOSTRA_PACK_ADDRESS_INVALID", `"${text}" leaves the item's repository.`);
          }
          return { kind: "repo-file", ...from.github, path };
        }
        return { kind: "url", url: new URL(parsed.path, from.url).href };
      }
      // A dependency of a local item names a sibling item file relative to it.
      if (parsed.kind === "file" && from?.base !== undefined && !isAbsolute(parsed.path)) {
        return { kind: "file", path: resolve(from.base, parsed.path) };
      }
      return parsed;
    }
    if (/^[a-z0-9][a-z0-9._-]*$/i.test(text)) return { kind: "name", name: text };
    throw fail("MOSTRA_PACK_ADDRESS_INVALID", `"${text}" isn't a registry item address.`);
  };

  const visit = async (
    text: string,
    address: Address,
    requiredBy: string | undefined,
    from: From | undefined,
  ): Promise<void> => {
    const key =
      address.kind === "file"
        ? `file:${address.path}`
        : address.kind === "repo-file"
          ? `repo-file:${address.owner}/${address.repo}@${address.sha}/${address.path}`
          : address.kind === "url"
            ? `url:${address.url}`
            : `${address.kind}:${text}`;
    if (done.has(key) || visiting.has(key)) return;
    if (done.size >= ITEM_LIMIT) {
      throw fail(
        "MOSTRA_PACK_ITEM_INVALID",
        `More than ${ITEM_LIMIT} items: their registry dependencies don't end.`,
      );
    }
    visiting.add(key);
    const read_ = await read(address, text, from);
    for (const dependency of read_.item.registryDependencies ?? []) {
      await visit(
        dependency,
        dependencyAddress(dependency, read_.context),
        read_.item.name,
        read_.context,
      );
    }
    visiting.delete(key);
    const entry: ReadItem = {
      item: read_.item,
      address: text,
      source: read_.source,
      ...(requiredBy !== undefined ? { requiredBy } : {}),
      contents: read_.contents,
    };
    done.set(key, entry);
    order.push(entry);
  };

  for (const spec of specs) {
    const address = parsePackAddress(spec);
    if (address === undefined) {
      throw fail("MOSTRA_PACK_ADDRESS_INVALID", `"${spec}" isn't a registry item address.`);
    }
    await visit(spec, address, undefined, undefined);
  }
  return order;
}

/** The artifact's `components.json`, when it has one Mostra can read. */
export async function readComponentsJson(root: string): Promise<ComponentsJson | undefined> {
  let text: string;
  try {
    text = await readFile(join(root, "components.json"), "utf8");
  } catch {
    return undefined;
  }
  try {
    const data = JSON.parse(text) as ComponentsJson;
    return typeof data === "object" && data !== null ? data : undefined;
  } catch {
    throw fail("MOSTRA_PACK_ITEM_INVALID", `${join(root, "components.json")} isn't JSON.`);
  }
}
