/**
 * License expressions and classes (D31, EX-04): what Mostra shows about a plugin's or a pack's
 * licenses at install, and which of them need a one-time acknowledgment. An SPDX expression is
 * parsed (SPDX 3.0 Annex B: `AND`, `OR`, `WITH`, `+`, parentheses, `LicenseRef-` and
 * `DocumentRef-`), each license in it is classed from the SPDX License List's own flags, and an
 * `OR` takes the branch that needs the fewest acknowledgments, as the person installing may choose.
 */
import type { LicenseClass } from "../plugins.ts";
import { SPDX_EXCEPTIONS, SPDX_LICENSES } from "./spdx.generated.ts";

export { SPDX_LICENSE_LIST_VERSION } from "./spdx.generated.ts";

/** The classes whose licenses need `--accept-license` (or a host's pre-acceptance) at install. */
export const ACKNOWLEDGED_CLASSES: ReadonlySet<LicenseClass> = new Set([
  "source-available",
  "proprietary",
  "unknown",
]);

/**
 * OSI-approved licenses that ask derivative or combined works to stay under them (copyleft,
 * strong or weak), by family: everything else OSI-approved is `osi-permissive`. Either class
 * needs no acknowledgment; the difference is shown.
 */
const COPYLEFT =
  /^(?:A?GPL|LGPL|MPL|EPL|EUPL|CDDL|CPL|OSL|RPL|SPL|Sleepycat|MS-RL|CECILL|CPAL|APSL|QPL|RPSL|NPOSL|SimPL|Watcom|IPL|OSET-PL|Motosoto|Nokia|LPL|CUA-OPL|ErlPL|SISSL|eCos|Interbase|NGPL|EFL|OCLC|LiLiQ-R|AFL)(?:[-.]|$)/;

/**
 * Dedications to the public domain, and licenses that ask nothing at all: none needs an
 * acknowledgment, OSI-approved or not (CC0 never was).
 */
const PUBLIC_DOMAIN: ReadonlySet<string> = new Set([
  "CC0-1.0",
  "PDDL-1.0",
  "CC-PDDC",
  "CC-PDM-1.0",
  "Unlicense",
  "0BSD",
  "WTFPL",
  "MIT-0",
]);

/** A license of the SPDX License List, as {@link spdxLicense} finds it. */
export interface SpdxEntry {
  /** Its SPDX ID, in the List's own case. */
  readonly id: string;
  /** OSI-approved, as the List flags it. */
  readonly osi: boolean;
  /** Free (libre) by the FSF, as the List flags it. */
  readonly free: boolean;
}

let byLowerCase: Map<string, SpdxEntry> | undefined;
let exceptionsByLowerCase: Map<string, string> | undefined;

/** An SPDX license ID in its canonical case with its flags, or `undefined` for one the list lacks. */
export function spdxLicense(id: string): SpdxEntry | undefined {
  if (byLowerCase === undefined) {
    byLowerCase = new Map();
    for (const entry of SPDX_LICENSES) {
      const at = entry.lastIndexOf(":");
      const licenseId = entry.slice(0, at);
      const flags = entry.slice(at + 1);
      byLowerCase.set(licenseId.toLowerCase(), {
        id: licenseId,
        osi: flags.includes("o"),
        free: flags.includes("f"),
      });
    }
  }
  return byLowerCase.get(id.toLowerCase());
}

/** An SPDX exception ID in its canonical case, or `undefined`. */
function spdxException(id: string): string | undefined {
  exceptionsByLowerCase ??= new Map(SPDX_EXCEPTIONS.map((entry) => [entry.toLowerCase(), entry]));
  return exceptionsByLowerCase.get(id.toLowerCase());
}

/** The pattern of a license reference: `LicenseRef-<idstring>`, optionally `DocumentRef-<idstring>:` first. */
const LICENSE_REF = /^(?:DocumentRef-[A-Za-z0-9.-]+:)?LicenseRef-[A-Za-z0-9.-]+$/;

/** Whether `id` is a license reference (never OSI-approved: it names a license only its author knows). */
export function isLicenseRef(id: string): boolean {
  return LICENSE_REF.test(id);
}

