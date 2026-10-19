# create-mostra

Create a [Mostra](https://github.com/mostra-dev/mostra) artifact:

```sh
npm create mostra@latest my-artifact
```

The first run downloads Mostra's runtime for your platform (about 200 MB, macOS and Linux),
checks it against the SHA-256 its release pins, and caches it; later runs reuse it. Mostra runs on
its own Node.js, so the version you have doesn't matter. Then:

```sh
npx @mostra/cli verify my-artifact
npx @mostra/cli publish my-artifact
```

Every flag after `--` is `mostra new`'s, for example `npm create mostra@latest review -- --title "Q3 review"`.

Part of Mostra, the agent artifact runtime. Apache-2.0.
