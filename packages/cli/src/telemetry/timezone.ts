/**
 * Whether this machine's time zone asks first (D140 items 2 and 10). The zone is read here, on
 * this machine, and never sent. Every candidate name counts, as given: `TZ` (a leading `:`
 * removed), the target of `/etc/localtime`, and `Intl`'s zone. A machine asks first when any of
 * them is an ask-first zone, or none is a zone tzdata knows (missing, empty, `Etc/Unknown`, a
 * POSIX rule, a typo). Names are never canonicalized: tzdata links `Europe/Zagreb` to
 * `Europe/Belgrade` and `Indian/Reunion` to `Asia/Dubai`, and ICU builds differ in what they
 * resolve.
 */
import { readlinkSync } from "node:fs";
import type { Environment } from "../home.ts";
import { ASK_FIRST_ZONES, KNOWN_ZONES } from "./zones.generated.ts";

const ASK_FIRST = new Set(ASK_FIRST_ZONES);
const KNOWN = new Set(KNOWN_ZONES);

/** Where the zone names come from; tests replace each. */
export interface ZoneSources {
  readonly env: Environment;
  /** The target of `/etc/localtime`, or `undefined`. */
  readonly localtime?: () => string | undefined;
  /** `Intl.DateTimeFormat().resolvedOptions().timeZone`, which can be `undefined`. */
  readonly intl?: () => string | undefined;
}

/** The target of `/etc/localtime` after `zoneinfo/`, when it is a symbolic link. */
function localtimeLink(): string | undefined {
  try {
    const target = readlinkSync("/etc/localtime");
    const at = target.lastIndexOf("zoneinfo/");
    return at === -1 ? undefined : target.slice(at + "zoneinfo/".length);
  } catch {
    return undefined;
  }
}

function intlZone(): string | undefined {
  try {
    const zone: unknown = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return typeof zone === "string" ? zone : undefined;
  } catch {
    return undefined;
  }
}

/** The candidate zone names, as given (empty and missing ones dropped). */
export function zoneCandidates(sources: ZoneSources): string[] {
  const tz = sources.env["TZ"];
  const fromTz = tz === undefined ? undefined : tz.startsWith(":") ? tz.slice(1) : tz;
  // Tests of the real binary name the machine's zone (`/etc/localtime`) with
  // MOSTRA_TEST_LOCALTIME, empty for none, as the runtime's MOSTRA_TEST_* hooks do; nothing else
  // reads it.
  const testLocaltime = sources.env["MOSTRA_TEST_LOCALTIME"];
  const localtime =
    sources.localtime ??
    (testLocaltime !== undefined
      ? () => (testLocaltime === "" ? undefined : testLocaltime)
      : localtimeLink);
  const names = [fromTz, localtime(), (sources.intl ?? intlZone)()];
  return names.filter((name): name is string => typeof name === "string" && name.length > 0);
}

/** Whether telemetry asks first on this machine. */
export function asksFirst(sources: ZoneSources): boolean {
  const candidates = zoneCandidates(sources);
  if (candidates.some((name) => ASK_FIRST.has(name))) return true;
  // TZ, when set, is the zone the process runs in: an empty one (UTC under POSIX), a POSIX rule
  // or a name tzdata doesn't know is an unknown zone, so ask first.
  const tz = sources.env["TZ"];
  if (tz !== undefined && !KNOWN.has(tz.startsWith(":") ? tz.slice(1) : tz)) return true;
  return !candidates.some((name) => KNOWN.has(name) && name !== "Etc/Unknown");
}
