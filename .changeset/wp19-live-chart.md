---
"@mostra/kit": minor
"@mostra/react": patch
"@mostra/runtime": minor
---

The kit draws data that keeps arriving: `@mostra/kit/live-chart` (`LiveChart`, uPlot over a live source in append mode or the page's own points, in the theme's series colours) and `@mostra/kit/tokens` (`useTokens`, the page's theme as resolved colours a canvas library can take, kept current with its light or dark). A live source in append mode costs the page constant time per value. A slow device keeps up with a fast live source: applying a burst of values gives the page's event loop turns, the page renews its interest in its sources 20 seconds after each read even while it takes in a burst, and a ring it already holds is renewed by its newest value alone instead of being read again whole. The runtime stores a producer's burst of values in a few transactions rather than one for each value, so a burst no longer holds the instance up on a slow disk. A kit module's on-demand libraries install with the artifact at the versions the kit pins.
