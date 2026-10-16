---
"@mostra/react": minor
---

Add the client runtime (INTERFACES §2.3): `useField`, `useSubmit`, `useSubmitControl`,
`useSignal`, `useChoice`, `useViewer` and `useArtifact`, with optimistic saves debounced and
flushed on blur, `visibilitychange`, `pagehide` and before a submit, an IndexedDB journal that a
closed tab or an offline page replays in order, per-field conflicts with "keep mine" and "take
theirs", and convergence across tabs; a Claude-compatible `window.storage` backed by fields;
`@mostra/react/form`, react-hook-form on Mostra fields; `@mostra/react/router`, which mounts
`pages/` artifacts with the history their delivery target needs; `mountArtifact`; and
`MostraError`, whose `code` is the diagnostic code.
