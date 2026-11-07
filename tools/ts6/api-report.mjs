// Runs API Extractor on one package's built declarations: its main entry, and each subpath the
// package lists in `mostra.apiReports` (`./operator` → `etc/<name>-operator.api.md`). API Extractor analyzes with the
// TypeScript it bundles; it takes system typings from the pinned TypeScript 6 (TypeScript 7 has
// no compiler API). Usage: node api-report.mjs <packageDir> <local|ci>
// Writes or compares <packageDir>/etc/<name>.api.md and fails on any warning, including public
// exports without TSDoc (ae-undocumented).
import { mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { Extractor, ExtractorConfig } from "@microsoft/api-extractor";

const [packageArg, mode] = process.argv.slice(2);
const packageDir = packageArg && resolve(packageArg);
if (!packageDir || (mode !== "local" && mode !== "ci")) {
  console.error("usage: api-report.mjs <packageDir> <local|ci>");
  process.exit(2);
}

const require = createRequire(import.meta.url);
const typescriptCompilerFolder = dirname(require.resolve("typescript/package.json"));

// A package whose code runs in Node (its tsconfig names the "node" types) has Node's globals in
// its public API, AbortSignal for one; the report sees them through that package's @types/node.
const sourceConfig = JSON.parse(readFileSync(join(packageDir, "tsconfig.src.json"), "utf8"));
const nodeTypes = (sourceConfig.compilerOptions?.types ?? []).includes("node");

mkdirSync(join(packageDir, "etc"), { recursive: true });

function report(entry, reportName) {
  const config = ExtractorConfig.prepare({
    configObject: {
      projectFolder: packageDir,
      newlineKind: "lf",
      mainEntryPointFilePath: `<projectFolder>/dist/${entry}.d.ts`,
      bundledPackages: [],
      compiler: {
        overrideTsconfig: {
          compilerOptions: {
            target: "es2024",
            lib: ["es2024"],
            module: "preserve",
            moduleResolution: "bundler",
            strict: true,
            skipLibCheck: true,
            types: nodeTypes ? ["node"] : [],
            ...(nodeTypes ? { typeRoots: [join(packageDir, "node_modules", "@types")] } : {}),
          },
          include: ["dist/**/*.d.ts"],
        },
      },
      apiReport: {
        enabled: true,
        reportFolder: "<projectFolder>/etc/",
        reportTempFolder: "<projectFolder>/.tsbuild/api/",
        reportFileName: reportName,
      },
      docModel: { enabled: false },
      dtsRollup: { enabled: false },
      tsdocMetadata: { enabled: false },
      messages: {
        compilerMessageReporting: { default: { logLevel: "warning" } },
        extractorMessageReporting: {
          default: { logLevel: "warning" },
          "ae-missing-release-tag": { logLevel: "none" },
          "ae-undocumented": { logLevel: "warning", addToApiReportFile: false },
        },
        tsdocMessageReporting: { default: { logLevel: "warning" } },
      },
    },
    configObjectFullPath: join(packageDir, "api-extractor.json"),
    packageJsonFullPath: join(packageDir, "package.json"),
  });

  const result = Extractor.invoke(config, {
    localBuild: mode === "local",
    showVerboseMessages: false,
    typescriptCompilerFolder,
  });

  if (result.apiReportChanged) {
    console.error(
      mode === "local"
        ? `API report updated: ${config.reportFilePath}. Review the change and commit it.`
        : `API report out of date: ${config.reportFilePath}. Run pnpm check locally and commit the report.`,
    );
  }
  const ok = result.succeeded && result.warningCount === 0 && !result.apiReportChanged;
  console.log(
    `${ok ? "✓" : "✗"} API Extractor (${entry}) ${Extractor.version} (its bundled TypeScript engine, ` +
      `TypeScript ${require("typescript/package.json").version} system typings): ` +
      `${result.errorCount} errors, ${result.warningCount} warnings`,
  );
  return ok;
}

const packageJson = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8"));
const unscoped = packageJson.name.replace(/^@[^/]+\//, "");
const entries = [["index", "<unscopedPackageName>"]];
for (const subpath of packageJson.mostra?.apiReports ?? []) {
  const name = subpath.replace(/^\.\//, "");
  entries.push([name, `${unscoped}-${name}`]);
}
let ok = true;
for (const [entry, reportName] of entries) ok = report(entry, reportName) && ok;
process.exit(ok ? 0 : 1);
