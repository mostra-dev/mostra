/**
 * The shell's page allows scripts from its own origin only (`script-src 'self'`, D98), so it
 * never evaluates generated code. Zod compiles object schemas with `new Function` unless told
 * not to, and probes for it even when the probe would fail; this turns both off. It must be the
 * entry's first import: Zod reads the setting when each schema is built.
 */
import { config } from "zod";

config({ jitless: true });
