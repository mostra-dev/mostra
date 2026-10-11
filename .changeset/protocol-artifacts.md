---
"@mostra/protocol": minor
---

Add the artifact manifest (`ArtifactManifest`, `SubmissionPolicy`, `ArtifactLink`), the authoring
methods `artifact/create`, `artifact/publish`, `artifact/list` and `artifact/get` with
`SourceRef`, `ArtifactRef`, `ArtifactSummary`, `ArtifactDetail`, `VersionSummary` and
`PublishReceipt` (whose `url` is optional until the gateway serves views), the `ARTIFACT`
diagnostic area, and the MANIFEST, BUILD, ACTION, PUBLISH, ARTIFACT, TARGET and ENV codes builds
and publishes report.
