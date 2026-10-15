---
"@mostra/protocol": minor
---

Add the interaction ledger's surface (WP-06): the host methods `state/get`, `state/patch`,
`results/get`, `wait`, `events/read`, `events/subscribe` (with the `events/notify`
notification), `events/unsubscribe` and `events/ack`; the port methods
`port/submissions.deliver` (`SubmissionEnvelope`) and `port/drafts.mirror` (`DraftMirror`); the
wire types `Viewer`, `ViewerSpec`, `Actor`, `FieldOp`, `FieldState`, `FieldConflict`,
`MutationResult`, `DocumentRevision`, `EventRecord`, `EventFilter`, `WaitCondition`,
`SubmissionSummary`, `DeliveryStatus` and `Results`; `DeliveryId` (`dlv_`); `canonicalJson`
(RFC 8785); browser-protocol revision `2026-10-15` with its request and stream payloads;
`HomeConfig.submission` and `HomeConfig.ports`; `view/url`'s `viewer` and `CapabilityLink.viewer`;
`instance/status`'s `deliveries`; and the SUBMIT and FIELD diagnostic areas with
`MOSTRA_HOST_CURSOR_COMPACTED`, `MOSTRA_HOST_SUBSCRIPTION_UNKNOWN`,
`MOSTRA_HOST_NOTIFICATION_UNSUPPORTED` and `MOSTRA_HOST_MESSAGE_TOO_LARGE`; `events/read`'s
`acceptCompacted` and `compacted`, `events/notify`'s `compacted`, `Results.signalsOmitted` and
`signalsCompacted`, and `MAX_LINE_LENGTH`.
