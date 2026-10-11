/**
 * Every host protocol method this package defines. `pnpm gen protocol-method` adds entries at the
 * markers; the method itself lives in its own module under `methods/<group>/`.
 */
import type { AnyMethod } from "../method.ts";
import { instanceStatusMethod } from "./instance/status.ts";
import { mostraInitializeMethod } from "./mostra/initialize.ts";
import { mostraShutdownMethod } from "./mostra/shutdown.ts";
// gen:method-imports

/** Every host protocol method, in the order they were added. */
export const hostMethods: readonly AnyMethod[] = [
  mostraInitializeMethod,
  mostraShutdownMethod,
  instanceStatusMethod,
  // gen:methods
];
