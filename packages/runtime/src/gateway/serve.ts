/**
 * Static files (RT-05, VR-03): the gateway serves a published version's client build and the
 * shell's built page straight from disk, with no process. A file is found only under its root,
 * through a path the hygiene checks already proved plain, and only when its real path stays inside
 * the root. Responses support `HEAD`, a single byte range (media seeking needs it) and conditional
 * requests.
 */
import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { extname, join, sep } from "node:path";
import { Readable } from "node:stream";
import { BASE_HEADERS } from "./http.ts";

const TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".bmp": "image/bmp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".wasm": "application/wasm",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".ogg": "audio/ogg",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".pdf": "application/pdf",
  ".zip": "application/zip",
  ".cast": "application/x-asciicast",
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
};

/** The `Content-Type` of a file, by extension. */
export function contentType(path: string): string {
  return TYPES[extname(path).toLowerCase()] ?? "application/octet-stream";
}

/** A file found under a root. */
export interface FoundFile {
  readonly path: string;
  readonly size: number;
  readonly mtimeMs: number;
}

/**
 * Finds the regular file `path` (a decoded, plain path starting with `/`) names under `root`, or
 * `undefined`. Its real path must stay under the root's real path, so a link can't lead out.
 */
export async function findFile(root: string, path: string): Promise<FoundFile | undefined> {
  if (path.includes("\0")) return undefined;
  try {
    const realRoot = await realpath(root);
    const real = await realpath(join(realRoot, path));
    if (real !== realRoot && !real.startsWith(`${realRoot}${sep}`)) return undefined;
    const info = await stat(real);
    return info.isFile() ? { path: real, size: info.size, mtimeMs: info.mtimeMs } : undefined;
  } catch {
    return undefined;
  }
}

/** Answers a request for a found file, with the given extra headers. */
export function fileResponse(
  file: FoundFile,
  request: Request,
  headers: Readonly<Record<string, string>>,
): Response {
  const etag = `W/"${file.size.toString(36)}-${Math.trunc(file.mtimeMs).toString(36)}"`;
  const base: Record<string, string> = {
    ...BASE_HEADERS,
    "content-type": contentType(file.path),
    "accept-ranges": "bytes",
    etag,
    ...headers,
  };
  if (request.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers: base });
  }
  const head = request.method === "HEAD";
  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get("range") ?? "");
  if (range && (range[1] !== "" || range[2] !== "")) {
    let start: number;
    let end: number;
    if (range[1] === "") {
      // A suffix range: the last N bytes.
      start = Math.max(0, file.size - Number(range[2]));
      end = file.size - 1;
    } else {
      start = Number(range[1]);
      end = range[2] === "" ? file.size - 1 : Math.min(Number(range[2]), file.size - 1);
    }
    if (start > end || start >= file.size) {
      return new Response(null, {
        status: 416,
        headers: { ...base, "content-range": `bytes */${file.size}` },
      });
    }
    const body = head
      ? null
      : (Readable.toWeb(createReadStream(file.path, { start, end })) as ReadableStream);
    return new Response(body, {
      status: 206,
      headers: {
        ...base,
        "content-range": `bytes ${start}-${end}/${file.size}`,
        "content-length": String(end - start + 1),
      },
    });
  }
  const body = head ? null : (Readable.toWeb(createReadStream(file.path)) as ReadableStream);
  return new Response(body, {
    status: 200,
    headers: { ...base, "content-length": String(file.size) },
  });
}
