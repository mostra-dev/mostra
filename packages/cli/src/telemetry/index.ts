/**
 * The standalone CLI's telemetry (D119, D140): the only code in Mostra that can send an event, and
 * only `@mostra/cli` may import it (a dependency-cruiser rule). The runner calls {@link begin}
 * before a command's work and {@link end} after it; everything else here is the decision, the
 * words, the schema, the store and the flusher.
 */
import { type DiagnosticCode, diagnosticCatalog } from "@mostra/protocol";
import type { Environment } from "../home.ts";
import { cliVersion } from "../version.ts";
import { buildEndpoint, decide, type TelemetryDecision, truthy } from "./decision.ts";
import {
  type CommonFields,
  catalogCodes,
  durationBucket,
  minute,
  SCHEMA,
  TelemetryEvent,
} from "./events.ts";
import { startFlusher } from "./flush.ts";
import { detectHarness } from "./harness.ts";
import { TelemetryStore } from "./store.ts";
import { asksFirst, type ZoneSources } from "./timezone.ts";
import { ANSWER, NOTICE_ASK_FIRST, NOTICE_DEFAULT, QUESTION, statusLine } from "./words.ts";

export { TelemetryStore } from "./store.ts";
export { TURNED } from "./words.ts";

/** The catalog's codes: only these leave the machine in `error` and `codes`. */
const CATALOG = new Set(Object.keys(diagnosticCatalog));

/** Variables CI services set; any of them means `ci: true`, and the question is never asked. */
const CI_MARKERS = [
  "CI",
  "CONTINUOUS_INTEGRATION",
  "GITHUB_ACTIONS",
  "GITLAB_CI",
  "BUILDKITE",
  "CIRCLECI",
  "TRAVIS",
  "TF_BUILD",
  "JENKINS_URL",
  "TEAMCITY_VERSION",
  "BITBUCKET_BUILD_NUMBER",
  "CODEBUILD_BUILD_ID",
];

/** Whether this process runs in CI. */
export function inCi(env: Environment): boolean {
  return CI_MARKERS.some((name) => truthy(env[name]));
}

/** What a session of one command needs. */
export interface TelemetryOptions {
  readonly env: Environment;
  readonly configDir: string;
  /** The command's path from the definitions (`daemon install`), or `unknown`. */
  readonly command: string;
  readonly json: boolean;
  readonly tty: { readonly stdin: boolean; readonly stderr: boolean };
  /** The command reads stdin, so the question would take its input. */
  readonly readsStdin: boolean;
  /** `telemetry`, `docs`, `--help`, `--version`: no notice, no question, no event. */
  readonly quiet: boolean;
  /** Whether the home is a host's (its `config.json` mark, or a file that can't be read). */
  readonly hostHome: boolean;
  /** Writes to stderr. */
  readonly stderr: (text: string) => void;
  /** Asks one line on stderr and reads the answer, `undefined` for none within `timeoutMs`. */
  readonly ask: (question: string, timeoutMs: number) => Promise<string | undefined | "interrupt">;
  /** The clock; tests move it. */
  readonly now?: () => number;
  /** The build's endpoint; tests pass their own. Default {@link buildEndpoint}. */
  readonly buildEndpoint?: string;
  /** Where the zone names come from; tests replace `/etc/localtime` and `Intl`. */
  readonly zones?: Omit<ZoneSources, "env">;
  /** Starts the flusher after queueing; tests of the queue turn it off. Default true. */
  readonly flush?: boolean;
}

/** How long the question waits for an answer. */
export const QUESTION_TIMEOUT_MS = 60_000;

/** One command's telemetry. */
export interface TelemetrySession {
  /** Before the command's work: the notice, or the question. Resolves `false` when Ctrl-C ended it. */
  begin(): Promise<boolean>;
  /** Records an event of the command (`verify.result`, `publish.done`). */
  record(event: {
    readonly event: "verify.result" | "publish.done";
    readonly fields: Readonly<Record<string, unknown>>;
  }): void;
  /** After the command: queues its events and starts the flusher, when telemetry allows. */
  end(outcome: {
    readonly exit: number;
    readonly durationMs: number;
    readonly error?: string;
    /** The instance was host-spawned. */
    readonly hostInstance: boolean;
  }): void;
}

