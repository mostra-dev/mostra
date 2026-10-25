#!/usr/bin/env node
/**
 * `mostra-conformance-reference-host`: the TypeScript reference host (HO-05). A host built the way
 * the docs recommend, on `@mostra/sdk`, with a store that keeps each submission once by its
 * `deliveryId` (H-03), every port the SDK serves, and the harness shim the kit drives. It is the
 * model a TypeScript host copies, and the kit's own proof that its scenarios pass.
 *
 *   mostra-conformance-reference-host                 every port
 *   mostra-conformance-reference-host --standalone    no port: Mostra's built-in adapters
 *   mostra-conformance-reference-host --unscripted    every port, without the `faults` feature:
 *     its policy allows both channels and it names people by its own IDs (`user-1` …), so the
 *     kit judges it by the answers it reports, as it must any host that can't be scripted
 *   mostra-conformance-reference-host --break <fault,…>   a deliberately broken host:
 *     store-duplicates       stores every delivery call, so a redelivery is stored twice
 *     drafts-as-submissions  takes draft mirrors for submissions
 *     ignore-policy          allows both channels whatever the kit scripted
 *
 * Its own runtime is found like any SDK host's (`MOSTRA_BUNDLE`, `MOSTRA_RUNTIME_BIN`, the pinned
 * bundle, a development checkout).
 */
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import {
  type ArtifactSummary,
  type ControlsPolicy,
  createDiagnostic,
  type DraftMirror,
  hostMethods,
  type PortIdentityResolveParams,
  type PortSecretsGetParams,
  type PortTrustedControlsActivatedParams,
  RpcError,
  type SubmissionEnvelope,
  type SubmissionsDeliverResult,
} from "@mostra/protocol";
import { createMostra, type Mostra, type Ports } from "@mostra/sdk";
import type {
  EventsParams,
  EventsResult,
  ScriptParams,
  StartParams,
  StartResult,
  StoredDelivery,
  StoreResult,
} from "./harness/protocol.ts";
import { serveHarness } from "./harness/serve.ts";
import { kitVersion } from "./version.ts";

/** The faults a broken reference host can carry. */
export const REFERENCE_FAULTS: readonly string[] = [
  "store-duplicates",
  "drafts-as-submissions",
  "ignore-policy",
];

