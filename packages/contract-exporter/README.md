# @mostra/contract-exporter

The contract an exporter implements, for [Mostra](https://github.com/mostra-dev/mostra) plugins: it turns a published artifact version into files: a PDF, a video, an MCP App. One of six extension contracts, each its own package with its own version (D30).

```sh
npm install @mostra/contract-exporter
```

```ts
import { defineExporter } from "@mostra/contract-exporter";

export default defineExporter({
  id: "word-count",
  output: { mediaType: "text/plain", layout: "file", extension: "txt" },
  async export({ files }) {
    const html = await files.readText("client/index.html");
    return { files: [{ path: "words.txt", content: String(html.split(/\s+/).length) }] };
  },
});
```

`defineExporter` checks the definition and stamps it with this contract's name and version, which Mostra reads from the loaded object itself. Declare the contribution in your package's `"mostra"` manifest:

```json
{
  "mostra": {
    "name": "dev.example/my-plugin",
    "contracts": { "exporter": "^0.1.0" },
    "contributes": { "exporters": [{ "id": "my-id", "entry": "./dist/index.js" }] },
    "license": "Apache-2.0"
  }
}
```

`mostra export <artifact> --as <id> --out <path>` runs it in a plugin child of the instance, on the version's client build (never its server code), and writes the files it returns there. Check it with `mostra plugin validate <dir>` and install it with `mostra plugin add <package> --artifact <path>` (or `--home`, for every artifact of the home). The whole guide is `mostra docs guide/plugins`.

**Versions.** At 0.x a minor release may change the contract, and each Mostra release serves the line it implements: `^0.1.0` admits 0.1.x. Patches only add. The package has no dependencies.

Apache-2.0.
