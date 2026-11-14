# @mostra/contract-verify-check

The contract a verify check implements, for [Mostra](https://github.com/mostra-dev/mostra) plugins: it adds a check to `mostra verify`: findings with codes, severities and locations. One of six extension contracts, each its own package with its own version (D30).

```sh
npm install @mostra/contract-verify-check
```

```ts
import { defineVerifyCheck, type Finding } from "@mostra/contract-verify-check";

export default defineVerifyCheck({
  id: "no-todo",
  stage: "source",
  async run({ source }) {
    const findings: Finding[] = [];
    for (const path of await source.list()) {
      if ((await source.readText(path)).includes("TODO")) {
        findings.push({ code: "NO_TODO", severity: "warning", message: `${path} has a TODO.` });
      }
    }
    return { findings };
  },
});
```

`defineVerifyCheck` checks the definition and stamps it with this contract's name and version, which Mostra reads from the loaded object itself. Declare the contribution in your package's `"mostra"` manifest:

```json
{
  "mostra": {
    "name": "dev.example/my-plugin",
    "contracts": { "verify-check": "^0.1.0" },
    "contributes": { "verifyChecks": [{ "id": "my-id", "entry": "./dist/index.js" }] },
    "license": "Apache-2.0"
  }
}
```

Mostra checks it when it is added and when `verify` and `publish` load the artifact's plugins. Check it with `mostra plugin validate <dir>` and install it with `mostra plugin add <package> --artifact <path>`. The whole guide is `mostra docs guide/plugins`.

**Versions.** At 0.x a minor release may change the contract, and each Mostra release serves the line it implements: `^0.1.0` admits 0.1.x. Patches only add. The package has no dependencies.

Apache-2.0.
