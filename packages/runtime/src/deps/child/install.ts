/**
 * The install child's entry (`dist/deps/child/install.js`, D95, DP-05): the process the process
 * manager starts for every installer run, in the artifact's source directory with the artifact
 * environment. It connects to its supervisor over IPC, so that when the supervisor exits or is
 * killed, its whole process group ends with it (FAILURE_MODEL §2): pnpm, and every lifecycle
 * script pnpm starts, run in that group. Its arguments are pnpm's entry and pnpm's arguments; pnpm
 * runs as its child with the same output, and its exit code is the install child's.
 */
import { spawn } from "node:child_process";
import { connectToSupervisor } from "../../processes/index.ts";

connectToSupervisor();

const [entry, ...args] = process.argv.slice(2);
if (entry === undefined) {
  console.error("The install child needs the installer's entry as its first argument.");
  process.exit(2);
}
// Not detached: pnpm stays in this child's process group (on Windows its Job Object), which the
// supervisor and the disconnect rule both end as a whole. No console window opens on Windows.
const installer = spawn(process.execPath, [entry, ...args], {
  stdio: ["ignore", "inherit", "inherit"],
  windowsHide: true,
});
installer.on("error", (error) => {
  console.error(`The installer couldn't start: ${error.message}`);
  process.exit(1);
});
installer.on("exit", (code, signal) => {
  process.exit(code ?? (signal ? 1 : 0));
});
