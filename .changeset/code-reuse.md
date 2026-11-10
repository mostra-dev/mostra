---
"@mostra/runtime": patch
---

An authorization code presented a second time revokes the grant its first presentation made, and a token request needs `redirect_uri` only when the authorization request named it (OAuth 2.1 §4.1.3).
