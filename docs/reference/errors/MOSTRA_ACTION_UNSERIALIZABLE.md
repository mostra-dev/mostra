---
code: MOSTRA_ACTION_UNSERIALIZABLE
severity: error
phase: runtime
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_ACTION_UNSERIALIZABLE

Server function argument or result outside React's serializable types. Severity: error. Phase: runtime.

## What it means

Server function arguments and results cross a process boundary, so Mostra accepts exactly the types React documents for Server Functions (D54): strings, numbers, bigints, booleans, `undefined`, `null`, symbols registered with `Symbol.for`, arrays, `Map`, `Set`, typed arrays, `ArrayBuffer`, `Date`, `FormData`, plain objects, other server functions and promises. A result may also be an async iterable, whose items stream to the page. Mostra reports this code for anything else (a class instance, an `Error`, a `RegExp`, an object with a null prototype, a function that isn't a server function, an unregistered symbol, JSX) and names where in the value it is, such as `Argument 2 at .items[1]`. A promise in an argument that rejects fails the call the same way.

## How to fix it

Convert the value to the supported types before the call or the return: `{ ...instance }` or a mapping for class instances, `error.message` for errors and `regexp.source` for regular expressions.

## Hint

Pass and return only plain objects, arrays, primitives, Map, Set, Date, typed arrays, FormData and promises; convert class instances to plain objects first.