/** A parsed SPDX license expression. */
export type LicenseExpression =
  | { readonly kind: "license"; readonly id: string; readonly orLater: boolean }
  | { readonly kind: "ref"; readonly id: string }
  | { readonly kind: "with"; readonly license: LicenseExpression; readonly exception: string }
  | {
      readonly kind: "and" | "or";
      readonly left: LicenseExpression;
      readonly right: LicenseExpression;
    };

/** Why an expression didn't parse. */
export class LicenseExpressionError extends Error {
  /** `LicenseExpressionError`. */
  override readonly name = "LicenseExpressionError";
}

/**
 * Parses an SPDX license expression. License and exception IDs take their canonical case;
 * operators are read in either case, as npm's ecosystem writes them.
 *
 * @throws LicenseExpressionError naming what isn't valid.
 */
export function parseLicenseExpression(text: string): LicenseExpression {
  const tokens = text.match(/\(|\)|[^\s()]+/g) ?? [];
  if (tokens.length === 0) throw new LicenseExpressionError("The license expression is empty.");
  let at = 0;
  const peek = (): string | undefined => tokens[at];
  const operator = (word: string | undefined): string | undefined => {
    const upper = word?.toUpperCase();
    return upper === "AND" || upper === "OR" || upper === "WITH" ? upper : undefined;
  };
  const simple = (): LicenseExpression => {
    const token = tokens[at++];
    if (token === undefined) throw new LicenseExpressionError("The expression ends too early.");
    if (token === "(") {
      const inner = or();
      if (tokens[at++] !== ")") throw new LicenseExpressionError("A parenthesis isn't closed.");
      return inner;
    }
    if (token === ")" || operator(token) !== undefined) {
      throw new LicenseExpressionError(`"${token}" can't start a license.`);
    }
    if (isLicenseRef(token)) return { kind: "ref", id: token };
    const orLater = token.endsWith("+");
    const bare = orLater ? token.slice(0, -1) : token;
    const known = spdxLicense(bare);
    if (known === undefined) {
      throw new LicenseExpressionError(
        `"${token}" isn't an SPDX license ID or a LicenseRef- reference.`,
      );
    }
    return { kind: "license", id: known.id, orLater };
  };
  const withExpression = (): LicenseExpression => {
    const license = simple();
    if (operator(peek()) !== "WITH") return license;
    at += 1;
    const token = tokens[at++];
    const exception =
      token === undefined
        ? undefined
        : (spdxException(token) ??
          (/^(?:DocumentRef-[A-Za-z0-9.-]+:)?AdditionRef-[A-Za-z0-9.-]+$/.test(token)
            ? token
            : undefined));
    if (exception === undefined) {
      throw new LicenseExpressionError(`"${token ?? ""}" isn't an SPDX license exception.`);
    }
    if (license.kind !== "license" && license.kind !== "ref") {
      throw new LicenseExpressionError("WITH applies to one license.");
    }
    return { kind: "with", license, exception };
  };
  const and = (): LicenseExpression => {
    let left = withExpression();
    while (operator(peek()) === "AND") {
      at += 1;
      left = { kind: "and", left, right: withExpression() };
    }
    return left;
  };
  const or = (): LicenseExpression => {
    let left = and();
    while (operator(peek()) === "OR") {
      at += 1;
      left = { kind: "or", left, right: and() };
    }
    return left;
  };
  const expression = or();
  if (at < tokens.length) {
    throw new LicenseExpressionError(`"${tokens[at]}" doesn't belong where it is.`);
  }
  return expression;
}

/** The canonical text of an expression. */
export function formatLicenseExpression(expression: LicenseExpression, nested = false): string {
  switch (expression.kind) {
    case "license":
      return `${expression.id}${expression.orLater ? "+" : ""}`;
    case "ref":
      return expression.id;
    case "with":
      return `${formatLicenseExpression(expression.license)} WITH ${expression.exception}`;
    default: {
      const text = `${formatLicenseExpression(expression.left, expression.kind === "and")} ${expression.kind.toUpperCase()} ${formatLicenseExpression(expression.right, expression.kind === "and")}`;
      return nested && expression.kind === "or" ? `(${text})` : text;
    }
  }
}

