# @mostra/cli

## 0.3.0

### Patch Changes

- Updated dependencies [[`bb00a14`](https://github.com/mostra-dev/mostra/commit/bb00a1474c4737e800d5c38824c3250fe3b43890)]:
  - @mostra/protocol@0.3.0
  - @mostra/sdk@0.3.0

## 0.2.0

### Patch Changes

- [#44](https://github.com/mostra-dev/mostra/pull/44) [`b6ddfa7`](https://github.com/mostra-dev/mostra/commit/b6ddfa7fd59d5ab41bb39a37e303a26cd1e202cc) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - `mostra host --help`'s example uses a neutral home path (`~/.my-host/mostra`) instead of naming a particular host.
- Updated dependencies [[`0ff9ae5`](https://github.com/mostra-dev/mostra/commit/0ff9ae5b682ab9b9d5db42b9984d553ce025428b), [`8772efe`](https://github.com/mostra-dev/mostra/commit/8772efeaf48e77765e6c3953c213704dd35c8de5), [`7251965`](https://github.com/mostra-dev/mostra/commit/725196570ed56cf930213d4cffed1093c5863b8e)]:
  - @mostra/protocol@0.2.0
  - @mostra/sdk@0.2.0

## 0.1.0

### Minor Changes

- [#37](https://github.com/mostra-dev/mostra/pull/37) [`ba45dc6`](https://github.com/mostra-dev/mostra/commit/ba45dc6df4b5b42ee2a3ac1d71996ca924d51c20) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - `mostra` installed from npm runs on Mostra's own runtime bundle (RT-01): on first use it downloads the bundle its release pins, checks it against its SHA-256 and file list, caches it, then runs the bundle's own `mostra` with the same arguments on the bundle's private Node.js, so the system's Node.js only has to be 22.19 or later; an older one is refused at once with `MOSTRA_ENV_NODE_UNSUPPORTED` (exit 3). Inside a bundle the CLI runs the bundle's runtime with the bundle's Node.js, and `mostra doctor` reports the bundle (`--deep` checks every file and the verify browser against their SHA-256).

- [#29](https://github.com/mostra-dev/mostra/pull/29) [`0a2e3f3`](https://github.com/mostra-dev/mostra/commit/0a2e3f360287c9e608b98e401f53b4d2eb93b2f9) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - The first release of `mostra`, the CLI (D60, D140): every WP-10 command, `mostra dev` included, as a thin client of the host protocol with daemon autostart, `--json` envelopes, one exit-code table, generated help and `--help --json`, `mostra docs`, `doctor`, `gc`, and anonymous telemetry for the standalone CLI only, which this build never sends (it has no endpoint).

### Patch Changes

- Updated dependencies [[`c37abca`](https://github.com/mostra-dev/mostra/commit/c37abca1b7d39e72781aac0b01e3a81ef20de0e6), [`f86a1d3`](https://github.com/mostra-dev/mostra/commit/f86a1d33ee3dcff3e32578876d41c423338dbdde), [`db2d46c`](https://github.com/mostra-dev/mostra/commit/db2d46c8d27077de225e73543007c69cf7598ff7), [`2fa9414`](https://github.com/mostra-dev/mostra/commit/2fa94140fa30d0a036efe04e1b750d8db6b82721), [`ea68d0a`](https://github.com/mostra-dev/mostra/commit/ea68d0abc2fa93e372865b0f504a1c4d79c21c57), [`c148a7b`](https://github.com/mostra-dev/mostra/commit/c148a7bd9f3175ef6f44e989354d6583e5e41009), [`f1f7bd0`](https://github.com/mostra-dev/mostra/commit/f1f7bd0c38fc3a7567f6e3a2714fcd064bf4408a), [`a0ba1b6`](https://github.com/mostra-dev/mostra/commit/a0ba1b6349cf537a6086c16dafdbc8305dedeb94), [`67f353c`](https://github.com/mostra-dev/mostra/commit/67f353cd7c13af4ae265279ba91053f77428b7b7), [`dd5648f`](https://github.com/mostra-dev/mostra/commit/dd5648ff254e153b4eac5e8cab61979f725730db), [`ec6a96d`](https://github.com/mostra-dev/mostra/commit/ec6a96d65291e6994fdf786b56bd62cba5418a8a), [`59aaab3`](https://github.com/mostra-dev/mostra/commit/59aaab33455cc9bf8e91bca24d97c1b84123212e), [`66af0b5`](https://github.com/mostra-dev/mostra/commit/66af0b5b54d76c8d0c7c898033a9919ae010d571), [`8bce8c7`](https://github.com/mostra-dev/mostra/commit/8bce8c78f5f0b6b10f9928d8de261961e5b7dc0a), [`0939420`](https://github.com/mostra-dev/mostra/commit/093942093a22792ae14436320ecadaee4f66c0f2), [`7e283c2`](https://github.com/mostra-dev/mostra/commit/7e283c229947cd0904ab95803dc48cc52570ac43)]:
  - @mostra/protocol@0.1.0
  - @mostra/sdk@0.1.0
