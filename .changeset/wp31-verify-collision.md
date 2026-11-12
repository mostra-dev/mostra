---
"@mostra/protocol": patch
"@mostra/verify": patch
"@mostra/runtime": patch
---

`verify` renders a page once more, in a fresh browser context, when one of the page's requests failed because the browser itself couldn't make the connection (`net::ERR_NO_BUFFER_SPACE`, Chromium's random local port colliding on Windows, #132), so a collision never becomes a failed-request error the artifact didn't cause. The second render's findings are the verdict's, and the supervisor's log records the second render.
