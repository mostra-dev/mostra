/**
 * Diagnostic codes of the ACTION area.
 */
import type { AreaCatalog } from "../spec.ts";

/** The codes of the ACTION area, in the order they were added. */
export const actionDiagnosticCodes = [
  "MOSTRA_ACTION_EXPORT_INVALID",
  "MOSTRA_ACTION_UNSERIALIZABLE",
  "MOSTRA_ACTION_THREW",
  "MOSTRA_ACTION_UNKNOWN_FUNCTION",
  "MOSTRA_ACTION_INTERRUPTED",
  "MOSTRA_ACTION_CANCELLED",
  "MOSTRA_ACTION_TOO_LARGE",
  "MOSTRA_ACTION_RUN_NOT_FOUND",
  "MOSTRA_ACTION_EVENT_INVALID",
  // gen:codes
] as const;

/** The codes of the ACTION area. */
export type ActionDiagnosticCode = (typeof actionDiagnosticCodes)[number];

/** The ACTION area's catalog entries. */
export const actionDiagnostics: AreaCatalog<ActionDiagnosticCode> = {
  MOSTRA_ACTION_EXPORT_INVALID: {
    severity: "error",
    phase: "compile",
    title: "Server module exports something other than an async function",
    hint: 'Export only async functions from a "use server" module; move other exports to an ordinary module.',
    docs: {
      explanation:
        'A module that starts with `"use server"` makes every export a server function the page can call. React\'s contract allows only async functions there. Mostra reports this code for any other export (a constant, a class, a non-async function, `export *`), naming the export.',
      fix: "Make the function `async`, or move the value to a separate module without the directive and import it from both sides.",
    },
  },
  MOSTRA_ACTION_UNSERIALIZABLE: {
    severity: "error",
    phase: "runtime",
    title: "Server function argument or result outside React's serializable types",
    hint: "Pass and return only plain objects, arrays, primitives, Map, Set, Date, typed arrays, FormData and promises; convert class instances to plain objects first.",
    docs: {
      explanation:
        "Server function arguments and results cross a process boundary, so Mostra accepts exactly the types React documents for Server Functions (D54): strings, numbers, bigints, booleans, `undefined`, `null`, symbols registered with `Symbol.for`, arrays, `Map`, `Set`, typed arrays, `ArrayBuffer`, `Date`, `FormData`, plain objects, other server functions and promises. A result may also be an async iterable, whose items stream to the page. Mostra reports this code for anything else (a class instance, an `Error`, a `RegExp`, an object with a null prototype, a function that isn't a server function, an unregistered symbol, JSX) and names where in the value it is, such as `Argument 2 at .items[1]`. A promise in an argument that rejects fails the call the same way.",
      fix: "Convert the value to the supported types before the call or the return: `{ ...instance }` or a mapping for class instances, `error.message` for errors and `regexp.source` for regular expressions.",
    },
  },
  MOSTRA_ACTION_THREW: {
    severity: "error",
    phase: "runtime",
    title: "Server function threw",
    hint: "Read the run's log for the stack, then fix the server function or catch the error and return a result instead.",
    docs: {
      explanation:
        "A server function threw while it ran. The page gets `{ code: \"MOSTRA_ACTION_THREW\", message }` with the thrown error's message (`useAction`'s `error`, or the rejected promise of a plain call); the stack goes to the action run's log, never to the page. When the error carried a diagnostic code of its own (a `MOSTRA_SECRET_MISSING`, say), that code is reported instead.",
      fix: "Fix the cause in the function, or catch the error inside it and return a value the page can show. Mostra never retries a run by itself (D24); retry in your own code, or call the action again with a new key.",
    },
  },
  MOSTRA_ACTION_UNKNOWN_FUNCTION: {
    severity: "error",
    phase: "runtime",
    title: "No such server function in this version",
    hint: "Publish the artifact again so the page and its server code come from the same version.",
    docs: {
      explanation:
        "The page called a server function ID (`<module path>#<export>`) that the version's server bundle doesn't export. Pages call only functions their own build references, so this means a page and a worker of different versions, or a request written by hand.",
      fix: 'Republish the artifact and reload the page. Call server functions by importing them from their `"use server"` module, never by ID.',
    },
  },
  MOSTRA_ACTION_INTERRUPTED: {
    severity: "error",
    phase: "runtime",
    title: "Action run interrupted",
    hint: "Check the run's effects at their provider, then start it again with a new key if it should run again.",
    docs: {
      explanation:
        "The action run's worker crashed, ran out of memory, was stopped by the event-loop watchdog, or the instance stopped while the run was running. The run ends `failed` with the reason `interrupted`, and Mostra never retries it by itself (D24): an action that had already started a side effect, such as sending an email, may or may not have finished it.",
      fix: "Look at the effect where it happens (the mail provider's sent folder, say) before running the action again. Pass the provider's own idempotency key from the action (for example, the run's key) so a repeated request can't act twice.",
    },
  },
  MOSTRA_ACTION_CANCELLED: {
    severity: "warning",
    phase: "runtime",
    title: "Action run cancelled",
    hint: "Start the action again if it should still run.",
    docs: {
      explanation:
        "The action run was cancelled from a page, and its `abortSignal` fired. The run ends `cancelled` when the action stops; an action that ignores the signal ends with whatever it returns.",
      fix: "Nothing to fix. Pass `abortSignal` from `@mostra/server` to `fetch` and other cancellable calls so cancelling stops the work.",
    },
  },
  MOSTRA_ACTION_TOO_LARGE: {
    severity: "error",
    phase: "runtime",
    title: "Server function arguments or result too large",
    hint: "Return or pass less data: page through it, or write it to artifact state or a live source instead.",
    docs: {
      explanation:
        "A server function's serialized arguments, or an action run's serialized result, is over 16 MiB. A plain call or run with arguments that large is refused before it starts; a run whose result grows past the limit is stopped and ends `failed`.",
      fix: "Send identifiers rather than whole documents, return a page of results at a time, or publish large data through a live source or artifact state, which the page reads on its own.",
    },
  },
  MOSTRA_ACTION_RUN_NOT_FOUND: {
    severity: "error",
    phase: "runtime",
    title: "No such action run",
    hint: "Start the action again; the run ID names no run of this artifact.",
    docs: {
      explanation:
        "A page asked for or cancelled an action run that this artifact doesn't have, or one started from another artifact.",
      fix: "Use the run IDs `useAction` reports. A page that keeps run IDs itself should drop IDs from other artifacts.",
    },
  },
  MOSTRA_ACTION_EVENT_INVALID: {
    severity: "error",
    phase: "runtime",
    title: "Host event type or payload invalid",
    hint: "Name the event `host.<name>` with 1 to 64 letters, digits, `.`, `_` and `-`, and keep its payload JSON of at most 64 KiB.",
    docs: {
      explanation:
        "Server code called `emit(type, payload)` from `@mostra/server` with a type that isn't `host.` followed by a name, or a payload that isn't JSON or is larger than 64 KiB. The event is not appended; `emit` throws.",
      fix: "Use a type such as `host.reply-sent` and a small JSON payload. Put larger data in artifact state or a live source and send its key in the event.",
    },
  },
  // gen:entries
};
