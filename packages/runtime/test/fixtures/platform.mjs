// Preloaded with `node --import` to simulate another operating system or architecture for the
// platform gate (RT-07): the runtime sees `process.platform` and `process.arch` as set here.
const platform = process.env.MOSTRA_TEST_PLATFORM ?? "win32";
const arch = process.env.MOSTRA_TEST_ARCH ?? process.arch;
Object.defineProperty(process, "platform", { value: platform });
Object.defineProperty(process, "arch", { value: arch });
