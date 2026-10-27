---
"@mostra/protocol": patch
---

`@mostra/protocol` declares Node.js 22.19 or later, as the CLI, the SDK, `create-mostra` and the conformance kit that depend on it do, so npm on Node.js 22 no longer warns `EBADENGINE` when it installs them (#92). Nothing else changes: the protocol package already ran there.
