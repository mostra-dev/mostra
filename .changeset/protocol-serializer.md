---
"@mostra/protocol": minor
---

Add the server-function serializer (`ValueWriter`, `ValueReader`, `serializeAll`,
`deserializeAll`): React's documented Server Function types plus async iterable results, written as
JSON batches that stream promises and iterable items as they settle, with shared and cyclic objects
kept, and `MOSTRA_ACTION_UNSERIALIZABLE` naming where a value outside the type set is.
