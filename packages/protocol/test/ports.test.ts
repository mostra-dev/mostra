import {
  ArtifactId,
  hostMethods,
  hostNotifications,
  portIdentityResolveMethod,
} from "@mostra/protocol";
import { describe, expect, it } from "vitest";

describe("the identity port (D143 item 2)", () => {
  const artifactId = ArtifactId.create();

  it("takes the artifact, how the request arrived and its headers", () => {
    const params = { artifactId, via: "local", headers: { "x-forwarded-user": "ada" } };
    expect(portIdentityResolveMethod.params.parse(params)).toEqual(params);
    // A newer `via` (WP-13 adds two) reaches an older host as a string, never a refusal.
    expect(portIdentityResolveMethod.params.safeParse({ ...params, via: "tailnet" }).success).toBe(
      true,
    );
    expect(portIdentityResolveMethod.params.safeParse({ ...params, via: "" }).success).toBe(false);
    expect(
      portIdentityResolveMethod.params.safeParse({ ...params, headers: { cookie: 1 } }).success,
    ).toBe(false);
  });

  it("answers a person by the host's key, or null", () => {
    expect(portIdentityResolveMethod.result.parse({ ref: "ada@example.com", name: "Ada" })).toEqual(
      { ref: "ada@example.com", name: "Ada" },
    );
    expect(portIdentityResolveMethod.result.parse(null)).toBeNull();
    expect(portIdentityResolveMethod.result.safeParse({ ref: "" }).success).toBe(false);
    expect(portIdentityResolveMethod.result.safeParse({ name: "Ada" }).success).toBe(false);
  });

  it("is a port method the instance sends to the host", () => {
    expect(portIdentityResolveMethod.direction).toBe("instance-to-host");
    expect(hostMethods).toContain(portIdentityResolveMethod);
  });
});

describe("the notification list", () => {
  it("names every notification once", () => {
    const names = hostNotifications.map((notification) => notification.method);
    expect(names.sort()).toEqual(["artifact/progress", "dev/notify", "events/notify"]);
  });
});
