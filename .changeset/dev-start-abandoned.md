---
"@mostra/runtime": patch
---

A `mostra dev` session whose connection closes while it starts no longer takes the instance down: the start stops the dev server it was starting before it removes the session's directory, and a cleanup that fails is reported, never an uncaught error (#35). An instance that does stop on an uncaught error now records the error and where it was thrown in the home's log.
