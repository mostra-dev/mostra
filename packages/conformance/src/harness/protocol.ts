/**
 * The conformance harness protocol (D143 item 3): how the kit drives a host under test. A host
 * ships a small shim, a program the kit starts, that speaks JSON-RPC 2.0 over its stdin and
 * stdout (one message per line, as the host protocol does) and answers these methods with its
 * real integration: its own client, its own ports, its own store. Any language can implement it;
 * TypeScript hosts get `serveHarness`, and the Rust reference host shows it in Rust.
 *
 * | Method | What the host does |
 * |---|---|
 * | `harness/initialize` | names itself, the ports it serves and the features it supports |
 * | `harness/start` | starts (spawns or attaches to) its Mostra instance for a home, with its ports |
 * | `harness/call` | sends one host-protocol request through its own client and returns the answer |
 * | `harness/stop` | ends its session (a spawned instance exits) |
 * | `harness/store` | reports what its own store holds: deliveries, mirrors, activations, calls |
 * | `harness/script` | (feature `faults`) answers a port the way the kit asks |
 * | `harness/events` | (feature `events`) reads pages from its own named event stream |
 *
 * Within a revision the protocol changes only additively, like the host protocol (D32).
 */
import * as z from "zod";

/** The harness protocol revisions this kit speaks, newest last. */
export const HARNESS_REVISIONS: readonly string[] = ["2026-10-21"];

/** The harness methods by name. */
export const HARNESS_METHODS: {
  readonly initialize: "harness/initialize";
  readonly start: "harness/start";
  readonly call: "harness/call";
  readonly stop: "harness/stop";
  readonly store: "harness/store";
  readonly script: "harness/script";
  readonly events: "harness/events";
} = {
  initialize: "harness/initialize",
  start: "harness/start",
  call: "harness/call",
  stop: "harness/stop",
  store: "harness/store",
  script: "harness/script",
  events: "harness/events",
};

/**
 * What a host can do beyond the required methods: `attach` (`harness/start` with
 * `mode: "attach"`), `faults` (`harness/script`, for reference and test hosts) and `events`
 * (`harness/events`). Unknown features are ignored.
 */
export type HarnessFeature = "attach" | "faults" | "events" | (string & {});

/** `harness/initialize`'s params. */
export interface InitializeParams {
  /** The harness protocol revision. */
  readonly revision: string;
  /** The kit that drives the host. */
  readonly kit: { readonly name: string; readonly version: string };
}

/** `harness/initialize`'s result. */
export interface InitializeResult {
  /** The harness protocol revision. */
  readonly revision: string;
  /** The host: its name and version. */
  readonly host: { readonly name: string; readonly version: string };
  /** The ports the host registers in `mostra/initialize`. */
  readonly ports: readonly string[];
  /** The harness features the host supports. */
  readonly features: readonly HarnessFeature[];
}

/** The schema of `InitializeResult`. */
export const InitializeResult: z.ZodType<InitializeResult> = z.object({
  revision: z.string(),
  host: z.object({ name: z.string(), version: z.string() }),
  ports: z.array(z.string()),
  features: z.array(z.string()),
});

/** `harness/start`'s params. */
export interface StartParams {
  /** The home the host must use: its own choice in production (HO-08), the kit's in a run. */
  readonly home: string;
  /** Variables the host adds to its instance's environment (test switches, fault points). */
  readonly env: Readonly<Record<string, string>>;
  /** Spawn an instance over stdio (default) or attach to the home's daemon (feature `attach`). */
  readonly mode?: "spawn" | "attach";
}

/** The schema of `StartParams`. */
export const StartParams: z.ZodType<StartParams> = z.object({
  home: z.string(),
  env: z.record(z.string(), z.string()),
  mode: z.enum(["spawn", "attach"]).exactOptional(),
});

/** `harness/start`'s result: what `mostra/initialize` answered the host. */
export interface StartResult {
  /** The harness protocol revision. */
  readonly revision: string;
  /** The instance the host's session reached: its home, mode, PID, release and platform. */
  readonly instance: {
    readonly home: string;
    readonly mode: string;
    readonly pid: number;
    readonly version: string;
    readonly platform: string;
  };
  /** The session's warnings, such as an unsupported port. */
  readonly warnings: readonly { readonly code: string }[];
}

