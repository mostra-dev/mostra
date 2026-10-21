/**
 * Secrets (D44, AC-06): named values server code reads with `secret(name)`, kept outside artifact
 * source in the home's owner-only store, `secrets/<scope>/<name>` (mode 0600, directories 0700),
 * where the scope is `home` for a secret every artifact shares or the artifact's ID for its own.
 * A host may supply secrets through its `secrets` port instead (a host's own credential store).
 *
 * Every value Mostra holds or hands out is registered with the instance's redactor, so it never
 * reaches a log, a run log, an event, a diagnostic or a report. Nothing derived from a value is
 * ever written to the ledger.
 */
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
  type ArtifactRef,
  createDiagnostic,
  RpcError,
  SECRET_NAME_PATTERN,
  SECRET_VALUE_MAX,
  type SecretEntry,
  secretDeleteMethod,
  secretListMethod,
  secretSetMethod,
} from "@mostra/protocol";
import type { Log, Redactor } from "../log.ts";
import { handler, type MethodHandler } from "../protocol-server/index.ts";

/** Where a secret lives: the home's shared store, or one artifact's. */
export type SecretScope =
  | { readonly kind: "home" }
  | { readonly kind: "artifact"; readonly artifactId: string };

/** Asks a host's `secrets` port; `null` when it has none, an error when it failed. */
export type SecretsPort = (request: { artifactId: string; name: string }) => Promise<string | null>;

/** The home's secrets. */
export interface Secrets {
  /** Stores a secret, replacing an earlier value. */
  set(name: string, value: string, scope: SecretScope): SecretEntry;
  /** The names in the home's scope, and in the artifact's when one is named. */
  list(artifactId?: string): SecretEntry[];
  /** Deletes a secret; `false` when there was none. */
  delete(name: string, scope: SecretScope): boolean;
  /**
   * The value server code of `artifactId` gets for `name`: the host's port first, then the
   * artifact's own secret, then the home's shared one.
   *
   * @throws RpcError `MOSTRA_SECRET_MISSING` when no store holds it, or the port failed.
   */
  resolve(artifactId: string, name: string): Promise<string>;
}

/** Options for {@link openSecrets}. */
export interface SecretsOptions {
  /** The home's real path. */
  readonly home: string;
  readonly redactor: Redactor;
  readonly log: Log;
  /** The host's `secrets` port, while a connected host registered it. */
  readonly port?: () => SecretsPort | undefined;
}

const HOME_SCOPE = "home";
const ARTIFACT_SCOPE = /^art_[0-9A-HJKMNP-TV-Z]{26}$/;

function missing(name: string, detail?: string): RpcError {
  return new RpcError(
    createDiagnostic("MOSTRA_SECRET_MISSING", {
      message: `No secret named ${name} is set${detail ? ` (${detail})` : ""}.`,
      hint: `Set it with \`mostra secret set ${name}\`, reading the value from stdin.`,
    }),
  );
}

function invalidName(name: string): RpcError {
  return new RpcError(
    createDiagnostic("MOSTRA_HOST_INVALID_PARAMS", {
      message: `${JSON.stringify(name).slice(0, 80)} isn't a secret name: a letter or "_", then up to 127 letters, digits, "_", "." and "-".`,
    }),
  );
}

