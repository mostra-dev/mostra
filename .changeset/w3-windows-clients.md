---
"create-mostra": minor
"@mostra/conformance": patch
"@mostra/protocol": patch
---

`npm create mostra` installs and runs on Windows (x64 and arm64), from the Windows runtime bundles each release now carries with the others. The conformance kit's TypeScript reference host starts on Windows, and `MOSTRA_PLATFORM_UNSUPPORTED`'s hint and page name Windows among the supported platforms. The Rust crate `mostra-host`, released with them, spawns and attaches on Windows too, over the home's named pipe, which it refuses unless your user owns it.
