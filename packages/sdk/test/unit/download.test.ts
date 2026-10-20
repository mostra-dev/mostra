/**
 * Downloads (RT-01): credentials in a mirror's URL reach the mirror and never a message, and the
 * proxy comes from the environment the caller supplies (GPT review findings 2 and 6).
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { RpcError } from "@mostra/protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { download, scrubUrls } from "../../src/bundle/download.ts";
import { fileServer, tempDir } from "../support.ts";

const BODY = Buffer.from("the archive's bytes");
const expected = { sha256: createHash("sha256").update(BODY).digest("hex"), size: BODY.length };

let dir: ReturnType<typeof tempDir>;
beforeEach(() => {
  dir = tempDir("mdl");
});
afterEach(() => dir.cleanup());

describe("downloads (RT-01)", () => {
  it("sends a mirror URL's credentials as Basic authorization, and never prints them", async () => {
    const seen: (string | undefined)[] = [];
    const server = await fileServer((req, res) => {
      seen.push(req.headers.authorization);
      const good = `Basic ${Buffer.from("mirror-user:review-secret").toString("base64")}`;
      if (req.headers.authorization !== good) {
        res.writeHead(401).end();
        return;
      }
      res.writeHead(200, { "content-length": String(BODY.length) }).end(BODY);
    });
    try {
      const base = new URL(server.url);
      const withCredentials = `http://mirror-user:review-secret@${base.host}/archive.tar.gz`;
      const dest = join(dir.path, "archive.tar.gz");
      await download(withCredentials, dest, expected, { attempts: 1 });
      expect(readFileSync(dest)).toEqual(BODY);
      expect(seen).toEqual([
        `Basic ${Buffer.from("mirror-user:review-secret").toString("base64")}`,
      ]);

      // Wrong credentials: refused, and the diagnostic names the mirror without them.
      const wrong = `http://mirror-user:wrong-secret@${base.host}/archive.tar.gz?token=query-secret`;
      const error = await download(wrong, join(dir.path, "b"), expected, { attempts: 1 }).catch(
        (caught: unknown) => caught,
      );
      expect(error).toBeInstanceOf(RpcError);
      const message = (error as RpcError).diagnostic.message;
      expect(message).toContain("401");
      expect(message).not.toMatch(/secret/);
    } finally {
      await server.close();
    }
  });

  it("takes the proxy from the environment it is given, not the process's", async () => {
    // The supplied environment names a proxy (this server): the request goes there, absolute-form.
    const targets: (string | undefined)[] = [];
    const proxy = await fileServer((req, res) => {
      targets.push(req.url);
      res.writeHead(200, { "content-length": String(BODY.length) }).end(BODY);
    });
    try {
      const dest = join(dir.path, "via-proxy");
      await download("http://archive.mostra.invalid/a.tar.gz", dest, expected, {
        attempts: 1,
        env: { HTTP_PROXY: proxy.url },
      });
      expect(targets).toEqual(["http://archive.mostra.invalid/a.tar.gz"]);
      // Its NO_PROXY wins too: this host goes direct, and the proxy sees nothing more.
      const direct = await fileServer((_req, res) => {
        res.writeHead(200, { "content-length": String(BODY.length) }).end(BODY);
      });
      try {
        await download(`${direct.url}/a.tar.gz`, join(dir.path, "direct"), expected, {
          attempts: 1,
          env: { HTTP_PROXY: proxy.url, NO_PROXY: "127.0.0.1" },
        });
        expect(direct.requests()).toBe(1);
        expect(targets).toHaveLength(1);
      } finally {
        await direct.close();
      }
    } finally {
      await proxy.close();
    }
  });

  it("reduces every URL in a message to its printable form", () => {
    expect(
      scrubUrls(
        "fetch failed for https://u:p@mirror.example/a?sig=1 via http://proxy-user:proxy-pass@proxy:3128",
      ),
    ).toBe("fetch failed for https://mirror.example/a via http://proxy:3128/");
  });
});