/** The schema of `StartResult`. */
export const StartResult: z.ZodType<StartResult> = z.object({
  revision: z.string(),
  instance: z.object({
    home: z.string(),
    mode: z.string(),
    pid: z.number(),
    version: z.string(),
    platform: z.string(),
  }),
  warnings: z.array(z.looseObject({ code: z.string() })),
});

/** `harness/call`'s params: one host-protocol request. */
export interface CallParams {
  /** The host-protocol method. */
  readonly method: string;
  /** Its params. */
  readonly params: unknown;
  /** How long the host waits for the answer, in milliseconds. */
  readonly timeoutMs?: number;
}

/** The schema of `CallParams`. */
export const CallParams: z.ZodType<CallParams> = z.object({
  method: z.string(),
  params: z.unknown(),
  timeoutMs: z.number().exactOptional(),
});

/** An instance's error as the host received it: the JSON-RPC code and the diagnostic. */
export interface CallError {
  /** The diagnostic code (`MOSTRA_…`). */
  readonly code: number;
  /** The diagnostic as it arrived. */
  readonly data: { readonly code: string; readonly message?: string } & Record<string, unknown>;
}

/** `harness/call`'s result: the answer, or the instance's error as it arrived. */
export type CallResult = { readonly result: unknown } | { readonly error: CallError };

/** The schema of `CallResult`. */
export const CallResult: z.ZodType<CallResult> = z.union([
  z.object({ error: z.object({ code: z.number(), data: z.looseObject({ code: z.string() }) }) }),
  z.object({ result: z.unknown() }),
]) as z.ZodType<CallResult>;

/** One delivery the host's submissions port received, as its store records it. */
export interface StoredDelivery {
  /** The delivery's stable ID (`dlv_…`). */
  readonly deliveryId: string;
  /** The submission it delivers. */
  readonly submissionId: string;
  /** The artifact. */
  readonly artifactId: string;
  /** How many times the port was called with this delivery. */
  readonly calls: number;
  /** How many copies the host's store holds: one for a conformant host (H-03). */
  readonly stored: number;
  /** The attempt numbers it saw, in order. */
  readonly attempts: readonly number[];
  /** `envelope.kind` as received. */
  readonly kind: string;
  /** `results.submission.channel`, `.viewer.kind` and `.viewer.ref`. */
  readonly channel: string;
  /** `results.submission.viewer.kind`. */
  readonly viewerKind: string;
  /** `results.submission.viewer.ref`, when the viewer has one. */
  readonly viewerRef?: string;
  /** The order the host stored it in, from 1. */
  readonly order: number;
}

/** What the host's own store and port handlers saw. */
export interface StoreResult {
  /** The deliveries the host's store holds, in the order it stored them. */
  readonly deliveries: readonly StoredDelivery[];
  /** Draft mirrors, in arrival order. */
  readonly drafts: readonly {
    readonly artifactId: string;
    readonly viewerId: string;
    readonly revision: string;
    readonly kind: string;
  }[];
  /** `trustedControls.activated` calls, in arrival order. */
  readonly activations: readonly {
    readonly artifactId: string;
    readonly control: string;
    readonly viewId: string;
  }[];
  /** `identity.resolve` calls: the artifact, how the request arrived and the header names. */
  readonly identity: readonly {
    readonly artifactId: string;
    readonly via: string;
    readonly headers: readonly string[];
  }[];
  /** `trustedControls.policy` calls. */
  readonly policies: readonly { readonly artifactId: string }[];
  /** `secrets.get` calls. */
  readonly secrets: readonly { readonly artifactId: string; readonly name: string }[];
}

