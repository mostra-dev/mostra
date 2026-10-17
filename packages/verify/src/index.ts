/**
 * `@mostra/verify`: the verify runner, the child process the supervisor starts to render artifact
 * pages in a warm headless Chromium (ARCHITECTURE §1, D138). Its entry is `mostra-verify`
 * (`dist/main.js`); the supervisor talks to it over IPC with `VERIFY_RUNNER_METHODS` from
 * `@mostra/protocol`. This entry exposes the runner itself, for tests and other hosts of it.
 */

export { ariaSummary } from "@mostra/protocol";
export { dedupe, judge, type Moment } from "./observe.ts";
export { type RecordedEntry, recorder } from "./recorder.ts";
export {
  bounded,
  compareImages,
  createRunner,
  RUNNER_IDLE_MS,
  type Runner,
  type RunnerOptions,
  uniform,
} from "./runner.ts";
