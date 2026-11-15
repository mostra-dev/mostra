---
"@mostra/react": patch
---

`usePresence`: a hook whose options change (a page that stops sharing its cursor) leaves and joins again at once, as two requests; when the join reached the gateway first, the gateway dropped the older leave and kept the cursor the page had shared, so the others kept seeing it. A join after a leave now states everything the page shares, `null` included, whatever order the two arrive in (#162).
