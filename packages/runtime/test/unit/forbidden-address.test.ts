/**
 * Which addresses a Client ID Metadata Document is never fetched from (D165, D167 item 10): every
 * private, loopback, link-local and metadata address, in every way IPv4 and IPv6 write it.
 */
import { describe, expect, it } from "vitest";
import { forbiddenAddress } from "../../src/server/oauth-clients.ts";

describe("addresses no metadata document comes from", () => {
  it("refuses loopback, private, link-local and metadata addresses in every form", () => {
    for (const address of [
      "127.0.0.1",
      "10.1.2.3",
      "172.16.0.1",
      "192.168.1.1",
      "169.254.169.254",
      "100.64.0.1",
      "0.0.0.0",
      "224.0.0.1",
      "::",
      "::1",
      "0:0:0:0:0:0:0:1",
      "::ffff:127.0.0.1",
      "::ffff:7f00:1",
      "0:0:0:0:0:ffff:7f00:1",
      "::ffff:a9fe:a9fe",
      "::127.0.0.1",
      "::7f00:1",
      "fe80::1",
      "fe80::1%en0",
      "fd12:3456::1",
      "ff02::1",
      "64:ff9b::7f00:1",
      "2002:7f00:1::1",
      "2001::1",
      "2001:db8::1",
      "not an address",
      "1:2:3:4:5:6:7:8:9",
    ]) {
      expect(forbiddenAddress(address), address).toBe(true);
    }
  });

  it("lets public addresses through", () => {
    for (const address of ["8.8.8.8", "160.79.104.10", "2606:4700::1111", "::ffff:8.8.8.8"]) {
      expect(forbiddenAddress(address), address).toBe(false);
    }
  });
});
