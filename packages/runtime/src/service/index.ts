// The daemon's lifecycle (D62, RT-08): its login service and its idle exit.
export { type IdleWatch, watchIdle } from "./idle.ts";
export { installService, serviceStatus, uninstallService } from "./unit.ts";
