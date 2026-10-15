---
"@mostra/protocol": minor
---

Add what the client runtime and the shell's trusted controls speak (WP-07): the browser
protocol's view context (`ViewContext`, `FrameTicket`, `VersionRef`, `DeliveryTarget`) and the
shell's own routes (`ShellSubmitRequest`, `ChooseRequest`, `FollowRequest`, `CarryOver`,
`OrphanedField`); the bridge messages `mostra/fields`, `mostra/page`, `mostra/controls.request`,
`mostra/flush`, `mostra/version.available` and `mostra/field.focus`, with `ui/initialize`'s result
carrying the view as `mostra`; the `trustedControls` port methods
`port/trustedControls.policy` and `port/trustedControls.activated` with `ControlsPolicy`,
`SubmitChannel` and `TrustedControl`; `HomeConfig.submitChannels` (D108); each delivery's
`waiting` flag and the submit answer's `deliveries`; and the codes `MOSTRA_SUBMIT_CHANNEL_DENIED`
and `MOSTRA_SUBMIT_BLOCKED`.