/** The schema of `StoreResult`. */
export const StoreResult: z.ZodType<StoreResult> = z.object({
  deliveries: z.array(
    z.object({
      deliveryId: z.string(),
      submissionId: z.string(),
      artifactId: z.string(),
      calls: z.number(),
      stored: z.number(),
      attempts: z.array(z.number()),
      kind: z.string(),
      channel: z.string(),
      viewerKind: z.string(),
      viewerRef: z.string().optional(),
      order: z.number(),
    }),
  ),
  drafts: z.array(
    z.object({
      artifactId: z.string(),
      viewerId: z.string(),
      revision: z.string(),
      kind: z.string(),
    }),
  ),
  activations: z.array(
    z.object({ artifactId: z.string(), control: z.string(), viewId: z.string() }),
  ),
  identity: z.array(
    z.object({ artifactId: z.string(), via: z.string(), headers: z.array(z.string()) }),
  ),
  policies: z.array(z.object({ artifactId: z.string() })),
  secrets: z.array(z.object({ artifactId: z.string(), name: z.string() })),
}) as z.ZodType<StoreResult>;

/** How a scripted port answers from now on (feature `faults`). */
export type ScriptParams =
  | {
      readonly port: "submissions";
      readonly answer: "accept" | "retry" | "undeliverable" | "reject" | "fail" | "hang";
    }
  | {
      readonly port: "trustedControls";
      readonly answer:
        | "fail"
        | "hang"
        | {
            readonly submitChannels: readonly string[];
            readonly controls?: readonly string[];
          };
    }
  | {
      readonly port: "identity";
      /** `headers`: the person named by `x-forwarded-user`, else none. */
      readonly answer:
        | "fail"
        | "hang"
        | "headers"
        | null
        | { readonly ref: string; readonly name?: string };
    }
  | { readonly port: "secrets"; readonly answer: Readonly<Record<string, string>> };

/** The schema of `ScriptParams`. */
export const ScriptParams: z.ZodType<ScriptParams> = z.union([
  z.object({
    port: z.literal("submissions"),
    answer: z.enum(["accept", "retry", "undeliverable", "reject", "fail", "hang"]),
  }),
  z.object({
    port: z.literal("trustedControls"),
    answer: z.union([
      z.literal("fail"),
      z.literal("hang"),
      z.object({
        submitChannels: z.array(z.string()),
        controls: z.array(z.string()).optional(),
      }),
    ]),
  }),
  z.object({
    port: z.literal("identity"),
    answer: z.union([
      z.literal("fail"),
      z.literal("hang"),
      z.literal("headers"),
      z.null(),
      z.object({ ref: z.string(), name: z.string().optional() }),
    ]),
  }),
  z.object({ port: z.literal("secrets"), answer: z.record(z.string(), z.string()) }),
]) as z.ZodType<ScriptParams>;

/** `harness/events`'s params: read pages from the host's own named stream (feature `events`). */
export interface EventsParams {
  /** The subscriber name: the stream resumes after what this name acknowledged. */
  readonly name: string;
  /** The events filter. */
  readonly filter: { readonly artifacts?: readonly string[]; readonly types?: readonly string[] };
  /** Stop after this many pages, or when `timeoutMs` passes. */
  readonly pages: number;
  /** How long the host waits for the answer, in milliseconds. */
  readonly timeoutMs: number;
}

/** The schema of `EventsParams`. */
export const EventsParams: z.ZodType<EventsParams> = z.object({
  name: z.string(),
  filter: z.object({
    artifacts: z.array(z.string()).optional(),
    types: z.array(z.string()).optional(),
  }),
  pages: z.number(),
  timeoutMs: z.number(),
}) as z.ZodType<EventsParams>;

/** `harness/events`'s result: the pages read, every one handled and acknowledged. */
export interface EventsResult {
  /** The pages read, in cursor order. */
  readonly pages: readonly {
    readonly cursor: string;
    readonly events: readonly ({ readonly cursor: string; readonly type: string } & Record<
      string,
      unknown
    >)[];
  }[];
}

/** The schema of `EventsResult`. */
export const EventsResult: z.ZodType<EventsResult> = z.object({
  pages: z.array(
    z.object({
      cursor: z.string(),
      events: z.array(z.looseObject({ cursor: z.string(), type: z.string() })),
    }),
  ),
}) as z.ZodType<EventsResult>;
