/**
 * A host's external bases through a real `mostra-runtime daemon` (HO-10, D158 item 6), at the
 * runtime's own level: what an unauthenticated visitor to a host's address can make the gateway
 * do, and how concurrent questions to the host's `addressing` port settle. The conformance kit's
 * `ports.addressing` proves the port's behaviour through each reference host.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Browser, parseLink } from "../browser-client.ts";
import { GatewayHome, ok, type Receipt } from "../gateway-home.ts";
import { connectTo, initializeParams, type LineClient, type Message } from "../support.ts";

interface Base {
  readonly artifactId: string;
  readonly listener: "shell" | "artifact";
  readonly local: string;
}

/** A host that registers `addressing` and answers each question with `answer`. */
async function addressingHost(
  gateway: GatewayHome,
  answer: (base: Base, nth: number) => Promise<unknown | Error>,
): Promise<{ readonly asked: Base[]; close(): void }> {
  const client: LineClient = await connectTo(gateway.daemon.status.socket as string);
  ok(
    await client.call(
      "mostra/initialize",
      initializeParams({
        client: { name: "addressing-host", version: "1" },
        ports: ["addressing"],
      }),
    ),
  );
  const asked: Base[] = [];
  let open = true;
  void (async () => {
    while (open) {
      let message: Message;
      try {
        message = await client.next((m) => m.method === "port/addressing.externalBase", 600_000);
      } catch {
        return;
      }
      const base = (message as unknown as { params: Base }).params;
      asked.push(base);
      void answer(base, asked.length).then((result) => {
        if (!open) return;
        client.sendRaw(
          JSON.stringify(
            result instanceof Error
              ? { jsonrpc: "2.0", id: message.id, error: { code: -32603, message: result.message } }
              : { jsonrpc: "2.0", id: message.id, result },
          ),
        );
      });
    }
  })();
  return {
    asked,
    close: () => {
      open = false;
      client.close();
    },
  };
}

/** The shell on `localhost`, the frame on `127.0.0.1`, at the ports Mostra opened. */
const crossSite = (base: Base): { origin: string } => ({
  origin: `http://${base.listener === "shell" ? "localhost" : "127.0.0.1"}:${new URL(base.local).port}`,
});

async function faces(gateway: GatewayHome): Promise<{ by: string; artifactId?: string }[]> {
  return (
    ok<{ gateway?: { faces?: { by: string; artifactId?: string }[] } }>(
      await gateway.client.call("instance/status", {}),
    ).gateway?.faces ?? []
  );
}

describe("a host's external bases (HO-10)", () => {
  const gateway = new GatewayHome();
  let receipt: Receipt;
  beforeAll(async () => {
    await gateway.start();
    receipt = await gateway.publish("single-tsx", "page.tsx");
  }, 120_000);
  afterAll(() => gateway.stop());

  it("serves only its own artifact at a host's shell address, and asks the host nothing for others", async () => {
    const host = await addressingHost(gateway, async (base) => crossSite(base));
    try {
      const link = ok<{ url: string }>(
        await gateway.client.call("view/url", { artifact: { artifactId: receipt.artifactId } }),
      );
      const shell = parseLink(link.url).shell;
      expect(new URL(shell).hostname).toBe("localhost");
      const before = await faces(gateway);
      const askedBefore = host.asked.length;
      // A visitor names artifacts that aren't this address's, without any token.
      const browser = new Browser();
      for (const id of ["art_01M62E0YJP63V3R0FXTAVNAJVZ", "art_01M62E0YJP63V3R0FXTAVNAJW0"]) {
        const page = await browser.ask({ method: "GET", url: `${shell}/a/${id}/` });
        expect(page.status).toBe(404);
        const exchange = await browser.ask({
          method: "POST",
          url: `${shell}/a/${id}/_mostra/session`,
          headers: { origin: shell, "content-type": "application/json" },
          body: JSON.stringify({ token: parseLink(link.url).secret }),
        });
        expect(exchange.status).toBe(404);
      }
      // Nothing was opened, leased or asked for them.
      expect(host.asked.slice(askedBefore).map((base) => base.artifactId)).not.toContain(
        "art_01M62E0YJP63V3R0FXTAVNAJVZ",
      );
      expect(await faces(gateway)).toEqual(before);
      // Its own artifact still opens there.
      expect(
        (await browser.ask({ method: "GET", url: `${shell}/a/${receipt.artifactId}/` })).status,
      ).toBe(200);
    } finally {
      host.close();
    }
  }, 120_000);

  it("keeps a base one question set up when another question at the same time fails", async () => {
    const fresh = await gateway.publish("directory");
    // The first question about the shell is answered with a base; the second, asked meanwhile,
    // fails a moment later.
    const host = await addressingHost(gateway, async (base, nth) => {
      if (base.listener !== "shell") return crossSite(base);
      if (nth === 1) return crossSite(base);
      await new Promise((resolve) => setTimeout(resolve, 600));
      return new Error("the host's tunnel is restarting");
    });
    try {
      const [one, two] = await Promise.all([
        gateway.client.call("view/url", { artifact: { artifactId: fresh.artifactId } }),
        gateway.client.call("view/url", { artifact: { artifactId: fresh.artifactId } }),
      ]);
      const links = [ok<{ url: string }>(one).url, ok<{ url: string }>(two).url];
      // Every link at the host's address opens: the face the good answer set up stayed.
      const browser = new Browser();
      for (const url of links.filter(
        (url) => new URL(parseLink(url).shell).hostname === "localhost",
      )) {
        const page = await browser.ask({
          method: "GET",
          url: `${parseLink(url).shell}/a/${fresh.artifactId}/`,
        });
        expect(page.status).toBe(200);
      }
      expect(
        (await faces(gateway)).some(
          (face) => face.by === "host" && face.artifactId === fresh.artifactId,
        ),
      ).toBe(true);
    } finally {
      host.close();
    }
  }, 120_000);
});
