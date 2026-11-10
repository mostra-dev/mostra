/**
 * Where a request goes, by its exact `Host` (INTERFACES §18.4, D165 item 7, D167): the API origin;
 * a configured user-content domain's apex, the hosted shell; a route's label under a configured
 * domain, or under a domain an operator supplies, the route's frames; a host an operator supplies
 * (`routing.resolve`), a hosted shell for one home or one route; and anything else, nothing (421).
 *
 * A host an operator supplies is recorded the first time it is served (`operator_host` and
 * `label_issued`, kind `operator`), bound to its home forever: an answer that would move it to
 * another home is refused and logged, so no origin, nor the browser storage it holds, passes to
 * another tenant. The operator is asked again for a recorded host as its answer's cache allows,
 * and a host it no longer answers for gets nothing; when it doesn't answer in time, the recorded
 * binding is served, since views proceed without the operator (D165 item 9).
 */
import type { RoutingAnswer } from "@mostra/protocol/operator";
import type { Ledger } from "../ledger/index.ts";
import type { Log } from "../log.ts";
import type { Operator } from "./operator.ts";

/** The server's own labels: 26 lower-case Crockford base32 characters (§18.4). */
export const SERVER_LABEL: RegExp = /^[0-9a-hjkmnp-tv-z]{26}$/;

/** Where one request goes. */
export type Destination =
  | { readonly kind: "api" }
  | {
      /** A hosted shell: a configured apex (any home's routes), or an operator's host. */
      readonly kind: "shell";
      readonly host: string;
      readonly frameDomain: string;
      /** The one home an operator's host serves; absent on a configured apex. */
      readonly homeId?: string;
      /** The one route an operator's host serves. */
      readonly routeId?: string;
    }
  | {
      readonly kind: "frame";
      readonly frameDomain: string;
      readonly route: { readonly id: string; readonly homeId: string };
    }
  | { readonly kind: "none" };

/** A recorded operator host. */
interface HostRow {
  readonly host: string;
  readonly home_id: string;
  readonly route_id: string | null;
  readonly frame_domain: string;
}

/** Options for {@link createRouting}. */
export interface RoutingOptions {
  readonly apiHost: string;
  /** The configured user-content domains (D137). */
  readonly domains: () => readonly string[];
  /** The active one, under which a chosen route's frames sit. */
  readonly active: () => string;
  readonly directory: Ledger;
  readonly operator: Operator;
  readonly log: Log;
}

/** The server's routing. */
export interface Routing {
  /** Where a request for `host` goes. */
  destination(host: string): Promise<Destination>;
  /**
   * An operator host for one home's links (`routing.linkHost`): resolved and recorded when it is
   * new, and given only when it serves that home (and route); `undefined` otherwise.
   */
  linkHost(homeId: string, routeId: string, host: string): Promise<string | undefined>;
  /** Whether `host` is a shell of this home: a configured apex, or one of its operator hosts. */
  servesShell(homeId: string, host: string): boolean;
  /** The frame domain of a shell host for a route of a home, or `undefined`. */
  frameDomainOf(homeId: string, routeId: string, shellHost: string): string | undefined;
  /** The shell hosts that may frame a route's pages on a frame domain (`frame-ancestors`). */
  ancestorsOf(homeId: string, routeId: string, frameDomain: string): string[];
}

