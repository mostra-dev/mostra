---
"@mostra/kit": minor
"@mostra/react": patch
"@mostra/runtime": minor
---

The kit draws data that keeps arriving: `@mostra/kit/live-chart` (`LiveChart`, uPlot over a live source in append mode or the page's own points, in the theme's series colours) and `@mostra/kit/tokens` (`useTokens`, the page's theme as resolved colours a canvas library can take, kept current with its light or dark). A live source in append mode costs the page constant time per value. A page keeps its interest in its live sources on a slow device: it renews it 20 seconds after each read goes out, its stream's messages renew it when its timers run late, and a ring it already holds is renewed by its latest value alone instead of being read again whole. A kit module's on-demand libraries install with the artifact at the versions the kit pins.
