import * as z from "zod";
import { ArtifactId } from "../../ids.ts";
import { defineMethod, type MethodDefinition } from "../../method.ts";
import { wireRegistry } from "../../wire-registry.ts";

/** One built file of a version: `[path, executable, sha256, size]` (DATA_MODEL §2). */
export type ListingEntry = readonly [
  path: string,
  executable: boolean,
  sha256: string,
  size: number,
];

/**
 * A version as an owner instance pushes it to its hosted home (INTERFACES §18.2, D165 item 3): its
 * identity, its manifest, registry and lockfile, and the listing of every built file, server files
 * included, whose digest is `outputDigest`. Never sources, never server code.
 */
export interface VersionPush {
  /** The version ID (D89): the hosted home checks it against the artifact ID and both digests. */
  readonly versionId: string;
  /** Its number in the owner's home, kept in the hosted one. */
  readonly number: number;
  /** The source tree's digest (DATA_MODEL §2). */
  readonly sourceDigest: string;
  /** The environment's digest. */
  readonly envDigest: string;
  /** The output listing's digest: `listing` must hash to it. */
  readonly outputDigest: string;
  /** The version's `manifest.json`, as text. */
  readonly manifest: string;
  /** Its `registry.json`, as text. */
  readonly registry: string;
  /** Its `lock.yaml`, as text. */
  readonly lock: string;
  /** Every built file, server files included, as `[path, executable, sha256, size]`. */
  readonly listing: readonly ListingEntry[];
}

/** The params of `hosted/push`. */
export interface HostedPushParams {
  /** The artifact, by its own ID (its manifest's). */
  readonly artifactId: string;
  /** The version to host. */
  readonly version: VersionPush;
  /** Makes a retry idempotent; the push is idempotent by version ID anyway. */
  readonly requestId?: string;
}

/** An artifact's hosted route: its `rte_` ID and random label (INTERFACES §18.4). */
export interface HostedRoute {
  /** The route's `rte_` ID, in the hosted shell's paths (`/a/<routeId>`). */
  readonly routeId: string;
  /** The route's DNS label on the user-content domain, never issued twice. */
  readonly label: string;
}

/** The result of `hosted/push`: the files the server still lacks, or the hosted version. */
export type HostedPushResult =
  | {
      readonly status: "complete";
      readonly versionId: string;
      readonly number: number;
      readonly route: HostedRoute;
    }
  | { readonly status: "missing"; readonly files: readonly string[]; readonly route: HostedRoute };

const Sha256 = z.string().regex(/^[0-9a-f]{64}$/);

/** The Zod schema of the `VersionPush` type. */
export const VersionPush: z.ZodType<VersionPush> = z
  .object({
    versionId: z.string().min(1),
    number: z.int().min(1),
    sourceDigest: Sha256,
    envDigest: Sha256,
    outputDigest: Sha256,
    manifest: z.string().max(4 * 1024 * 1024),
    registry: z.string().max(16 * 1024 * 1024),
    lock: z.string().max(16 * 1024 * 1024),
    listing: z
      .array(z.tuple([z.string().min(1), z.boolean(), Sha256, z.int().min(0)]).readonly())
      .max(100_000)
      .readonly(),
  })
  .register(wireRegistry, {
    id: "VersionPush",
    description:
      "A version an owner pushes to its hosted home: its identity, manifest, registry, lockfile and output listing.",
  });

/** The Zod schema of the `HostedRoute` type. */
export const HostedRoute: z.ZodType<HostedRoute> = z
  .object({ routeId: z.string(), label: z.string() })
  .register(wireRegistry, {
    id: "HostedRoute",
    description: "An artifact's hosted route: its rte_ ID and random label.",
  });

const params: z.ZodType<HostedPushParams> = z
  .object({
    artifactId: ArtifactId.schema,
    version: VersionPush,
    requestId: z.string().min(1).exactOptional(),
  })
  .register(wireRegistry, { id: "HostedPushParams" });

const result: z.ZodType<HostedPushResult> = z
  .discriminatedUnion("status", [
    z.object({
      status: z.literal("complete"),
      versionId: z.string(),
      number: z.int(),
      route: HostedRoute,
    }),
    z.object({
      status: z.literal("missing"),
      files: z.array(Sha256).readonly(),
      route: HostedRoute,
    }),
  ])
  .register(wireRegistry, {
    id: "HostedPushResult",
    description: "A push's state: the client files the server still lacks, or the hosted version.",
  });

/**
 * `hosted/push`: on a hosted home, makes a version of the owner's artifact hosted (D165 item 3).
 * The server stores the client files the listing names, never the server files, and answers the
 * SHA-256s it lacks until every client file was uploaded to `/files/<sha256>`. Idempotent by
 * `versionId`; it mints the artifact's hosted route on the first push.
 */
export const hostedPushMethod: MethodDefinition<HostedPushParams, HostedPushResult> = defineMethod({
  method: "hosted/push",
  direction: "client-to-instance",
  mutating: true,
  params,
  result,
});
