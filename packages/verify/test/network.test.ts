/**
 * Which failed requests are the artifact's (D138 item 3, D157 item 1): those of the frame the page
 * ends in. The shell loads a frame again when its load failed and it never greeted, and what the
 * frame it replaced failed to load (Chromium's `ERR_NO_BUFFER_SPACE` on Windows, #66) isn't the
 * artifact's failure.
 */
import { EventEmitter } from "node:events";
import type { Frame, Page, Request } from "playwright-core";
import { describe, expect, it } from "vitest";
import { watchNetwork } from "../src/network.ts";

/** A frame at `url`: only what the watch reads of one. */
const fakeFrame = (url: string): Frame => ({ url: () => url }) as unknown as Frame;

/** A request of `frame` for `url`, failed with `errorText`. */
const failedRequest = (frame: Frame, url: string, errorText: string): Request =>
  ({
    url: () => url,
    method: () => "GET",
    resourceType: () => "document",
    frame: () => frame,
    failure: () => ({ errorText }),
  }) as unknown as Request;

describe("verify's failed requests (D157 item 1)", () => {
  it("counts those of the frame the page ends in, never of a frame the shell replaced", () => {
    const page = new EventEmitter();
    const first = fakeFrame("chrome-error://chromewebdata/");
    const second = fakeFrame("http://127.0.0.1:23456/");
    let current = first;
    const network = watchNetwork(page as unknown as Page, () => current, "1280x800");

    page.emit(
      "requestfailed",
      failedRequest(first, "http://127.0.0.1:23456/", "net::ERR_NO_BUFFER_SPACE"),
    );
    expect(network.findings()).toHaveLength(1);
    // The shell loads the frame again: the failure above was the replaced frame's.
    current = second;
    expect(network.findings()).toEqual([]);

    page.emit(
      "requestfailed",
      failedRequest(second, "http://127.0.0.1:23456/missing.png", "net::ERR_CONNECTION_RESET"),
    );
    const findings = network.findings();
    expect(findings).toHaveLength(1);
    expect(findings[0]?.code).toBe("MOSTRA_NETWORK_REQUEST_FAILED");
    expect(findings[0]?.message).toContain("/missing.png");
  });
});
