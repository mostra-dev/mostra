---
"@mostra/sdk": minor
"@mostra/conformance": minor
---

The review ports (HO-11): `createMostra({ ports: { reviews, capture } })` mirrors each review thread and choice into the host's store and supplies the screenshots comments' crops are cut from; the Rust crate has the `Reviews` and `Capture` traits. The conformance kit adds `ports.reviews` and `ports.capture`, and `harness/store` reports `reviews` and `captures`.
