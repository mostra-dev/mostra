/**
 * Every host protocol method this package defines. `pnpm gen protocol-method` adds entries at the
 * markers; the method itself lives in its own module under `methods/<group>/`.
 */
import type { AnyMethod } from "../method.ts";
// gen:method-imports

/** Every host protocol method, in the order they were added. */
export const hostMethods: readonly AnyMethod[] = [
  // gen:methods
];
