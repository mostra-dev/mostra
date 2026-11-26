---
"@mostra/kit": minor
"@mostra/react": patch
"@mostra/runtime": minor
---

The kit draws data that keeps arriving: `@mostra/kit/live-chart` (`LiveChart`, uPlot over a live source in append mode or the page's own points, in the theme's series colours) and `@mostra/kit/tokens` (`useTokens`, the page's theme as resolved colours a canvas library can take, kept current with its light or dark). A live source in append mode costs the page constant time per value. A kit module's on-demand libraries install with the artifact at the versions the kit pins.
