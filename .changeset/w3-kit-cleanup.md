---
"@mostra/conformance": patch
"@mostra/sdk": patch
---

On Windows the conformance kit removes each scenario's home after the run, sealed versions included: it resets their access lists through the runtime's helper, which `@mostra/sdk` now exports as `windowsHelper` (the lookup every client uses), instead of leaving them in the temporary folder.
