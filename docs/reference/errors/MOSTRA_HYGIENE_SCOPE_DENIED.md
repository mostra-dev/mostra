---
code: MOSTRA_HYGIENE_SCOPE_DENIED
severity: error
phase: hygiene
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_HYGIENE_SCOPE_DENIED

Not allowed by this link. Severity: error. Phase: hygiene.

## What it means

The session's link doesn't carry the scope this request needs: `draft` to save answers, `submit` to submit, `review` to comment, and `action:*`, `action:<export>` or `action:<module path>#<export>` to run a server function. A view-and-comment link, for example, can't submit or run an action. The gateway answers 403.

## How to fix it

Mint a link with the scopes the viewer needs, such as `view/url` with `scopes: ["view", "draft", "submit"]`. Without `scopes`, a link carries every scope.

## Hint

Open a link minted with this scope (`view/url` with `scopes`).
