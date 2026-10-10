#!/usr/bin/env node
/**
 * Per-package tasks that Turborepo runs from a package directory:
 *
 *   mostra-tools api              API report, changeset rule, publint, attw (EN-04)
 *   mostra-tools schemas check    wire-schema snapshots current and additive (HO-07)
 *   mostra-tools schemas write    regenerate the snapshots (refuses non-additive changes)
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { apiGate } from "../api/gate.ts";
import { currentPackage, packagePath } from "../lib/workspace.ts";
import { checkSchemas, writeSchemas } from "../schemas/snapshots.ts";

const [command, sub] = process.argv.slice(2);
const pkg = currentPackage();
const dir = packagePath(pkg);

function finish(problems: readonly string[], ok: string): never {
  if (problems.length === 0) {
    console.log(`✓ ${ok}`);
    process.exit(0);
  }
  console.error(`✗ ${pkg.name}`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

switch (command) {
  case "api":
    finish(apiGate(pkg), `${pkg.name}: public surface`);
    break;
  case "schemas": {
    if (!existsSync(join(dir, "scripts/wire-schemas.ts")))
      finish([], `${pkg.name}: no wire schemas`);
    if (sub === "write") finish(await writeSchemas(pkg, dir), `${pkg.name}: schemas written`);
    if (sub === "check")
      finish(await checkSchemas(pkg, dir), `${pkg.name}: schemas current and additive`);
    console.error("usage: mostra-tools schemas <check|write>");
    process.exit(2);
    break;
  }
  default:
    console.error("usage: mostra-tools <api|schemas check|schemas write>");
    process.exit(2);
}
