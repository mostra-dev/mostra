#!/usr/bin/env node
/**
 * The remote server's container image (ARCHITECTURE §15.11, D165 item 11): built from the release's
 * own Linux bundles, never from a second build of the source, so the image runs exactly the bytes
 * the release attests (D142).
 *
 *   node packages/bundle/scripts/image.ts --version <v> --bundles <dir>
 *     [--platforms linux/amd64,linux/arm64] [--repository <name>] [--latest] [--push | --load]
 *     [--metadata <file>]
 *
 * 1. checks each platform's archive in `--bundles` against its record (`mostra-<v>-<platform>.json`:
 *    size and SHA-256) and refuses anything that differs;
 * 2. lays out a build context with `container/Dockerfile` and only those archives;
 * 3. runs `docker buildx build` for the platforms, tagged `<repository>:<v>` (and `:latest`), and
 *    pushes it or loads it into the local engine.
 *
 * The repository is `--repository`, else `MOSTRA_IMAGE_REPOSITORY`, else
 * `ghcr.io/mostra-dev/mostra-server`: moving the image to another registry is a setting, never a
 * change to this script or the workflow (WP-30, D167).
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

/** Where the image goes unless told otherwise. */
export const DEFAULT_IMAGE_REPOSITORY = "ghcr.io/mostra-dev/mostra-server";

/** Docker's platform names, and the bundles' for each. */
const PLATFORMS: Readonly<Record<string, string>> = {
  "linux/amd64": "linux-x64",
  "linux/arm64": "linux-arm64",
};

const here = dirname(fileURLToPath(import.meta.url));

function fail(message: string): never {
  console.error(`image: ${message}`);
  process.exit(1);
}

async function sha256(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

const { values } = parseArgs({
  options: {
    version: { type: "string" },
    bundles: { type: "string" },
    platforms: { type: "string", default: "linux/amd64,linux/arm64" },
    repository: { type: "string" },
    latest: { type: "boolean", default: false },
    push: { type: "boolean", default: false },
    load: { type: "boolean", default: false },
    metadata: { type: "string" },
  },
});
const version = values.version ?? fail("--version is required.");
if (!/^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$/.test(version))
  fail(`--version ${version} isn't a version.`);
const bundles = resolve(values.bundles ?? fail("--bundles is required."));
if (values.push && values.load) fail("--push and --load can't be given together.");
const repository =
  values.repository ?? process.env["MOSTRA_IMAGE_REPOSITORY"] ?? DEFAULT_IMAGE_REPOSITORY;
if (!/^[a-z0-9.-]+(:[0-9]+)?(\/[a-z0-9._-]+)+$/.test(repository))
  fail(`${repository} isn't an image repository.`);
const platforms = values.platforms.split(",").map((one) => one.trim());
for (const platform of platforms)
  if (!PLATFORMS[platform]) fail(`no bundle is built for ${platform}.`);

const context = await mkdtemp(join(tmpdir(), "mostra-image-"));
try {
  await mkdir(join(context, "bundles"));
  for (const platform of platforms) {
    const name = `mostra-${version}-${PLATFORMS[platform]}`;
    const archive = join(bundles, `${name}.tar.gz`);
    const record = JSON.parse(await readFile(join(bundles, `${name}.json`), "utf8")) as {
      file: string;
      sha256: string;
      size: number;
    };
    const size = (await stat(archive)).size;
    const digest = await sha256(archive);
    if (record.file !== `${name}.tar.gz` || record.size !== size || record.sha256 !== digest) {
      fail(`${name}.tar.gz differs from its record (size ${size}, SHA-256 ${digest}).`);
    }
    await copyFile(archive, join(context, "bundles", `${name}.tar.gz`));
    console.error(`image: ${name}.tar.gz matches its record (SHA-256 ${digest})`);
  }
  await copyFile(join(here, "..", "container", "Dockerfile"), join(context, "Dockerfile"));
  const tags = [`${repository}:${version}`, ...(values.latest ? [`${repository}:latest`] : [])];
  const args = [
    "buildx",
    "build",
    "--platform",
    platforms.join(","),
    "--build-arg",
    `VERSION=${version}`,
    "--provenance=mode=max",
    "--sbom=true",
    ...tags.flatMap((tag) => ["--tag", tag]),
    ...(values.push ? ["--push"] : values.load ? ["--load"] : []),
    ...(values.metadata ? ["--metadata-file", resolve(values.metadata)] : []),
    context,
  ];
  console.error(`image: docker ${args.join(" ")}`);
  const built = spawnSync("docker", args, { stdio: "inherit" });
  if (built.status !== 0) fail(`docker buildx build exited ${built.status ?? built.signal}.`);
  console.log(JSON.stringify({ repository, tags, platforms }));
} finally {
  await rm(context, { recursive: true, force: true });
}