/** Builds the routing over the directory and the operator. */
export function createRouting(options: RoutingOptions): Routing {
  const { directory, operator, log } = options;
  const configured = (host: string): boolean => options.domains().includes(host);
  const configuredParent = (host: string): string | undefined =>
    options.domains().find((domain) => host.endsWith(`.${domain}`));

  const recorded = (host: string): HostRow | undefined =>
    directory.read((db) => db.get<HostRow>("SELECT * FROM operator_host WHERE host = ?", host));

  const routeByLabel = (label: string): { id: string; home_id: string } | undefined =>
    directory.read((db) =>
      db.get<{ id: string; home_id: string }>(
        "SELECT id, home_id FROM artifact_route WHERE label = ? AND removing_json IS NULL",
        label,
      ),
    );

  /** Whether an operator's answer may bind `host` at all: never the server's own names. */
  const bindable = (host: string): boolean => {
    if (host === options.apiHost || configured(host)) return false;
    const parent = configuredParent(host);
    if (parent !== undefined) {
      const label = host.slice(0, host.length - parent.length - 1);
      // One label under a configured domain, and never one the server could issue itself.
      if (label.includes(".") || SERVER_LABEL.test(label)) return false;
    }
    return true;
  };

  /** Records an operator's answer for a new host; `undefined` when it can't be bound. */
  const record = (host: string, answer: NonNullable<RoutingAnswer>): HostRow | undefined => {
    if (!bindable(host)) {
      log.warn("routing.answer_refused", { host, why: "reserved" });
      return undefined;
    }
    const at = new Date().toISOString();
    return directory.write((db) => {
      let row: HostRow;
      if ("shell" in answer) {
        if (!db.get("SELECT 1 FROM home WHERE id = ?", answer.shell.home)) return undefined;
        // A frame domain is configured, or one of the operator's own; never the API origin's.
        if (answer.shell.domain === options.apiHost) return undefined;
        row = {
          host,
          home_id: answer.shell.home,
          route_id: null,
          frame_domain: answer.shell.domain,
        };
      } else {
        const found = db.get<{ home_id: string }>(
          "SELECT home_id FROM artifact_route WHERE id = ? AND home_id = ? AND removing_json IS NULL",
          answer.route.routeId,
          answer.route.home,
        );
        if (!found) return undefined;
        row = {
          host,
          home_id: answer.route.home,
          route_id: answer.route.routeId,
          frame_domain: options.active(),
        };
      }
      const issued = db.get<{ home_id: string }>(
        "SELECT home_id FROM label_issued WHERE label = ?",
        host,
      );
      if (issued && issued.home_id !== row.home_id) {
        log.warn("routing.answer_refused", { host, why: "issued-to-another-home" });
        return undefined;
      }
      if (!issued) {
        db.run(
          "INSERT INTO label_issued (label, home_id, route_id, kind, issued_at) VALUES (?, ?, ?, 'operator', ?)",
          host,
          row.home_id,
          row.route_id,
          at,
        );
      }
      db.run(
        "INSERT INTO operator_host (host, home_id, route_id, frame_domain, recorded_at) VALUES (?, ?, ?, ?, ?)",
        row.host,
        row.home_id,
        row.route_id,
        row.frame_domain,
        at,
      );
      log.info("routing.host_recorded", { host, home: row.home_id });
      return row;
    });
  };

  /** Whether an operator's answer agrees with a recorded host's binding. */
  const agrees = (row: HostRow, answer: NonNullable<RoutingAnswer>): boolean =>
    "shell" in answer
      ? answer.shell.home === row.home_id &&
        row.route_id === null &&
        answer.shell.domain === row.frame_domain
      : answer.route.home === row.home_id && answer.route.routeId === row.route_id;

  /** The operator's host for `host`, asked and recorded, or `undefined`. */
  const operatorHost = async (host: string): Promise<HostRow | undefined> => {
    const row = recorded(host);
    if (!operator.has.routing) return undefined;
    const answer = await operator.route(host);
    if (answer === "unavailable") return row;
    if (answer === null) return undefined;
    if (row) {
      if (agrees(row, answer)) return row;
      log.warn("routing.answer_refused", { host, why: "moved" });
      return undefined;
    }
    return record(host, answer);
  };

  const asShell = (row: HostRow): Destination => ({
    kind: "shell",
    host: row.host,
    frameDomain: row.frame_domain,
    homeId: row.home_id,
    ...(row.route_id !== null ? { routeId: row.route_id } : {}),
  });

  /** A route's frames on `<label>.<domain>`, when the label is the route's and the domain serves it. */
  const frame = (host: string): Destination | undefined => {
    const dot = host.indexOf(".");
    if (dot <= 0) return undefined;
    const label = host.slice(0, dot);
    const domain = host.slice(dot + 1);
    if (!SERVER_LABEL.test(label)) return undefined;
    const route = routeByLabel(label);
    if (!route) return undefined;
    if (configured(domain)) {
      return { kind: "frame", frameDomain: domain, route: { id: route.id, homeId: route.home_id } };
    }
    // An operator's frame domain serves only the routes of the homes it was given for.
    const served = directory.read((db) =>
      db.get(
        "SELECT 1 FROM operator_host WHERE frame_domain = ? AND home_id = ? AND (route_id IS NULL OR route_id = ?)",
        domain,
        route.home_id,
        route.id,
      ),
    );
    return served
      ? { kind: "frame", frameDomain: domain, route: { id: route.id, homeId: route.home_id } }
      : undefined;
  };

  return {
    async destination(host) {
      if (host === options.apiHost) return { kind: "api" };
      if (configured(host)) return { kind: "shell", host, frameDomain: host };
      const framed = frame(host);
      if (framed) return framed;
      const row = await operatorHost(host);
      return row ? asShell(row) : { kind: "none" };
    },

    async linkHost(homeId, routeId, host) {
      const row = await operatorHost(host.toLowerCase());
      if (!row || row.home_id !== homeId) return undefined;
      if (row.route_id !== null && row.route_id !== routeId) return undefined;
      return row.host;
    },

    servesShell(homeId, host) {
      if (configured(host)) return true;
      const row = recorded(host);
      return row !== undefined && row.home_id === homeId;
    },

    frameDomainOf(homeId, routeId, shellHost) {
      if (configured(shellHost)) return shellHost;
      const row = recorded(shellHost);
      if (!row || row.home_id !== homeId) return undefined;
      if (row.route_id !== null && row.route_id !== routeId) return undefined;
      return row.frame_domain;
    },

    ancestorsOf(homeId, routeId, frameDomain) {
      const hosts = configured(frameDomain) ? [frameDomain] : [];
      for (const row of directory.read((db) =>
        db.all<{ host: string }>(
          "SELECT host FROM operator_host WHERE frame_domain = ? AND home_id = ? AND (route_id IS NULL OR route_id = ?) ORDER BY host",
          frameDomain,
          homeId,
          routeId,
        ),
      )) {
        hosts.push(row.host);
      }
      return hosts;
    },
  };
}
