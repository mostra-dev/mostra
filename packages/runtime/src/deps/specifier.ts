/**
 * Package names and specs (D95): what an import specifier names, and what `deps/add` accepts.
 */
import { builtinModules } from "node:module";
import semver from "semver";

/** npm's package-name rules, with the capitals that packages published before 2017 may have. */
const NAME = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-zA-Z0-9][a-zA-Z0-9._~-]*$/;
const BUILTINS: ReadonlySet<string> = new Set(builtinModules);

/** Packages an artifact imports that are provided outside its lockfile. */
const PROVIDED: ReadonlySet<string> = new Set([
  // The worker provides it to server code (WP-08); the server bundle keeps it external.
  "@mostra/server",
]);

/** Whether `name` is a valid npm package name. */
export function isPackageName(name: string): boolean {
  return name.length <= 214 && NAME.test(name);
}

/**
 * The npm package an import specifier names, or `undefined` for a specifier that isn't a package
 * import: relative and absolute paths, the `@/` alias, URLs and other schemes, subpath imports
 * (`#…`), Node built-ins, Vite's virtual modules and packages provided outside the lockfile.
 */
export function packageOf(specifier: string): string | undefined {
  const bare = specifier.split("?")[0] ?? specifier;
  if (bare === "" || bare.startsWith(".") || bare.startsWith("/") || bare.startsWith("#")) {
    return undefined;
  }
  if (bare.startsWith("@/") || bare.startsWith("\0") || /^[a-z][a-z0-9+.-]*:/i.test(bare)) {
    return undefined;
  }
  const parts = bare.split("/");
  const name = bare.startsWith("@") ? parts.slice(0, 2).join("/") : (parts[0] ?? "");
  if (BUILTINS.has(name) || PROVIDED.has(name) || !isPackageName(name)) return undefined;
  return name;
}

/** A parsed registry spec: `name`, `name@version`, `name@range` or `name@tag`. */
export interface PackageSpec {
  readonly name: string;
  /** The version, range or tag after `@`; absent for a bare name. */
  readonly range?: string;
  /** Set when `range` is one exact version, which installs whatever its age (D95). */
  readonly exact?: string;
}

/** Parses a `deps/add` spec, or returns `undefined` when it isn't a registry spec. */
export function parseSpec(spec: string): PackageSpec | undefined {
  const text = spec.trim();
  const at = text.indexOf("@", text.startsWith("@") ? 1 : 0);
  const name = at === -1 ? text : text.slice(0, at);
  const range = at === -1 ? undefined : text.slice(at + 1);
  if (!isPackageName(name)) return undefined;
  if (range === undefined) return { name };
  if (range === "") return undefined;
  const exact = semver.valid(range);
  if (exact !== null) return { name, range: exact, exact };
  // A semver range, or a dist-tag (`latest`, `next`, `beta`).
  if (semver.validRange(range) === null && !/^[a-z][a-z0-9._-]*$/i.test(range)) return undefined;
  return { name, range };
}
