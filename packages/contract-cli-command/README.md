# @mostra/contract-cli-command

The contract a CLI command implements, for [Mostra](https://github.com/mostra-dev/mostra) plugins: it adds a command to `mostra`, such as `mostra term record`. One of six extension contracts, each its own package with its own version (D30).

```sh
npm install @mostra/contract-cli-command
```

```ts
import { defineCliCommand } from "@mostra/contract-cli-command";

export default defineCliCommand({
  path: ["hello"],
  summary: "Say hello.",
  args: [{ name: "name", summary: "Who to greet." }],
  async run({ args }) {
    return { result: { greeting: `Hello, ${args["name"]}` } };
  },
});
```

`defineCliCommand` checks the definition and stamps it with this contract's name and version, which Mostra reads from the loaded object itself. Declare the contribution in your package's `"mostra"` manifest:

```json
{
  "mostra": {
    "name": "dev.example/my-plugin",
    "contracts": { "cli-command": "^0.1.0" },
    "contributes": { "cliCommands": [{ "command": "hello", "entry": "./dist/index.js" }] },
    "license": "Apache-2.0"
  }
}
```

`mostra <words>` finds it among the home's plugins and the current artifact's, runs it in a plugin child, and prints its result, as JSON with `--json`. Check it with `mostra plugin validate <dir>` and install it with `mostra plugin add <package> --artifact <path>` (or `--home`, for every artifact of the home). The whole guide is `mostra docs guide/plugins`.

**Versions.** At 0.x a minor release may change the contract, and each Mostra release serves the line it implements: `^0.1.0` admits 0.1.x. Patches only add. The package has no dependencies.

Apache-2.0.
