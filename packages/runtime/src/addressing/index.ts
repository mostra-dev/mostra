/**
 * Addressing (D21, D38, D70, D99): where the instance is reachable. It decides the bind address
 * and the URL host, forms each listener's origin and its exact `Host` allowlist, leases a stable
 * port per home for the shell and for each artifact, binds servers to their leased ports (leasing
 * a new one when another program took it), and picks the frame-session mode for a shell and
 * artifact origin pair. The gateway decides what is served on those ports.
 *
 * ```ts
 * const addressing = createAddressing({ ledger, log, bind: { address: "127.0.0.1" } });
 * const port = await addressing.listen(server, { purpose: "artifact", owner: artifactId });
 * addressing.origin(port); // "http://127.0.0.1:23457"
 * ```
 */
import { randomInt } from "node:crypto";
import type { Server } from "node:net";
import { isIP } from "node:net";
import { createDiagnostic, RpcError } from "@mostra/protocol";
import type { Ledger } from "../ledger/index.ts";
import type { Log } from "../log.ts";

/** The lowest port Mostra leases: below every ephemeral range (D99). */
export const LEASE_FIRST_PORT = 20000;
/** The highest port Mostra leases: Linux's ephemeral range starts at 32768, macOS's at 49152. */
export const LEASE_LAST_PORT = 32767;
/** How many free ports to try before giving up on a lease. */
const LEASE_ATTEMPTS = 64;

/** What a lease is for (DATA_MODEL §3 `port_lease.purpose`). */
export type LeasePurpose = "shell" | "artifact" | "demo";

/** Who holds a lease: the shell, an artifact ID, or a demo. */
export interface LeaseOwner {
  readonly purpose: LeasePurpose;
  /** `shell` for the shell; the artifact ID for an artifact. */
  readonly owner: string;
}

/** How the gateway binds (D99). */
export interface BindOptions {
  /** The address to listen on; `127.0.0.1` unless `--bind` names another. */
  readonly address: string;
  /** The host name URLs use and the Host allowlist accepts; required for a wildcard address. */
  readonly urlHost?: string;
}

/** How a frame authenticates for one shell and artifact origin pair (D70, D98). */
export type FrameMode = "cookie" | "worker";

/** Where the instance is reachable. */
export interface Addressing {
  /** The address every listener binds. */
  readonly bindAddress: string;
  /** The host name in every URL, bracketed when it is an IPv6 literal. */
  readonly urlHost: string;
  /** The origin a listener on `port` serves: `http://<url host>:<port>`. */
  origin(port: number): string;
  /** The exact `Host` values a listener on `port` accepts, lowercase. */
  hosts(port: number): readonly string[];
  /** The leased port of an owner, if it has one. */
  leased(owner: LeaseOwner): number | undefined;
  /** Every lease, for binding them all at start. */
  leases(): readonly (LeaseOwner & { readonly port: number })[];
  /**
   * Binds `server` to the owner's leased port, or to a newly leased one when it has none or
   * another program holds it (`MOSTRA_ENV_PORT_TAKEN`). Resolves with the bound port.
   */
  listen(server: Server, owner: LeaseOwner): Promise<number>;
  /**
   * The frame-session mode for a shell and artifact origin pair: cookie mode when they share a
   * host (same site, D38), worker mode otherwise (cross-site, D70).
   */
  frameMode(shellOrigin: string, artifactOrigin: string): FrameMode;
}

/** The unspecified addresses, as {@link authorityHost} writes them: each listens everywhere. */
const WILDCARDS = new Set(["0.0.0.0", "[::]", "[::ffff:0:0]"]);

function bindFailed(message: string): RpcError {
  return new RpcError(createDiagnostic("MOSTRA_ENV_BIND_FAILED", { message }));
}

/**
 * Validates the bind flags (D99) and returns the address and URL host. A wildcard address needs
 * `urlHost`; `urlHost` alone, without a wider bind, is refused, so a URL never names a host the
 * gateway doesn't listen on.
 */
export function resolveBind(options: {
  readonly bind?: string | undefined;
  readonly urlHost?: string | undefined;
}): BindOptions {
  const address = options.bind ?? "127.0.0.1";
  const bare = address.replace(/^\[(.*)\]$/, "$1");
  if (isIP(bare) === 0) {
    throw bindFailed(`--bind takes an IP address, such as 127.0.0.1 or 0.0.0.0, not "${address}".`);
  }
  if (options.urlHost !== undefined && options.bind === undefined) {
    throw bindFailed("--url-host needs --bind: without it the gateway listens on 127.0.0.1 only.");
  }
  // Compared in canonical form, so `0:0:0:0:0:0:0:0`, `::0` and `::ffff:0.0.0.0` count too.
  if (WILDCARDS.has(authorityHost(bare)) && options.urlHost === undefined) {
    throw bindFailed(
      `--bind ${address} listens on every interface; name the host viewers use with --url-host.`,
    );
  }
  if (
    options.urlHost !== undefined &&
    !/^(\[[0-9a-f:.]+\]|[a-z0-9.-]+|[0-9a-f:]+)$/i.test(options.urlHost)
  ) {
    throw bindFailed(`--url-host takes a host name or an IP address, not "${options.urlHost}".`);
  }
  if (options.urlHost !== undefined) {
    try {
      authorityHost(options.urlHost);
    } catch {
      throw bindFailed(`--url-host takes a host name or an IP address, not "${options.urlHost}".`);
    }
  }
  return { address: bare, ...(options.urlHost !== undefined ? { urlHost: options.urlHost } : {}) };
}

