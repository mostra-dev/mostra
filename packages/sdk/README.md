# @mostra/sdk

Embed Mostra in a JavaScript host. `createMostra` starts your own Mostra instance for a home you
choose, serves the ports you implement, and gives you the calls a host makes: publish, verify,
wait, results, artifact state, live values, links and events.

```ts
import { createMostra } from "@mostra/sdk";

const mostra = await createMostra({
  home: "/var/lib/inbox/mostra",
  client: { name: "inbox-app", version: "1.4.0" },
  ports: {
    submissions: {
      async deliver(envelope) {
        await db.saveOnce(envelope.submissionId, envelope.results);
        return { accepted: true };
      },
    },
  },
});

const receipt = await mostra.publish("/work/inbox");
console.log(receipt.url);
const outcome = await mostra.wait(receipt.artifactId, "submitted");
const results = await mostra.results(receipt.artifactId);
await mostra.close();
```

The first call downloads the runtime bundle this release pins (Node.js, Mostra's runtime and the
packages artifacts use), checks every file against its SHA-256, fetches the browser `verify` uses
and caches it all by digest. Later calls start at once, offline too. `MOSTRA_CACHE_DIR` moves the
cache, `MOSTRA_BUNDLE_MIRROR` fetches from a mirror, and `MOSTRA_BUNDLE` uses a bundle you
extracted yourself.

Embedded use never sends telemetry. Node.js 22.19 or later; macOS and Linux on x64 and arm64.

Part of [Mostra](https://github.com/mostra-dev/mostra), the agent artifact runtime. Apache-2.0.
