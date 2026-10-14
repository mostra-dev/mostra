---
"@mostra/protocol": minor
---

Add the viewing surface (D97): the host methods `view/url`, `view/rotate` and `view/revoke` with
`CapabilityLink`; `CapabilityScope` (including `action:*`), `Duration` and the scope helpers;
`PublishReceipt.tokenId` beside its `url`; `GatewayStatus` in `instance/status`; the request checks every Mostra HTTP endpoint applies
(`checkRequest` and its helpers, D96); the shell ↔ artifact bridge (`connectBridge` with the
MCP Apps-shaped `ui/initialize`, `ui/notifications/initialized`, `ui/notifications/size-changed`
and `mostra/ready`); the HYGIENE diagnostic area; and `MOSTRA_ENV_PORT_TAKEN`,
`MOSTRA_ENV_BIND_FAILED`, `MOSTRA_ENV_SHELL_MISSING` and `MOSTRA_ARTIFACT_VERSION_NOT_FOUND`.