/** Opens the home's secret store, registering every stored value with the redactor. */
export function openSecrets(options: SecretsOptions): Secrets {
  const root = join(options.home, "secrets");
  mkdirSync(root, { recursive: true, mode: 0o700 });
  chmodSync(root, 0o700);

  const dirOf = (scope: SecretScope): string =>
    join(root, scope.kind === "home" ? HOME_SCOPE : scope.artifactId);

  const read = (dir: string, name: string): string | undefined => {
    try {
      return readFileSync(join(dir, name), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  };

  // Every value already stored is protected before anything is logged.
  for (const scope of existsSync(root) ? readdirSync(root) : []) {
    if (scope !== HOME_SCOPE && !ARTIFACT_SCOPE.test(scope)) continue;
    for (const name of readdirSync(join(root, scope))) {
      if (!SECRET_NAME_PATTERN.test(name)) continue;
      const value = read(join(root, scope), name);
      if (value !== undefined) options.redactor.protectSecret(value);
    }
  }

  const entry = (dir: string, name: string, scope: SecretScope): SecretEntry => ({
    name,
    scope: scope.kind,
    ...(scope.kind === "artifact" ? { artifactId: scope.artifactId } : {}),
    updatedAt: statSync(join(dir, name)).mtime.toISOString(),
  });

  const listScope = (scope: SecretScope): SecretEntry[] => {
    const dir = dirOf(scope);
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((name) => SECRET_NAME_PATTERN.test(name))
      .sort()
      .map((name) => entry(dir, name, scope));
  };

  return {
    set(name, value, scope) {
      if (!SECRET_NAME_PATTERN.test(name)) throw invalidName(name);
      if (value.length === 0 || Buffer.byteLength(value, "utf8") > SECRET_VALUE_MAX) {
        throw new RpcError(
          createDiagnostic("MOSTRA_HOST_INVALID_PARAMS", {
            message: `The value of the secret ${name} must be 1 byte to 64 KiB of UTF-8.`,
          }),
        );
      }
      options.redactor.protectSecret(value);
      const dir = dirOf(scope);
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      chmodSync(dir, 0o700);
      // Written beside it, then renamed: a reader never sees half a value.
      const temporary = join(dir, `.${name}.${process.pid}.tmp`);
      writeFileSync(temporary, value, { mode: 0o600, flag: "w" });
      chmodSync(temporary, 0o600);
      renameSync(temporary, join(dir, name));
      options.log.info("secret.set", { name, scope: scope.kind });
      return entry(dir, name, scope);
    },
    list(artifactId) {
      return [
        ...listScope({ kind: "home" }),
        ...(artifactId ? listScope({ kind: "artifact", artifactId }) : []),
      ];
    },
    delete(name, scope) {
      if (!SECRET_NAME_PATTERN.test(name)) throw invalidName(name);
      const file = join(dirOf(scope), name);
      if (!existsSync(file)) return false;
      rmSync(file, { force: true });
      options.log.info("secret.deleted", { name, scope: scope.kind });
      return true;
    },
    async resolve(artifactId, name) {
      if (!SECRET_NAME_PATTERN.test(name)) throw missing(name, "not a secret name");
      const port = options.port?.();
      if (port) {
        let value: string | null;
        try {
          value = await port({ artifactId, name });
        } catch (error) {
          options.log.warn("secret.port_failed", {
            name,
            error: String((error as Error)?.message ?? error),
          });
          throw missing(name, "the host's secrets port didn't answer");
        }
        if (typeof value === "string") {
          options.redactor.protectSecret(value);
          return value;
        }
      }
      const value =
        read(dirOf({ kind: "artifact", artifactId }), name) ?? read(dirOf({ kind: "home" }), name);
      if (value === undefined) throw missing(name);
      // A file written into the store by hand since start-up is protected before it leaves.
      options.redactor.protectSecret(value);
      return value;
    },
  };
}

/** The `secret/*` methods (D44): set by name from the value given, list names, delete. */
export function secretMethods(
  secrets: Secrets,
  resolveArtifact: (ref: ArtifactRef) => string,
): MethodHandler[] {
  const scopeOf = (artifact: ArtifactRef | undefined): SecretScope =>
    artifact === undefined
      ? { kind: "home" }
      : { kind: "artifact", artifactId: resolveArtifact(artifact) };
  return [
    handler(secretSetMethod, (params) =>
      secrets.set(params.name, params.value, scopeOf(params.artifact)),
    ),
    handler(secretListMethod, (params) => ({
      secrets: secrets.list(
        params.artifact === undefined ? undefined : resolveArtifact(params.artifact),
      ),
    })),
    handler(secretDeleteMethod, (params) => ({
      deleted: secrets.delete(params.name, scopeOf(params.artifact)),
    })),
  ];
}
