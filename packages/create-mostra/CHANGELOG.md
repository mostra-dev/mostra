# create-mostra

## 0.6.0

### Minor Changes

- [#79](https://github.com/mostra-dev/mostra/pull/79) [`ee5a888`](https://github.com/mostra-dev/mostra/commit/ee5a8883ec3cfd8c0f3d849f2b5a78b761e39c4a) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - `npm create mostra` installs and runs on Windows (x64 and arm64), from the Windows runtime bundles each release now carries with the others. The conformance kit's TypeScript reference host starts on Windows, and `MOSTRA_PLATFORM_UNSUPPORTED`'s hint and page name Windows among the supported platforms. The Rust crate `mostra-host`, released with them, spawns and attaches on Windows too, over the home's named pipe, which it refuses unless your user owns it.

### Patch Changes

- Updated dependencies [[`e903d95`](https://github.com/mostra-dev/mostra/commit/e903d952bc51fd108c736ae7d4bb4ff610f133dc)]:
  - @mostra/cli@0.6.0

## 0.5.0

### Patch Changes

- Updated dependencies [[`911f8f7`](https://github.com/mostra-dev/mostra/commit/911f8f7b3b036e7c6626088c4b4b44371b641935), [`aa3031f`](https://github.com/mostra-dev/mostra/commit/aa3031f7548aaace9976444d422c4d13813f2c37), [`ed8a382`](https://github.com/mostra-dev/mostra/commit/ed8a382e57b9f6b25e34fbd1e04b50ad852d6ff9)]:
  - @mostra/cli@0.5.0

## 0.4.0

### Patch Changes

- Updated dependencies [[`74db4c1`](https://github.com/mostra-dev/mostra/commit/74db4c1cd9b6d8ed020641d8d846ada4f564d5c5), [`8786a3e`](https://github.com/mostra-dev/mostra/commit/8786a3ee63ac708207394946a1dd43ea3b1c474c), [`5babe15`](https://github.com/mostra-dev/mostra/commit/5babe15751fe86a9e12ca7165683c8d866808c18), [`c41f76a`](https://github.com/mostra-dev/mostra/commit/c41f76ad11d247e7c115d835f26ccf0e7cb32ec8), [`4c70f4b`](https://github.com/mostra-dev/mostra/commit/4c70f4b2272b4194015ab5282eb19014342f2376), [`fd893ae`](https://github.com/mostra-dev/mostra/commit/fd893aee2dbcf801d409054220fd81db251de7d1), [`2f89021`](https://github.com/mostra-dev/mostra/commit/2f89021c078cf5839918c963e6e5146d6ac16a1c), [`127155e`](https://github.com/mostra-dev/mostra/commit/127155ea56afb0ccd1e17d26dddf6a4c98a441dd)]:
  - @mostra/cli@0.4.0

## 0.3.0

### Patch Changes

- Updated dependencies []:
  - @mostra/cli@0.3.0

## 0.2.0

### Patch Changes

- Updated dependencies [[`b6ddfa7`](https://github.com/mostra-dev/mostra/commit/b6ddfa7fd59d5ab41bb39a37e303a26cd1e202cc)]:
  - @mostra/cli@0.2.0

## 0.1.0

### Minor Changes

- [#37](https://github.com/mostra-dev/mostra/pull/37) [`f47f690`](https://github.com/mostra-dev/mostra/commit/f47f69023773239a94a63a1bde6aa03d51f9255e) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - `npm create mostra [dir]`: creates an artifact with `mostra new`, installing the pinned runtime bundle on first use, and prints what to run next. With `--json`, stdout is the CLI's one envelope.

### Patch Changes

- Updated dependencies [[`ba45dc6`](https://github.com/mostra-dev/mostra/commit/ba45dc6df4b5b42ee2a3ac1d71996ca924d51c20), [`0a2e3f3`](https://github.com/mostra-dev/mostra/commit/0a2e3f360287c9e608b98e401f53b4d2eb93b2f9)]:
  - @mostra/cli@0.1.0
