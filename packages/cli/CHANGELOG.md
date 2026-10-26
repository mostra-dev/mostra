# @mostra/cli

## 0.6.0

### Minor Changes

- [#79](https://github.com/mostra-dev/mostra/pull/79) [`e903d95`](https://github.com/mostra-dev/mostra/commit/e903d952bc51fd108c736ae7d4bb4ff610f133dc) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - Windows (x64 and arm64) is supported like macOS and Linux: the development switch `MOSTRA_DEV_WINDOWS` is gone, and every other platform still fails closed with `MOSTRA_PLATFORM_UNSUPPORTED`.

### Patch Changes

- Updated dependencies [[`dace950`](https://github.com/mostra-dev/mostra/commit/dace950c6ca7004ea7e11f1b07c23e9abea8de18), [`cf0343a`](https://github.com/mostra-dev/mostra/commit/cf0343a1bb8e66b074a567587395c69a4501aa52), [`9d96c60`](https://github.com/mostra-dev/mostra/commit/9d96c60ebbc7994ea95a408a112580990852ba88), [`7012f26`](https://github.com/mostra-dev/mostra/commit/7012f2605f7ab77c2e0de45218fca0f5b7de61ba), [`ee5a888`](https://github.com/mostra-dev/mostra/commit/ee5a8883ec3cfd8c0f3d849f2b5a78b761e39c4a)]:
  - @mostra/protocol@0.6.0
  - @mostra/sdk@0.6.0

## 0.5.0

### Patch Changes

- [#75](https://github.com/mostra-dev/mostra/pull/75) [`911f8f7`](https://github.com/mostra-dev/mostra/commit/911f8f7b3b036e7c6626088c4b4b44371b641935) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - On Windows, when creating the telemetry lock is refused and no lock file is there, the CLI now checks whether it can write its config directory at all (a file of its own) instead of giving up after three such rounds, so a lock other processes keep taking and releasing is waited for until the usual 2 s.
  
  On Windows, the CLI's telemetry settings and queue are replaced with retries for up to a second while another process has the file open, which Windows refuses; before, such a command lost its install ID or its notice (seen in CI with twelve processes starting at once).

- [#75](https://github.com/mostra-dev/mostra/pull/75) [`aa3031f`](https://github.com/mostra-dev/mostra/commit/aa3031f7548aaace9976444d422c4d13813f2c37) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - `mostra verify`, `mostra doctor` and `mostra wait` treat a status they don't know, which a newer Mostra may send, as a failure: `verify` exits 0 only on a passing verdict, `doctor` fails on any check that isn't `ok` or `warning`, and `wait` ends with exit 1 instead of waiting again. A telemetry probe file Windows briefly holds no longer interrupts a command.

- [#72](https://github.com/mostra-dev/mostra/pull/72) [`ed8a382`](https://github.com/mostra-dev/mostra/commit/ed8a382e57b9f6b25e34fbd1e04b50ad852d6ff9) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - On Windows, a telemetry lock that another process finished deleting just as this one tried to take it no longer makes this process give up without an install ID; a directory this user can't write still gives up within about 60 ms.
- Updated dependencies [[`7893700`](https://github.com/mostra-dev/mostra/commit/78937009ac67a4780b3c29017b5e84dd818d6f75), [`c3c0052`](https://github.com/mostra-dev/mostra/commit/c3c0052183bcc02b27d755001419d1e55a3a8e7f), [`e48e7aa`](https://github.com/mostra-dev/mostra/commit/e48e7aad93787e3f2a8e41c6088239bcc2f11178)]:
  - @mostra/protocol@0.5.0
  - @mostra/sdk@0.5.0

## 0.4.0

### Minor Changes

- [#62](https://github.com/mostra-dev/mostra/pull/62) [`5babe15`](https://github.com/mostra-dev/mostra/commit/5babe15751fe86a9e12ca7165683c8d866808c18) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - The CLI admits Windows x64 and arm64 behind the development switch `MOSTRA_DEV_WINDOWS=1`, as the runtime does, and fails closed on any other platform or architecture. On Windows it reaches its daemon's pipe through `connectControl`, defaults its home to `%LOCALAPPDATA%\mostra` and its settings to `%APPDATA%\mostra`, opens links with the default browser through Explorer and reads `$BROWSER` as a `;`-separated list; telemetry reports `win32` as the system, and `mostra doctor` reports Windows as the runtime admits it.

### Patch Changes

- [#62](https://github.com/mostra-dev/mostra/pull/62) [`74db4c1`](https://github.com/mostra-dev/mostra/commit/74db4c1cd9b6d8ed020641d8d846ada4f564d5c5) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - The daemon and the telemetry flusher the CLI starts no longer keep the directory the command ran in as their working directory, so on Windows that directory can be renamed or removed while they run. A telemetry config directory that can never exist (a part of its path is a file) reads as unreadable on every system, as it did on macOS and Linux.

- [#62](https://github.com/mostra-dev/mostra/pull/62) [`8786a3e`](https://github.com/mostra-dev/mostra/commit/8786a3ee63ac708207394946a1dd43ea3b1c474c) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - `mostra dev` also stops on Ctrl+Break, as a Windows console sends it.

- [#62](https://github.com/mostra-dev/mostra/pull/62) [`c41f76a`](https://github.com/mostra-dev/mostra/commit/c41f76ad11d247e7c115d835f26ccf0e7cb32ec8) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - The CLI starts its daemon with an absolute runtime entry, so a relative `MOSTRA_RUNTIME_BIN` works again now that the daemon runs in its file system root, and the telemetry store gives up on a lock it can neither take nor break within its 2 s instead of trying forever.

- [#62](https://github.com/mostra-dev/mostra/pull/62) [`4c70f4b`](https://github.com/mostra-dev/mostra/commit/4c70f4b2272b4194015ab5282eb19014342f2376) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - The daemon and the telemetry flusher, which run in their file system's root, get every relative path variable (`MOSTRA_RUNTIME_DIR`, `MOSTRA_HOME` and the rest) resolved against the command's directory. On Windows, a telemetry lock that this user can't create no longer keeps a command busy for 2 s.

- [#62](https://github.com/mostra-dev/mostra/pull/62) [`fd893ae`](https://github.com/mostra-dev/mostra/commit/fd893aee2dbcf801d409054220fd81db251de7d1) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - On Windows, `mostra open` writes its launch page under the user's own profile, never under a `%TEMP%` that other users may read. The conformance kit opens an instance's pipe through the SDK's `connectControl`, as every other client does.

- [#62](https://github.com/mostra-dev/mostra/pull/62) [`2f89021`](https://github.com/mostra-dev/mostra/commit/2f89021c078cf5839918c963e6e5146d6ac16a1c) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - On Windows, a telemetry store lock that another process has just released no longer makes a command give up on recording its event: the refusal Windows gives while the old lock is still being deleted counts as the lock being held, and the command waits for it as it does elsewhere.

- [#62](https://github.com/mostra-dev/mostra/pull/62) [`127155e`](https://github.com/mostra-dev/mostra/commit/127155ea56afb0ccd1e17d26dddf6a4c98a441dd) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - Telemetry events from Windows (`os: "win32"`) are queued: the event schema refused them, so a Windows CLI with telemetry on recorded nothing.
- Updated dependencies [[`fe84a16`](https://github.com/mostra-dev/mostra/commit/fe84a160c095c6dfe29f3ed5c956ae36407c788f), [`973bd3c`](https://github.com/mostra-dev/mostra/commit/973bd3c2d13c63e8d97e25c67ae1a65adcc1f2fd), [`5babe15`](https://github.com/mostra-dev/mostra/commit/5babe15751fe86a9e12ca7165683c8d866808c18)]:
  - @mostra/protocol@0.4.0
  - @mostra/sdk@0.4.0

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