/** The reference host's store and port answers: what a real host keeps in its own database. */
export class ReferenceStore {
  readonly #deliveries = new Map<string, StoredDelivery & { attempts: number[] }>();
  readonly #drafts: StoreResult["drafts"][number][] = [];
  readonly #activations: StoreResult["activations"][number][] = [];
  readonly #identity: StoreResult["identity"][number][] = [];
  readonly #policies: StoreResult["policies"][number][] = [];
  readonly #secrets: StoreResult["secrets"][number][] = [];
  readonly #faults: ReadonlySet<string>;
  #order = 0;
  /** How the scripted ports answer (feature `faults`). */
  #deliver: Extract<ScriptParams, { port: "submissions" }>["answer"] = "accept";
  #policy: Extract<ScriptParams, { port: "trustedControls" }>["answer"] = {
    submitChannels: ["shell"],
    controls: ["submit", "choose", "approve"],
  };
  #person: Extract<ScriptParams, { port: "identity" }>["answer"] = "headers";
  #secretValues: Readonly<Record<string, string>> = {};

  /** People by the header that named them, for an unscripted host's own IDs. */
  readonly #people = new Map<string, string>();
  readonly #unscripted: boolean;

  constructor(faults: ReadonlySet<string> = new Set(), unscripted = false) {
    this.#faults = faults;
    this.#unscripted = unscripted;
    if (unscripted) this.#policy = { submitChannels: ["artifact", "shell"] };
  }

  /** Sets how a port answers from now on (feature `faults`). */
  script(params: ScriptParams): void {
    if (params.port === "submissions") this.#deliver = params.answer;
    else if (params.port === "trustedControls") this.#policy = params.answer;
    else if (params.port === "identity") this.#person = params.answer;
    else this.#secretValues = params.answer;
  }

  /** Records one delivery the way a host's database would: once per `deliveryId`. */
  #record(envelope: SubmissionEnvelope | (DraftMirror & { kind: string })): void {
    const id =
      "deliveryId" in envelope
        ? envelope.deliveryId
        : `draft-${envelope.viewerId}-${envelope.revision}`;
    const existing = this.#deliveries.get(id);
    const attempt = "attempt" in envelope ? envelope.attempt : 1;
    if (existing) {
      existing.attempts.push(attempt);
      (existing as { calls: number }).calls += 1;
      if (this.#faults.has("store-duplicates")) (existing as { stored: number }).stored += 1;
      return;
    }
    const results = "results" in envelope ? envelope.results : undefined;
    this.#order += 1;
    this.#deliveries.set(id, {
      deliveryId: id,
      submissionId: results?.submission.id ?? "",
      artifactId: envelope.artifactId,
      calls: 1,
      stored: 1,
      attempts: [attempt],
      kind: envelope.kind,
      channel: results?.submission.channel ?? "",
      viewerKind: results?.submission.viewer.kind ?? "",
      ...(results?.submission.viewer.ref !== undefined
        ? { viewerRef: results.submission.viewer.ref }
        : {}),
      order: this.#order,
    });
  }

  /** The ports, as the SDK takes them. */
  ports(): Ports {
    return {
      submissions: {
        deliver: async (envelope: SubmissionEnvelope): Promise<SubmissionsDeliverResult> => {
          const answer = this.#deliver;
          if (answer === "fail") throw new Error("the host's store is unavailable");
          if (answer === "hang") return new Promise(() => undefined);
          if (answer === "retry") return { accepted: false, reason: "busy", retry: true };
          if (answer === "undeliverable")
            return { accepted: false, reason: "undeliverable", retry: false };
          if (answer === "reject") return { accepted: false, reason: "invalid", retry: false };
          // A redelivery of a delivery the store holds is accepted again, never stored twice.
          this.#record(envelope);
          return { accepted: true };
        },
      },
      drafts: {
        mirror: (draft: DraftMirror) => {
          this.#drafts.push({
            artifactId: draft.artifactId,
            viewerId: draft.viewerId,
            revision: draft.revision,
            kind: draft.kind,
          });
          if (this.#faults.has("drafts-as-submissions")) this.#record(draft);
        },
      },
      identity: {
        resolve: async (request: PortIdentityResolveParams) => {
          const call = {
            artifactId: request.artifactId,
            via: request.via,
            headers: Object.keys(request.headers).sort(),
          };
          const answer = this.#person;
          if (answer === "fail" || answer === "hang") {
            this.#identity.push(call);
            if (answer === "fail") throw new Error("the host's directory is unavailable");
            return new Promise<never>(() => undefined);
          }
          let person: { ref: string; name?: string } | null = answer === "headers" ? null : answer;
          if (answer === "headers") {
            const user = request.headers["x-forwarded-user"];
            if (user && this.#unscripted && !this.#people.has(user)) {
              this.#people.set(user, `user-${this.#people.size + 1}`);
            }
            const ref = user && this.#unscripted ? this.#people.get(user) : user;
            person = user && ref ? { ref, name: user.split("@")[0] ?? user } : null;
          }
          this.#identity.push({ ...call, answer: person });
          return person;
        },
      },
      trustedControls: {
        policy: async (artifact: ArtifactSummary): Promise<ControlsPolicy> => {
          const answer = this.#policy;
          if (this.#faults.has("ignore-policy")) {
            const both: ControlsPolicy = { submitChannels: ["shell", "artifact"] };
            this.#policies.push({ artifactId: artifact.id, answer: both });
            return both;
          }
          if (answer === "fail" || answer === "hang") {
            this.#policies.push({ artifactId: artifact.id });
            if (answer === "fail") throw new Error("the host's policy service is unavailable");
            return new Promise<never>(() => undefined);
          }
          this.#policies.push({ artifactId: artifact.id, answer: answer as ControlsPolicy });
          return answer as ControlsPolicy;
        },
        activated: (event: PortTrustedControlsActivatedParams) => {
          this.#activations.push({
            artifactId: event.artifactId,
            control: event.control,
            viewId: event.viewId,
          });
        },
      },
      secrets: {
        get: (request: PortSecretsGetParams) => {
          this.#secrets.push({ artifactId: request.artifactId, name: request.name });
          return this.#secretValues[request.name] ?? null;
        },
      },
    };
  }

  /** What the store holds now. */
  snapshot(): StoreResult {
    return {
      deliveries: [...this.#deliveries.values()].sort((a, b) => a.order - b.order),
      drafts: [...this.#drafts],
      activations: [...this.#activations],
      identity: [...this.#identity],
      policies: [...this.#policies],
      secrets: [...this.#secrets],
    };
  }
}

/** Runs the reference host's harness on stdio. */
export async function runReferenceHost(
  options: { standalone?: boolean; unscripted?: boolean; faults?: readonly string[] } = {},
): Promise<void> {
  const faults = new Set(options.faults ?? []);
  const unscripted = options.unscripted ?? false;
  const store = new ReferenceStore(faults, unscripted);
  let mostra: Mostra | undefined;
  const ports = options.standalone ? {} : store.ports();
  const portNames = Object.keys(ports);
  const name = options.standalone
    ? "reference-host-ts-standalone"
    : unscripted
      ? "reference-host-ts-unscripted"
      : faults.size > 0
        ? "reference-host-ts-broken"
        : "reference-host-ts";
  await serveHarness({
    initialize: () => ({
      host: { name, version: kitVersion() },
      ports: portNames,
      features: options.standalone || unscripted ? ["events"] : ["faults", "events"],
    }),
    async start(params: StartParams): Promise<StartResult> {
      if (params.mode === "attach") {
        throw new RpcError(
          createDiagnostic("MOSTRA_HOST_INVALID_PARAMS", {
            message: "The TypeScript reference host spawns its instance; it doesn't attach.",
          }),
        );
      }
      await mostra?.close();
      mostra = await createMostra({
        home: params.home,
        client: { name, version: kitVersion() },
        ports,
        env: { ...process.env, ...params.env },
        onLog: () => undefined,
      });
      return {
        revision: mostra.revision,
        instance: mostra.instance,
        warnings: mostra.warnings,
      };
    },
    async call(method: string, params: unknown, timeoutMs?: number) {
      const definition = hostMethods.find((candidate) => candidate.method === method);
      if (!mostra) {
        throw new RpcError(
          createDiagnostic("MOSTRA_HOST_CONNECTION_CLOSED", { message: "No instance runs." }),
        );
      }
      if (!definition) {
        throw new RpcError(
          createDiagnostic("MOSTRA_HOST_METHOD_UNKNOWN", { message: `No method ${method}.` }),
          -32601,
        );
      }
      return mostra.call(definition, params, timeoutMs !== undefined ? { timeoutMs } : {});
    },
    async stop() {
      const current = mostra;
      mostra = undefined;
      await current?.close();
    },
    store: () => store.snapshot(),
    ...(options.standalone || unscripted
      ? {}
      : { script: (params: ScriptParams) => store.script(params) }),
    async events(params: EventsParams): Promise<EventsResult> {
      if (!mostra) throw new Error("No instance runs.");
      const pages: EventsResult["pages"][number][] = [];
      const stream = mostra
        .events({
          name: params.name,
          filter: {
            ...(params.filter.artifacts ? { artifacts: [...params.filter.artifacts] } : {}),
            ...(params.filter.types ? { types: [...params.filter.types] } : {}),
          },
        })
        [Symbol.asyncIterator]();
      const deadline = Date.now() + params.timeoutMs;
      try {
        while (pages.length < params.pages) {
          const left = deadline - Date.now();
          if (left <= 0) break;
          const next = await Promise.race([
            stream.next(),
            new Promise<"timeout">((done) => setTimeout(() => done("timeout"), left)),
          ]);
          if (next === "timeout" || next.done) break;
          pages.push({
            cursor: next.value.cursor,
            events: next.value.events.map((event) => ({ ...event })),
          });
        }
      } finally {
        // Asking for the next page is what tells the SDK the last one was handled: it acknowledges
        // it at once, then waits for a page this stream won't read, so the wait is cut short.
        await Promise.race([
          stream.next().catch(() => undefined),
          new Promise((done) => setTimeout(done, 1000)),
        ]);
        await stream.return?.();
      }
      return { pages };
    },
  });
}

/**
 * Whether this module is the program Node.js was started with: by file URL, which spells a
 * Windows path (`file:///D:/…`) as no string concatenation does, through any link, or as the
 * installed binary (`mostra-conformance-reference-host`, a link or npm's shim to `dist/`).
 */
function isMain(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    if (pathToFileURL(realpathSync(entry)).href === import.meta.url) return true;
  } catch {
    // An entry that doesn't exist as a file is judged by its name alone.
  }
  return entry.endsWith("reference-host.js");
}

if (isMain()) {
  const { values } = parseArgs({
    options: {
      standalone: { type: "boolean" },
      unscripted: { type: "boolean" },
      break: { type: "string" },
    },
    strict: true,
  });
  const faults = values.break ? values.break.split(",").filter(Boolean) : [];
  for (const fault of faults) {
    if (!REFERENCE_FAULTS.includes(fault)) {
      process.stderr.write(`Unknown fault ${fault}; known: ${REFERENCE_FAULTS.join(", ")}\n`);
      process.exit(2);
    }
  }
  void runReferenceHost({
    standalone: values.standalone ?? false,
    unscripted: values.unscripted ?? false,
    faults,
  }).then(() => process.exit(0));
}
