---
"@mostra/runtime": minor
---

Dependencies (D95): an artifact may import any npm package. Packages outside the warm set install
on demand through pnpm 10 into the home's shared, content-addressed store, in an install child that
runs in the artifact's directory with the artifact environment, and are linked into one layout per
lockfile whose peers resolve to the warm set's single React. Each artifact keeps a working lockfile
with exact pins, frozen into its version's `lock.yaml` and its `envDigest`, so a version rebuilds
offline from the store. `deps/add` adds packages; the `explicit` dependency policy refuses other
imports with `MOSTRA_DEP_MISSING`; offline requests for packages the store lacks fail at once with
`MOSTRA_DEP_OFFLINE`. The warm set gains the rest of the kit's libraries. A package's undeclared
dependency can no longer be taken from a `node_modules` above the home. `SpawnSpec.onStdout`
receives a child's output lines.
