# @mostra/contract-anchor-provider

The contract an anchor provider implements, for [Mostra](https://github.com/mostra-dev/mostra) plugins: it turns a selection inside a component into a review anchor and back: a chart's datum, a slide's step. One of six extension contracts, each its own package with its own version (D30).

```sh
npm install @mostra/contract-anchor-provider
```

```ts
import { defineAnchorProvider } from "@mostra/contract-anchor-provider";

export default defineAnchorProvider({
  id: "table-cell",
  kind: "table-cell",
  serialize: ({ target }) => {
    const cell = target.closest("td");
    return cell?.id ? { anchor: { cell: cell.id }, label: cell.textContent ?? "" } : undefined;
  },
  resolve: ({ anchor, root }) => {
    const element = root.querySelector(`[id="${String(anchor["cell"])}"]`);
    return element ? { element } : undefined;
  },
});
```

`defineAnchorProvider` checks the definition and stamps it with this contract's name and version, which Mostra reads from the loaded object itself. Declare the contribution in your package's `"mostra"` manifest:

```json
{
  "mostra": {
    "name": "dev.example/my-plugin",
    "contracts": { "anchor-provider": "^0.1.0" },
    "contributes": { "anchorProviders": [{ "id": "my-id", "entry": "./dist/index.js" }] },
    "license": "Apache-2.0"
  }
}
```

It runs in the artifact's page, where the review overlay asks providers to serialize and resolve anchors (D23). Check it with `mostra plugin validate <dir>` and install it with `mostra plugin add <package> --artifact <path>`. The whole guide is `mostra docs guide/plugins`.

**Versions.** At 0.x a minor release may change the contract, and each Mostra release serves the line it implements: `^0.1.0` admits 0.1.x. Patches only add. The package has no dependencies.

Apache-2.0.
