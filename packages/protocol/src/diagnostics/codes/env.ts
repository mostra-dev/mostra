/**
 * Diagnostic codes of the ENV area.
 */
import type { AreaCatalog } from "../spec.ts";

/** The codes of the ENV area, in the order they were added. */
export const envDiagnosticCodes = [
  "MOSTRA_ENV_WARM_MISSING",
  "MOSTRA_ENV_PORT_TAKEN",
  "MOSTRA_ENV_BIND_FAILED",
  "MOSTRA_ENV_SHELL_MISSING",
  "MOSTRA_ENV_SERVICE_FAILED",
  "MOSTRA_ENV_BROWSER_MISSING",
  "MOSTRA_ENV_RUNTIME_MISSING",
  "MOSTRA_ENV_BUNDLE_INVALID",
  "MOSTRA_ENV_BUNDLE_DOWNLOAD_FAILED",
  "MOSTRA_ENV_BUNDLE_UNAVAILABLE",
  "MOSTRA_ENV_NODE_UNSUPPORTED",
  "MOSTRA_ENV_HELPER_MISSING",
  // gen:codes
] as const;

/** The codes of the ENV area. */
export type EnvDiagnosticCode = (typeof envDiagnosticCodes)[number];

/** The ENV area's catalog entries. */
export const envDiagnostics: AreaCatalog<EnvDiagnosticCode> = {
  MOSTRA_ENV_WARM_MISSING: {
    severity: "error",
    phase: "host",
    title: "Warm package set missing",
    hint: "Reinstall the Mostra runtime, or set `MOSTRA_WARM_DIR` to its warm package set.",
    docs: {
      explanation:
        "Builds resolve React, Tailwind and Mostra's own client packages from the warm package set that ships with the runtime. The runtime couldn't find it, which means the runtime installation is incomplete.",
      fix: "Reinstall Mostra so the runtime bundle is complete. A custom layout can point the runtime at the warm set's directory with `MOSTRA_WARM_DIR`.",
    },
  },
  MOSTRA_ENV_PORT_TAKEN: {
    severity: "warning",
    phase: "host",
    title: "Leased port taken",
    hint: "Open the artifact through a new link: `view/url` or `mostra open` mints one on the new port.",
    docs: {
      explanation:
        "The shell's port or an artifact's port is leased per home and reused across restarts, so links keep working (D62, D99). At start-up another program held the leased port, so Mostra leased a new one. Links that named the old port stop working; the shell's port changing affects every link of the home.",
      fix: "Mint new links with `view/url` (the publish receipt of the next publish carries the new default link too). Stop the program that took the port if you want the old links back; `mostra doctor` names it where it can.",
    },
  },
  MOSTRA_ENV_BIND_FAILED: {
    severity: "error",
    phase: "host",
    title: "Gateway can't bind",
    hint: "Start Mostra with an address this machine has, or without `--bind` to use the loopback address.",
    docs: {
      explanation:
        "The gateway couldn't listen on the address it was given: `--bind` named an address no interface has, a wildcard bind came without `--url-host`, or the operating system refused the address. Mostra doesn't start rather than serve on an address nobody asked for.",
      fix: "Omit `--bind` to serve on `127.0.0.1` only (the default). For a wider bind, pass an address of one of this machine's interfaces, and with `0.0.0.0` or `::` also `--url-host <name>`, the name viewers use to reach it.",
    },
  },
  MOSTRA_ENV_SHELL_MISSING: {
    severity: "error",
    phase: "host",
    title: "Shell app missing",
    hint: "Reinstall the Mostra runtime, or set `MOSTRA_SHELL_DIR` to its built shell.",
    docs: {
      explanation:
        "Viewers open artifacts inside the shell, Mostra's trusted page, which ships with the runtime as built files. The runtime couldn't find them, which means the runtime installation is incomplete. Artifact frames are still served.",
      fix: "Reinstall Mostra so the runtime bundle is complete. A custom layout can point the runtime at the shell's built directory with `MOSTRA_SHELL_DIR`.",
    },
  },
  MOSTRA_ENV_SERVICE_FAILED: {
    severity: "error",
    phase: "host",
    title: "Login service could not be installed",
    hint: "Read the message, fix what it names, and run the install again.",
    docs: {
      explanation:
        "`mostra daemon install` couldn't register the home's daemon as a login service: writing the launchd agent or systemd user unit failed, or `launchctl` or `systemctl --user` refused to load it.",
      fix: "Check the named file's directory permissions, and on Linux that a systemd user session is running (`systemctl --user status`). On a machine without one, start the daemon from your own login scripts with `mostra daemon start`.",
    },
  },
  MOSTRA_ENV_BROWSER_MISSING: {
    severity: "error",
    phase: "host",
    title: "Browser for verify missing",
    hint: "Run the runtime bundle's `bin/mostra-setup` (with network access) to fetch the browser verify uses, then verify again.",
    docs: {
      explanation:
        "Verify renders pages in the Chromium headless shell its Playwright release pins. The runtime bundle fetches that browser when it is set up and checks every file of it (D142). It wasn't there, so verify ran only the stages that need no browser (type check, build and the field-ID scan) and reported this error. Publishing needs `--force` until it is installed.",
      fix: "Run `bin/mostra-setup` in the runtime bundle's directory (the message names it) with network access; it fetches and checks the pinned browser. Outside a bundle, in a development checkout, run `npx playwright-core install chromium-headless-shell`. Then verify again.",
    },
  },
  MOSTRA_ENV_RUNTIME_MISSING: {
    severity: "error",
    phase: "host",
    title: "Runtime not found",
    hint: "Reinstall Mostra, or set `MOSTRA_RUNTIME_BIN` to the runtime's `mostra-runtime` entry.",
    docs: {
      explanation:
        "The CLI starts and attaches to the home's instance through the runtime binary (`mostra-runtime`, D85). It looked, in order, for `MOSTRA_BUNDLE`, `MOSTRA_RUNTIME_BIN`, the runtime bundle it runs from, its release's pinned bundle and a development checkout's built runtime (D142), and found nothing it could run: here, `MOSTRA_RUNTIME_BIN` names a file that doesn't exist, or the runtime couldn't be started.",
      fix: "Unset `MOSTRA_RUNTIME_BIN` or point it at a `mostra-runtime` entry (its `dist/bin.js`), or reinstall Mostra so the CLI and its runtime are complete.",
    },
  },
  MOSTRA_ENV_BUNDLE_INVALID: {
    severity: "error",
    phase: "platform",
    title: "Runtime bundle failed verification",
    hint: "Nothing was installed; install Mostra again, and if it fails the same way, report it with the message.",
    docs: {
      explanation:
        "Mostra checks every runtime bundle before it runs anything from it: the archive against the SHA-256 the installing package pins, then each extracted file against the bundle's own file list, and the verify browser against the bundle's browser pin. One of them differed, so the download was corrupted, changed on the way or replaced, and Mostra refused it. A bundle already installed that fails a later check (`mostra doctor --deep`) is refused the same way.",
      fix: "Run the install again (`npm create mostra`, or the command that started it), which downloads a fresh copy. When a mirror is configured (`MOSTRA_BUNDLE_MIRROR`), check that it serves the release's files unchanged. Check a file you downloaded yourself against the release's `SHA256SUMS`, or with `gh attestation verify <file> --repo mostra-dev/mostra`.",
    },
  },
  MOSTRA_ENV_BUNDLE_DOWNLOAD_FAILED: {
    severity: "error",
    phase: "platform",
    title: "Runtime bundle download failed",
    hint: "Check the network or proxy (`HTTPS_PROXY`), then run the command again: a retry starts the download over.",
    docs: {
      explanation:
        "The runtime bundle for this release and platform isn't in the local cache yet, and fetching it failed: the network or a proxy refused it, the server answered with an error, the connection stalled for 60 seconds, or the disk ran out of space while it was written. Nothing partial is kept.",
      fix: "Check the connection, and set `HTTPS_PROXY` (and `NO_PROXY`) when the network needs a proxy. Behind a firewall that blocks GitHub, host the release's files on a reachable server and set `MOSTRA_BUNDLE_MIRROR` to its base URL (a `file:` URL works for a local directory). Free space in the cache directory (`MOSTRA_CACHE_DIR`) if the message says the disk is full.",
    },
  },
  MOSTRA_ENV_BUNDLE_UNAVAILABLE: {
    severity: "error",
    phase: "platform",
    title: "No runtime bundle available",
    hint: "Run this once with network access, or point `MOSTRA_BUNDLE` at an extracted bundle.",
    docs: {
      explanation:
        "Mostra runs on its own runtime bundle, found in the local cache, beside the installed package or at `MOSTRA_BUNDLE`. None was there, and no download could start: Mostra is offline (`MOSTRA_OFFLINE`), this build of the package pins no bundle for this platform, or the platform has none.",
      fix: "Run the command once with network access and without `MOSTRA_OFFLINE`, so the pinned bundle is fetched and cached; later runs work offline. On a machine without network access, extract the release's archive for the platform and set `MOSTRA_BUNDLE` to its directory. A development checkout uses its own built runtime instead.",
    },
  },
  MOSTRA_ENV_NODE_UNSUPPORTED: {
    severity: "error",
    phase: "platform",
    title: "Node.js too old to start Mostra",
    hint: "Run `mostra` with Node.js 22.19 or later, or run the runtime bundle's own `bin/mostra`, which needs no Node.js.",
    docs: {
      explanation:
        "A `mostra` (or `npm create mostra`) installed from npm starts on the machine's Node.js only long enough to find its runtime bundle, then every Mostra process runs on the bundle's own Node.js (RT-01, D142). That start needs Node.js 22.19 or later, and this one is older, so Mostra stopped before loading anything.",
      fix: "Upgrade the machine's Node.js to 22.19 or later, or run Mostra without npm: download the runtime bundle for your platform from the GitHub release, check it against `SHA256SUMS`, extract it, run its `bin/mostra-setup` once, then use its `bin/mostra`.",
    },
  },
  MOSTRA_ENV_HELPER_MISSING: {
    severity: "error",
    phase: "platform",
    title: "Windows helper missing",
    hint: "Reinstall Mostra, or set `MOSTRA_WIN_HELPER` to its `mostra-win.exe`.",
    docs: {
      explanation:
        "On Windows the runtime runs `mostra-win.exe`, a helper that ships with it, for what Node.js can't do there: owner-only access to the home, the home's control pipe, and every child process in a Job Object. The runtime looked for it at `MOSTRA_WIN_HELPER`, in its runtime bundle, and in a development checkout's Cargo build, and found none, so it stopped before touching the home.",
      fix: "Reinstall Mostra so the runtime bundle is complete. In a development checkout, build the helper with `cargo build -p mostra-win`. A custom layout can point the runtime at the helper with `MOSTRA_WIN_HELPER`.",
    },
  },
  // gen:entries
};
