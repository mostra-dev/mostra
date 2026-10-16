/**
 * Diagnostic codes of the ACTION area.
 */
import type { AreaCatalog } from "../spec.ts";

/** The codes of the ACTION area, in the order they were added. */
export const actionDiagnosticCodes = [
  "MOSTRA_ACTION_EXPORT_INVALID",
  "MOSTRA_ACTION_UNSERIALIZABLE",
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
  // gen:entries
};
