---
"@mostra/protocol": minor
---

Add the `identity` port (`port/identity.resolve`, D143): a host names the person behind a link opened without a viewer, or answers `null` for Mostra's own default. `MOSTRA_HOST_IDENTITY_UNAVAILABLE` is new. The published JSON Schema bundles now list every method and notification (`x-mostra-methods`, `x-mostra-notifications`), which `hostNotifications` exports too.
