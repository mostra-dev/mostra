# @mostra/contract-embed-engine

The contract an embed engine implements, for [Mostra](https://github.com/mostra-dev/mostra) plugins: it mounts something into a page that Mostra renders, screenshots and verifies uniformly: a terminal, a Remotion composition, a GSAP timeline. One of six extension contracts, each its own package with its own version (D30).

```sh
npm install @mostra/contract-embed-engine
```

```ts
import { defineEmbedEngine } from "@mostra/contract-embed-engine";

export default defineEmbedEngine({
  id: "marquee",
  sources: ["text"],
  capabilities: ["resize"],
  async mount({ element, source, size }) {
    element.textContent = String(source.data ?? "");
    element.style.width = `${size.width}px`;
    return {
      resize: ({ size: next }) => {
        element.style.width = `${next.width}px`;
      },
      dispose: async () => {
        element.textContent = "";
      },
    };
  },
});
```

`defineEmbedEngine` checks the definition and stamps it with this contract's name and version, which Mostra reads from the loaded object itself. Declare the contribution in your package's `"mostra"` manifest:

```json
{
  "mostra": {
    "name": "dev.example/my-plugin",
    "contracts": { "embed-engine": "^0.1.0" },
    "contributes": { "embedEngines": [{ "id": "my-id", "entry": "./dist/index.js" }] },
    "license": "Apache-2.0"
  }
}
```

It runs in the artifact's page: the artifact imports the plugin's package, and the kit's components that host engines check its stamp. Check it with `mostra plugin validate <dir>` and install it with `mostra plugin add <package> --artifact <path>`. The whole guide is `mostra docs guide/plugins`.

**Versions.** At 0.x a minor release may change the contract, and each Mostra release serves the line it implements: `^0.1.0` admits 0.1.x. Patches only add. The package has no dependencies.

Apache-2.0.
