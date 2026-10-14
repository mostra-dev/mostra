---
"@mostra/protocol": minor
---

Add the dependency surface (D43, D95): the host method `deps/add` with `AddedPackage`, which
installs npm packages into the home's store and records them in an artifact's lockfile; the
`dependencies` field of `HomeConfig` with `DependencyPolicy` (`auto` or `explicit`); and the DEP
diagnostic codes `MOSTRA_DEP_MISSING`, `_NOT_FOUND`, `_OFFLINE`, `_TIMEOUT`, `_INSTALL_FAILED`,
`_WARM_CONFLICT` and `_SPEC_INVALID`.
