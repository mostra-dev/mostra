/**
 * `@mostra/server/host`: what an artifact's worker uses to run server code: the request context
 * (D19 seam 3), the bridge to the supervisor and the live sources `live.ts` declares. Artifact code
 * never imports it.
 *
 * @packageDocumentation
 */
export {
  currentCall,
  installServerHost,
  runWithContext,
  type ServerCallContext,
  type ServerHost,
  type StateSnapshot,
} from "./context.ts";
export { type LiveSourceOptions, liveSourceOptions, parseDuration } from "./live.ts";
