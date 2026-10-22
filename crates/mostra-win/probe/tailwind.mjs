// Disposable probe for WP-W1 (removed before merging): a Vite build of one CSS file that imports
// Tailwind through a junction, as the builder's staging does, printing the whole error.
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const runtime = resolve("packages/runtime");
const require = createRequire(join(runtime, "package.json"));
const warm = resolve("packages/warm/node_modules");
const root = mkdtempSync(join(tmpdir(), "tw-"));
symlinkSync(warm, join(root, "node_modules"), "junction");
mkdirSync(join(root, "gen"));
writeFileSync(join(root, "gen", "styles.css"), '@import "tailwindcss";\n');
writeFileSync(join(root, "gen", "entry.js"), 'import "./styles.css";\n');
console.log(
  "junction",
  lstatSync(join(root, "node_modules")).isSymbolicLink(),
  realpathSync(join(root, "node_modules")),
);
console.log(
  "tailwindcss",
  statSync(join(root, "node_modules", "tailwindcss")).isDirectory(),
  realpathSync(join(root, "node_modules", "tailwindcss")),
);
console.log(
  "warm has",
  readdirSync(warm).filter((name) => name.startsWith("tailwind")),
);
const { build } = await import(require.resolve("vite"));
const tailwind = (await import(require.resolve("@tailwindcss/vite"))).default;
for (const preserve of [false, true]) {
  try {
    await build({
      root,
      configFile: false,
      logLevel: "warn",
      resolve: { preserveSymlinks: preserve },
      plugins: [tailwind()],
      build: {
        outDir: join(root, `out-${preserve}`),
        rollupOptions: { input: join(root, "gen", "entry.js") },
      },
    });
    console.log(`build ok (preserveSymlinks ${preserve})`);
  } catch (error) {
    console.log(`build FAILED (preserveSymlinks ${preserve}):`, error?.stack ?? error);
  }
}
