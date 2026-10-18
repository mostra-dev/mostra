/**
 * Whether telemetry sends, and why (D140 item 3). The first match decides, so an explicit "off"
 * anywhere wins over any "on", and withdrawn consent sticks.
 */
import type { Environment } from "../home.ts";
import type { ReadSettings } from "./store.ts";
import type { TelemetryReason } from "./words.ts";

/** The endpoint this build sends to, set only by the release workflow at bundle time (D140 item 7). */
declare const __MOSTRA_TELEMETRY_ENDPOINT__: string | undefined;

/** The build's endpoint: empty in this package and in every development build. */
export function buildEndpoint(): string {
  return typeof __MOSTRA_TELEMETRY_ENDPOINT__ === "string" ? __MOSTRA_TELEMETRY_ENDPOINT__ : "";
}

/** What the decision reads. */
export interface DecisionInputs {
  readonly env: Environment;
  /** The build's endpoint ({@link buildEndpoint}); tests pass their own. */
  readonly buildEndpoint: string;
  /** Whether this use is embedded: a host-spawned instance, or a home a host configures. */
  readonly embedded: boolean;
  readonly settings: ReadSettings;
  /** Whether this machine's time zone asks first. */
  readonly askFirst: boolean;
}

/** The decision. */
export interface TelemetryDecision {
  readonly enabled: boolean;
  readonly reason: TelemetryReason;
  readonly askFirst: boolean;
  /** The endpoint events go to, when there is one. */
  readonly endpoint?: string;
  /** For an enabled decision: whether the person said yes, or it is the default. */
  readonly consent?: "explicit" | "default";
}

const OFF_VALUES = new Set(["0", "false", "off", "no"]);
const ON_VALUES = new Set(["1", "true", "on", "yes"]);

/** `DO_NOT_TRACK` and `MOSTRA_OFFLINE`'s parser: set to anything but empty, `0` or `false`. */
export function truthy(value: string | undefined): boolean {
  if (value === undefined) return false;
  const normalized = value.trim().toLowerCase();
  return normalized !== "" && normalized !== "0" && normalized !== "false";
}

/**
 * The endpoint in use: `MOSTRA_TELEMETRY_ENDPOINT` when it is `https:` or `http:` to a loopback
 * address, else the build's; `undefined` when there is none (D140 item 7).
 */
export function endpointOf(env: Environment, build: string): string | undefined {
  const override = env["MOSTRA_TELEMETRY_ENDPOINT"];
  const chosen = override !== undefined && override !== "" ? override : build;
  if (chosen === "") return undefined;
  let url: URL;
  try {
    url = new URL(chosen);
  } catch {
    return undefined;
  }
  if (url.username !== "" || url.password !== "") return undefined;
  if (url.protocol === "https:") return url.href;
  const loopback =
    url.hostname === "127.0.0.1" || url.hostname === "[::1]" || url.hostname === "localhost";
  return url.protocol === "http:" && loopback ? url.href : undefined;
}

/** Decides, in D140's order. */
export function decide(inputs: DecisionInputs): TelemetryDecision {
  const { askFirst } = inputs;
  const off = (reason: TelemetryReason): TelemetryDecision => ({
    enabled: false,
    reason,
    askFirst,
  });
  const endpoint = endpointOf(inputs.env, inputs.buildEndpoint);
  if (endpoint === undefined) return off("no-collector");
  const at = { askFirst, endpoint };
  if (inputs.embedded) return { ...at, enabled: false, reason: "embedded" };
  if (truthy(inputs.env["DO_NOT_TRACK"])) return { ...at, enabled: false, reason: "do-not-track" };
  const variable = inputs.env["MOSTRA_TELEMETRY"];
  const normalized = variable?.trim().toLowerCase();
  if (normalized !== undefined && OFF_VALUES.has(normalized)) {
    return { ...at, enabled: false, reason: "variable" };
  }
  if (!inputs.settings.ok) return { ...at, enabled: false, reason: "unreadable" };
  const choice = inputs.settings.settings.choice;
  if (choice === "off") return { ...at, enabled: false, reason: "setting" };
  if (normalized !== undefined && normalized !== "") {
    return ON_VALUES.has(normalized)
      ? { ...at, enabled: true, reason: "variable", consent: "explicit" }
      : { ...at, enabled: false, reason: "variable-invalid" };
  }
  if (choice === "on") return { ...at, enabled: true, reason: "setting", consent: "explicit" };
  return askFirst
    ? { ...at, enabled: false, reason: "default" }
    : { ...at, enabled: true, reason: "default", consent: "default" };
}