/** The current decision, for `telemetry status` and the session. */
export function currentDecision(options: {
  readonly env: Environment;
  readonly store: TelemetryStore;
  readonly embedded: boolean;
  readonly buildEndpoint?: string;
  readonly zones?: Omit<ZoneSources, "env">;
}): TelemetryDecision {
  return decide({
    env: options.env,
    buildEndpoint: options.buildEndpoint ?? buildEndpoint(),
    embedded: options.embedded,
    settings: options.store.read(),
    askFirst: asksFirst({ ...options.zones, env: options.env }),
  });
}

/** Starts one command's telemetry. */
export function telemetrySession(options: TelemetryOptions): TelemetrySession {
  const now = options.now ?? Date.now;
  const store = new TelemetryStore(options.configDir);
  const pending: {
    event: "verify.result" | "publish.done";
    fields: Readonly<Record<string, unknown>>;
  }[] = [];
  const decision = (embedded: boolean): TelemetryDecision =>
    currentDecision({
      env: options.env,
      store,
      embedded,
      ...(options.buildEndpoint !== undefined ? { buildEndpoint: options.buildEndpoint } : {}),
      ...(options.zones !== undefined ? { zones: options.zones } : {}),
    });
  const shown = (): boolean => {
    const read = store.read();
    return read.ok && read.settings.noticeShownAt !== undefined;
  };
  /** Records that the notice was shown; `false` when the store can't be written. */
  const markShown = (): boolean =>
    store.update((current) => ({ ...current, noticeShownAt: new Date(now()).toISOString() })) !==
    undefined;
  const harness = detectHarness(options.env);
  const ci = inCi(options.env);

  return {
    async begin() {
      if (options.quiet) return true;
      const current = decision(options.hostHome);
      // No collector, a host's home, or a person who said no: nothing to say (D140 item 7).
      if (current.reason === "no-collector" || current.reason === "embedded") return true;
      // The notice is recorded before it is printed: a store that can't record it (a directory
      // that can't be written) means no notice, and so nothing ever sent.
      if (current.enabled) {
        if (!shown() && markShown()) options.stderr(NOTICE_DEFAULT);
        return true;
      }
      if (current.reason !== "default" || !current.askFirst) return true;
      const canAsk =
        options.tty.stdin &&
        options.tty.stderr &&
        !options.json &&
        !ci &&
        harness === "none" &&
        !options.readsStdin;
      if (!canAsk) {
        // Once, and on its own record: it never stands for the default notice.
        const read = store.read();
        if (read.ok && read.settings.askFirstNoticeShownAt === undefined) {
          const marked = store.update((settings) => ({
            ...settings,
            askFirstNoticeShownAt: new Date(now()).toISOString(),
          }));
          if (marked !== undefined) options.stderr(NOTICE_ASK_FIRST);
        }
        return true;
      }
      // A person who can answer and never did is asked, whatever notices they saw before.
      const answer = await options.ask(QUESTION, QUESTION_TIMEOUT_MS);
      const yes = typeof answer === "string" && /^\s*y(es)?\s*$/i.test(answer);
      const stored = store.update((settings) => ({
        ...settings,
        choice: yes ? "on" : "off",
        noticeShownAt: new Date(now()).toISOString(),
      }));
      options.stderr(
        stored === undefined
          ? `${statusLine({ enabled: false, reason: "unreadable", askFirst: true, settingsFile: store.settingsFile })}\n`
          : yes
            ? ANSWER.yes
            : answer === undefined
              ? ANSWER.timeout
              : ANSWER.no,
      );
      return answer !== "interrupt";
    },

    record(event) {
      pending.push({ event: event.event, fields: event.fields });
    },

    end(outcome) {
      if (options.quiet) return;
      const current = decision(options.hostHome || outcome.hostInstance);
      if (!current.enabled || current.consent === undefined || !shown()) return;
      const id = store.installId();
      if (!id) return;
      const common: CommonFields = {
        schema: SCHEMA,
        at: minute(new Date(now())),
        installId: id.id,
        version: cliVersion(),
        os:
          process.platform === "darwin" || process.platform === "win32"
            ? process.platform
            : "linux",
        arch: process.arch,
        node: Number(process.versions.node.split(".")[0]),
        harness,
        ci,
        consent: current.consent,
      };
      const events: unknown[] = [];
      if (id.created) events.push({ ...common, event: "cli.first_run" });
      for (const item of pending) {
        const fields =
          item.event === "verify.result"
            ? {
                status: item.fields["status"],
                ...catalogCodes((item.fields["codes"] as string[] | undefined) ?? [], CATALOG),
              }
            : item.fields;
        events.push({ ...common, ...fields, event: item.event });
      }
      events.push({
        ...common,
        event: "cli.command",
        command: options.command,
        exit: outcome.exit,
        duration: durationBucket(outcome.durationMs),
        json: options.json,
        ...(outcome.error !== undefined && CATALOG.has(outcome.error as DiagnosticCode)
          ? { error: outcome.error }
          : {}),
      });
      const lines: string[] = [];
      for (const event of events) {
        const parsed = TelemetryEvent.safeParse(event);
        if (parsed.success) lines.push(JSON.stringify(parsed.data));
      }
      if (truthy(options.env["MOSTRA_TELEMETRY_DEBUG"])) {
        // Exactly what would be sent, and nothing sent.
        for (const line of lines) options.stderr(`mostra telemetry (debug, not sent): ${line}\n`);
        return;
      }
      store.append(lines, now());
      if (options.flush !== false) startFlusher(store, options.env, now());
    },
  };
}

