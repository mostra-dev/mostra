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
  // gen:entries
};
