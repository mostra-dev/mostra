# @mostra/contract-connector

The contract a connector implements, for [Mostra](https://github.com/mostra-dev/mostra) plugins: it reads (and optionally subscribes to and writes) an outside data source that live sources show. One of six extension contracts, each its own package with its own version (D30).

```sh
npm install @mostra/contract-connector
```

```ts
import { readFile } from "node:fs/promises";
import { defineConnector } from "@mostra/contract-connector";

export default defineConnector({
  id: "json-file",
  config: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
  async read({ config }) {
    return { value: JSON.parse(await readFile(String(config.path), "utf8")) };
  },
});
```

`defineConnector` checks the definition and stamps it with this contract's name and version, which Mostra reads from the loaded object itself. Declare the contribution in your package's `"mostra"` manifest:

```json
{
  "mostra": {
    "name": "dev.example/my-plugin",
    "contracts": { "connector": "^0.1.0" },
    "contributes": { "connectors": [{ "id": "my-id", "entry": "./dist/index.js" }] },
    "license": "Apache-2.0"
  }
}
```

An artifact uses it in its `live.ts` through `liveSource(connector, config, options)`, which gives `defineLive` the input it takes; it then runs in the artifact's worker. Check it with `mostra plugin validate <dir>` and install it with `mostra plugin add <package> --artifact <path>`. The whole guide is `mostra docs guide/plugins`.

**Versions.** At 0.x a minor release may change the contract, and each Mostra release serves the line it implements: `^0.1.0` admits 0.1.x. Patches only add. The package has no dependencies.

Apache-2.0.