/**
 * A host as browsers write it in `Origin` and `Host`: lowercase, IPv6 compressed and bracketed
 * (`0:0:0:0:0:0:0:1` is `[::1]`). Origins and the Host allowlist use this form, so the exact
 * comparisons agree with what a browser sends however the flag spelled the address.
 */
function authorityHost(host: string): string {
  const bare = host.replace(/^\[(.*)\]$/, "$1");
  return new URL(`http://${isIP(bare) === 6 ? `[${bare}]` : bare}/`).hostname;
}

/**
 * Binds `server` to `port` on `address`; resolves `false` when that port is taken. Every other
 * failure is about the address, so no port would do: it is `MOSTRA_ENV_BIND_FAILED`.
 */
function tryListen(server: Server, port: number, address: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const onError = (error: NodeJS.ErrnoException): void => {
      server.off("listening", onListening);
      if (error.code === "EADDRINUSE" || error.code === "EACCES") resolve(false);
      else if (error.code === "EADDRNOTAVAIL") {
        reject(bindFailed(`No network interface of this machine has the address ${address}.`));
      } else if (error.code === "EAFNOSUPPORT") {
        reject(
          bindFailed(
            `This machine has no ${isIP(address) === 6 ? "IPv6" : "IPv4"} support for ${address}.`,
          ),
        );
      } else {
        reject(
          bindFailed(`The gateway can't listen on ${address}: ${error.code ?? error.message}.`),
        );
      }
    };
    const onListening = (): void => {
      server.off("error", onError);
      resolve(true);
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen({ port, host: address, exclusive: true });
  });
}

/** Creates the addressing of one instance over its ledger's `port_lease` table. */
export function createAddressing(options: {
  readonly ledger: Ledger;
  readonly log: Log;
  readonly bind: BindOptions;
  /**
   * Listen on ports the operating system assigns and lease none: a `verify` run's short-lived
   * listeners (D138). Ephemeral ports lie above the lease range (D99), so they never take a port
   * leased to an artifact whose listener isn't bound yet (D132).
   */
  readonly ephemeral?: boolean;
}): Addressing {
  const { ledger, log } = options;
  const bindAddress = options.bind.address;
  const urlHost = authorityHost(options.bind.urlHost ?? bindAddress).toLowerCase();

  const leased = (owner: LeaseOwner): number | undefined =>
    ledger.read((db) =>
      db.get<{ port: number }>(
        "SELECT port FROM port_lease WHERE purpose = ? AND owner_ref = ?",
        owner.purpose,
        owner.owner,
      ),
    )?.port;

  const record = (owner: LeaseOwner, port: number): void => {
    ledger.write((db) => {
      db.run(
        "DELETE FROM port_lease WHERE purpose = ? AND owner_ref = ?",
        owner.purpose,
        owner.owner,
      );
      // A port another owner once held, but that this process could bind, is no longer theirs.
      db.run("DELETE FROM port_lease WHERE port = ?", port);
      db.run(
        "INSERT INTO port_lease (port, purpose, owner_ref, leased_at) VALUES (?, ?, ?, ?)",
        port,
        owner.purpose,
        owner.owner,
        new Date().toISOString(),
      );
    });
  };

  const taken = (): Set<number> =>
    new Set(
      ledger
        .read((db) => db.all<{ port: number }>("SELECT port FROM port_lease"))
        .map((row) => row.port),
    );

  return {
    bindAddress,
    urlHost,
    origin: (port) => `http://${urlHost}:${port}`,
    hosts: (port) => [`${urlHost}:${port}`],
    leased,
    leases: () =>
      ledger
        .read((db) =>
          db.all<{ port: number; purpose: LeasePurpose; owner_ref: string }>(
            "SELECT port, purpose, owner_ref FROM port_lease ORDER BY purpose DESC, port",
          ),
        )
        .map((row) => ({ port: row.port, purpose: row.purpose, owner: row.owner_ref })),
    async listen(server, owner) {
      if (options.ephemeral) {
        if (!(await tryListen(server, 0, bindAddress))) {
          throw bindFailed(`No ephemeral port is free on ${bindAddress}.`);
        }
        const address = server.address();
        if (address === null || typeof address === "string") throw new Error("not a TCP listener");
        return address.port;
      }
      const previous = leased(owner);
      if (previous !== undefined) {
        if (await tryListen(server, previous, bindAddress)) return previous;
        log.warn("addressing.port_taken", {
          code: "MOSTRA_ENV_PORT_TAKEN",
          purpose: owner.purpose,
          owner: owner.owner,
          port: previous,
        });
      }
      const others = taken();
      for (let attempt = 0; attempt < LEASE_ATTEMPTS; attempt++) {
        const port = randomInt(LEASE_FIRST_PORT, LEASE_LAST_PORT + 1);
        if (others.has(port)) continue;
        if (!(await tryListen(server, port, bindAddress))) continue;
        record(owner, port);
        if (previous !== undefined) {
          log.warn("addressing.port_released", {
            purpose: owner.purpose,
            owner: owner.owner,
            from: previous,
            to: port,
          });
        }
        return port;
      }
      throw bindFailed(
        `No free port between ${LEASE_FIRST_PORT} and ${LEASE_LAST_PORT} on ${bindAddress} after ${LEASE_ATTEMPTS} attempts.`,
      );
    },
    frameMode(shellOrigin, artifactOrigin) {
      return new URL(shellOrigin).hostname === new URL(artifactOrigin).hostname
        ? "cookie"
        : "worker";
    },
  };
}