/** `mostra telemetry status`'s result. */
export interface TelemetryStatus {
  readonly enabled: boolean;
  readonly reason: TelemetryDecision["reason"];
  readonly askFirst: boolean;
  readonly installId?: string;
  readonly endpoint?: string;
  readonly queued: number;
  readonly noticeShownAt?: string;
  readonly settingsFile: string;
  /** With reason `unreadable`: the file that can't be read (the home's `config.json`, or this). */
  readonly unreadableFile?: string;
}

/** `mostra telemetry status`: the decision, the install ID and the queue. */
export function telemetryStatus(options: {
  readonly env: Environment;
  readonly configDir: string;
  readonly embedded: boolean;
  /**
   * The home's `config.json` when it can't be read: the runner sends nothing then, as for a
   * host's home, and status says so (Opus review finding 6).
   */
  readonly homeConfigUnreadable?: string;
  readonly now?: number;
}): { readonly status: TelemetryStatus; readonly text: string } {
  const store = new TelemetryStore(options.configDir);
  const decided = currentDecision({ env: options.env, store, embedded: options.embedded });
  const homeBlocks =
    options.homeConfigUnreadable !== undefined && decided.reason !== "no-collector";
  const decision = homeBlocks
    ? { ...decided, enabled: false, reason: "unreadable" as const }
    : decided;
  const unreadableFile = homeBlocks
    ? options.homeConfigUnreadable
    : decision.reason === "unreadable"
      ? store.settingsFile
      : undefined;
  const read = store.read();
  const settings = read.ok ? read.settings : {};
  const queued = read.ok ? store.queued(options.now ?? Date.now()).length : 0;
  const status: TelemetryStatus = {
    enabled: decision.enabled,
    reason: decision.reason,
    askFirst: decision.askFirst,
    ...(settings.installId !== undefined ? { installId: settings.installId } : {}),
    ...(decision.endpoint !== undefined ? { endpoint: decision.endpoint } : {}),
    queued,
    ...(settings.noticeShownAt !== undefined ? { noticeShownAt: settings.noticeShownAt } : {}),
    settingsFile: store.settingsFile,
    ...(unreadableFile !== undefined ? { unreadableFile } : {}),
  };
  const lines = [
    statusLine({ ...decision, settingsFile: unreadableFile ?? store.settingsFile }),
    ...(status.installId !== undefined ? [`Install ID: ${status.installId}`] : []),
    `Queued events: ${queued}`,
    `Settings: ${store.settingsFile}`,
  ];
  return { status, text: lines.join("\n") };
}