/** One license an expression comes down to, with its class. */
export interface LicenseTerm {
  /** The license's ID: an SPDX ID or a `LicenseRef-` reference, which `--accept-license` names. */
  readonly id: string;
  /** Its class (D31). */
  readonly class: LicenseClass;
}

/** The class of one SPDX license ID (canonical case). */
export function spdxClass(id: string): LicenseClass {
  const known = spdxLicense(id);
  if (known === undefined) return "unknown";
  if (PUBLIC_DOMAIN.has(known.id)) return "public-domain";
  if (known.osi) return COPYLEFT.test(known.id) ? "osi-copyleft" : "osi-permissive";
  if (known.free) return "free";
  return "source-available";
}

/**
 * What an expression comes down to: every license that applies, each with its class. A
 * reference's class is `declared(id)` (what the plugin's manifest says of it, never an OSI class)
 * or `unknown`. An `OR` keeps the branch that needs the fewest acknowledgments, then the first.
 */
export function licenseTerms(
  expression: LicenseExpression,
  declared: (id: string) => LicenseClass | undefined = () => undefined,
): readonly LicenseTerm[] {
  const needs = (terms: readonly LicenseTerm[]): number =>
    terms.filter((term) => ACKNOWLEDGED_CLASSES.has(term.class)).length;
  const walk = (node: LicenseExpression): LicenseTerm[] => {
    switch (node.kind) {
      case "license":
        return [{ id: node.id, class: spdxClass(node.id) }];
      case "ref": {
        const declaredClass = declared(node.id);
        return [
          {
            id: node.id,
            class:
              declaredClass !== undefined && ACKNOWLEDGED_CLASSES.has(declaredClass)
                ? declaredClass
                : "unknown",
          },
        ];
      }
      case "with":
        return walk(node.license);
      case "and": {
        const terms = [...walk(node.left)];
        for (const term of walk(node.right)) {
          if (!terms.some((other) => other.id === term.id)) terms.push(term);
        }
        return terms;
      }
      case "or": {
        const left = walk(node.left);
        const right = walk(node.right);
        return needs(right) < needs(left) ? right : left;
      }
    }
  };
  return walk(expression);
}

/**
 * The license reference Mostra gives a package whose license it can't read (no `license` field,
 * `SEE LICENSE IN …`, a string that isn't an expression), so `--accept-license` can still name
 * it: `LicenseRef-npm-<name>` with the name's `@` and `/` as `-`.
 */
export function unreadableLicenseRef(packageName: string): string {
  return `LicenseRef-npm-${packageName.replace(/^@/, "").replace(/[^A-Za-z0-9.-]/g, "-")}`;
}

/**
 * The license expression a package's `package.json` declares: `license` (a string, or the old
 * `{ type }` form) or the old `licenses` array (each an alternative), or `undefined`.
 */
export function packageLicense(manifest: {
  readonly license?: unknown;
  readonly licenses?: unknown;
}): string | undefined {
  const text = (value: unknown): string | undefined =>
    typeof value === "string"
      ? value
      : typeof value === "object" &&
          value !== null &&
          typeof (value as { type?: unknown }).type === "string"
        ? (value as { type: string }).type
        : undefined;
  const single = text(manifest.license);
  if (single !== undefined) return single.trim();
  if (Array.isArray(manifest.licenses)) {
    const all = manifest.licenses.map(text).filter((value) => value !== undefined);
    if (all.length > 0) return all.length === 1 ? all[0] : `(${all.join(" OR ")})`;
  }
  return undefined;
}

/**
 * The terms of a package's license field: its expression's, or, for a field Mostra can't read,
 * one `unknown` term under {@link unreadableLicenseRef} (`UNLICENSED`, npm's word for "no license
 * granted", is `proprietary`).
 */
export function packageLicenseTerms(
  packageName: string,
  license: string | undefined,
  declared?: (id: string) => LicenseClass | undefined,
): readonly LicenseTerm[] {
  if (license === "UNLICENSED") {
    return [{ id: unreadableLicenseRef(packageName), class: "proprietary" }];
  }
  if (license !== undefined) {
    try {
      return licenseTerms(parseLicenseExpression(license), declared);
    } catch (error) {
      if (!(error instanceof LicenseExpressionError)) throw error;
    }
  }
  return [{ id: unreadableLicenseRef(packageName), class: "unknown" }];
}
