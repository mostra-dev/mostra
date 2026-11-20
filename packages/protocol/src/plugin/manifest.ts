/**
 * The plugin manifest (D30, ROUND-3 §6.2, EX-02): the `"mostra"` key of a plugin's
 * `package.json`. Its Zod schema is the source of the published JSON Schema
 * (`schemas/plugin-manifest.schema.json`); {@link checkPluginManifest} adds what a schema can't
 * say (a contract each contribution kind needs, unique IDs, license expressions) and reports every
 * problem it finds, each with the path of the field, so `mostra plugin validate` names them all.
 */
import * as z from "zod";
import {
  ContractName,
  type ContractName as ContractNameType,
  LicenseClass,
  type LicenseClass as LicenseClassType,
} from "../plugins.ts";
import {
  CONTRACT_NAMES,
  type ContributesKey,
  coreCommandTaken,
  PLUGIN_CONTRACTS,
} from "./contracts.ts";
import {
  ACKNOWLEDGED_CLASSES,
  isLicenseRef,
  LicenseExpressionError,
  parseLicenseExpression,
} from "./license.ts";

/**
 * The dated revision of the manifest's schema (and of pack items'), published with it; within it
 * the schema only grows, as the host protocol's does (D32).
 */
export const PLUGIN_MANIFEST_REVISION = "2026-11-14";

/** The registry of the manifest's schemas: its own JSON Schema bundle, apart from the protocol's. */
export const pluginManifestRegistry: z.core.$ZodRegistry<{ id?: string; description?: string }> =
  z.registry<{ id?: string; description?: string }>();

/** The pattern of a manifest's `name`: `<namespace>/<name>`, the namespace in reverse-DNS form. */
export const PLUGIN_NAME: RegExp =
  /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+\/[a-z0-9][a-z0-9._-]{0,63}$/;

/** The pattern of a contribution's ID (each contract package's `CONTRIBUTION_ID`). */
export const CONTRIBUTION_ID: RegExp = /^[a-z0-9][a-z0-9._-]{0,63}$/;

/** A path inside the plugin's package: `./`-relative, `/`-separated, never leaving it. */
export const PACKAGE_PATH: RegExp = /^\.\/(?!.*(?:^|\/)\.\.?(?:\/|$))[^\\:*?"<>|\0]+$/;

/** The effects a plugin may declare (D30): disclosure, never enforced. */
export const PLUGIN_EFFECTS: readonly string[] = [
  "network",
  "filesystem",
  "process",
  "credentials",
  "sends-data",
];

/** The systems a plugin may name, as Node.js names them. */
export const PLUGIN_PLATFORMS: readonly string[] = ["darwin", "linux", "win32"];

/** One contribution that loads from a module of the package. */
export interface PluginEntry {
  /** Its ID: what `--as`, a component or a review anchor names. */
  readonly id: string;
  /** The module that exports it: `./dist/pdf.js`. */
  readonly entry: string;
  /** The export that holds it; `default` when absent. */
  readonly export?: string;
}

/** A CLI command contribution. */
export interface PluginCommandEntry {
  /** Its words after `mostra`, joined by spaces: `term record`. */
  readonly command: string;
  /** The module that exports it: `./dist/index.js`. */
  readonly entry: string;
  /** The export that holds the definition; `default` when absent. */
  readonly export?: string;
}

/** A source pack the plugin carries: a registry item file in its package. */
export interface PluginPackEntry {
  /** The item: `./registry/terminal-demo.json`. */
  readonly item: string;
}

/**
 * A theme the plugin carries (D179 item 4): a theme layer as JSON in its package, the
 * `ThemeLayer` of `@mostra/themes` (schema `@mostra/themes/theme.schema.json`), whose faces'
 * files are the package's own. An artifact that installs the plugin may name it in `kit.theme`.
 */
export interface PluginThemeEntry {
  /** The theme file: `./themes/brand.json`. */
  readonly theme: string;
}

/** What a plugin contributes, by kind. */
export interface PluginContributes {
  /** Embed engines (`@mostra/contract-embed-engine`). */
  readonly embedEngines?: readonly PluginEntry[];
  /** Exporters (`@mostra/contract-exporter`). */
  readonly exporters?: readonly PluginEntry[];
  /** Verify checks (`@mostra/contract-verify-check`). */
  readonly verifyChecks?: readonly PluginEntry[];
  /** Anchor providers (`@mostra/contract-anchor-provider`). */
  readonly anchorProviders?: readonly PluginEntry[];
  /** Connectors (`@mostra/contract-connector`). */
  readonly connectors?: readonly PluginEntry[];
  /** CLI commands (`@mostra/contract-cli-command`). */
  readonly cliCommands?: readonly PluginCommandEntry[];
  /** Source packs it carries: registry items in the package. */
  readonly packs?: readonly PluginPackEntry[];
  /** Themes it carries, which an artifact's `kit.theme` may name (D179 item 4). */
  readonly themes?: readonly PluginThemeEntry[];
}

/** A license the plugin brings with it, declared so Mostra can disclose it before install. */
export interface BundledLicense {
  /** The npm package (or bundled engine) under it. */
  readonly package: string;
  /** Its SPDX expression: `MIT`, `LicenseRef-Remotion`. */
  readonly license: string;
  /** For a `LicenseRef-`: `source-available` or `proprietary`. */
  readonly class?: LicenseClassType;
  /** One line on its terms, shown at install. */
  readonly summary?: string;
  /** Where its full text is. */
  readonly url?: string;
}

/** A plugin's example and the baselines it verifies against. */
export interface PluginExample {
  /** Its ID: lower-case letters, digits, `.`, `_` and `-`. */
  readonly id: string;
  /** The example artifact: `./examples/htop`. */
  readonly path: string;
  /** Its committed baselines: `./baselines/htop`. */
  readonly baselines?: string;
}

/** The `"mostra"` key of a plugin's `package.json`. */
export interface PluginManifest {
  /** `<namespace>/<name>`, the namespace in reverse-DNS form: `dev.acme/pdf`. */
  readonly name: string;
  /** A short name for people. */
  readonly title?: string;
  /** One sentence on what it does, for people and agents. */
  readonly description?: string;
  /** A semver range per contract it implements: `{ "exporter": "^0.1.0" }`. */
  readonly contracts: Partial<Record<ContractNameType, string>>;
  /** What it contributes, by kind. */
  readonly contributes: PluginContributes;
  /** What it does beyond computing (`network`, `filesystem` …): declared, never enforced. */
  readonly effects?: readonly string[];
  /** The plugin's own license, as an SPDX expression. */
  readonly license: string;
  /** Licenses of what it brings along: engines, assets, dependencies. */
  readonly bundledLicenses?: readonly BundledLicense[];
  /** Agent Skills that teach agents to use it: `./skills/pdf`. */
  readonly skills?: readonly string[];
  /** Example artifacts, each verified against its baselines. */
  readonly examples?: readonly PluginExample[];
  /** The systems it runs on; absent means all of Mostra's. */
  readonly platforms?: readonly string[];
}

const packagePath = z.string().regex(PACKAGE_PATH, "a ./-relative path inside the package");
const exportName = z.string().regex(/^[A-Za-z_$][\w$]*$/, "a JavaScript export name");

const PluginEntrySchema: z.ZodType<PluginEntry> = z
  .looseObject({
    id: z.string().regex(CONTRIBUTION_ID, "lower-case letters, digits, '.', '_' and '-' (1 to 64)"),
    entry: packagePath,
    export: exportName.exactOptional(),
  })
  .register(pluginManifestRegistry, { id: "PluginEntry" });

const PluginCommandEntrySchema: z.ZodType<PluginCommandEntry> = z
  .looseObject({
    command: z
      .string()
      .regex(
        /^[a-z][a-z0-9-]{0,31}(?: [a-z][a-z0-9-]{0,31}){0,3}$/,
        "one to four lower-case words separated by single spaces",
      ),
    entry: packagePath,
    export: exportName.exactOptional(),
  })
  .register(pluginManifestRegistry, { id: "PluginCommandEntry" });

const PluginPackEntrySchema: z.ZodType<PluginPackEntry> = z
  .looseObject({ item: packagePath })
  .register(pluginManifestRegistry, { id: "PluginPackEntry" });

const PluginThemeEntrySchema: z.ZodType<PluginThemeEntry> = z
  .looseObject({ theme: packagePath })
  .register(pluginManifestRegistry, { id: "PluginThemeEntry" });

const entries = PluginEntrySchema.array().readonly().exactOptional();

const PluginContributesSchema: z.ZodType<PluginContributes> = z
  .looseObject({
    embedEngines: entries,
    exporters: entries,
    verifyChecks: entries,
    anchorProviders: entries,
    connectors: entries,
    cliCommands: PluginCommandEntrySchema.array().readonly().exactOptional(),
    packs: PluginPackEntrySchema.array().readonly().exactOptional(),
    // Read leniently within the manifest's revision (D32): `contributes.themes` was an unknown
    // key, accepted with a warning, before WP-18, so any value still validates; each entry that
    // is one is a theme, and the rules below warn about the rest, which are ignored.
    themes: z
      .unknown()
      .transform((value): readonly PluginThemeEntry[] =>
        Array.isArray(value)
          ? value.filter((item) => PluginThemeEntrySchema.safeParse(item).success)
          : [],
      )
      .exactOptional(),
  })
  .register(pluginManifestRegistry, { id: "PluginContributes" });

const BundledLicenseSchema: z.ZodType<BundledLicense> = z
  .looseObject({
    package: z.string().min(1).max(214),
    license: z.string().min(1).max(512),
    class: LicenseClass.exactOptional(),
    summary: z.string().max(400).exactOptional(),
    url: z.url().exactOptional(),
  })
  .register(pluginManifestRegistry, { id: "BundledLicense" });

const PluginExampleSchema: z.ZodType<PluginExample> = z
  .looseObject({
    id: z.string().regex(CONTRIBUTION_ID),
    path: packagePath,
    baselines: packagePath.exactOptional(),
  })
  .register(pluginManifestRegistry, { id: "PluginExample" });

/** The Zod schema of the `PluginManifest` type, open to keys a later release adds. */
export const PluginManifestSchema: z.ZodType<PluginManifest> = z
  .looseObject({
    name: z.string().regex(PLUGIN_NAME, "<namespace>/<name>, the namespace in reverse-DNS form"),
    title: z.string().min(1).max(80).exactOptional(),
    description: z.string().max(400).exactOptional(),
    contracts: z.partialRecord(ContractName, z.string().min(1).max(128)),
    contributes: PluginContributesSchema,
    effects: z.array(z.string()).readonly().exactOptional(),
    license: z.string().min(1).max(512),
    bundledLicenses: BundledLicenseSchema.array().readonly().exactOptional(),
    skills: packagePath.array().readonly().exactOptional(),
    examples: PluginExampleSchema.array().readonly().exactOptional(),
    platforms: z.array(z.string()).readonly().exactOptional(),
  })
  .register(pluginManifestRegistry, {
    id: "PluginManifest",
    description:
      'The "mostra" key of a Mostra plugin\'s package.json (D30): its name, contract ranges, contributions, declared effects and licenses.',
  });

/** One problem with a manifest, at a path under `package.json` (`["mostra", "contracts"]`). */
export interface ManifestIssue {
  /** Its path, relative to the package or registry. */
  readonly path: readonly (string | number)[];
  /** How serious it is: `error` fails the check, `warning` and `hint` inform. */
  readonly severity: "error" | "warning";
  /** What it found, in plain words. */
  readonly message: string;
}

/** What {@link checkPluginManifest} found. */
export interface ManifestCheck {
  /** The manifest, when it has no error. */
  readonly manifest?: PluginManifest;
  /** Every problem, errors and warnings, in the order of the manifest. */
  readonly issues: readonly ManifestIssue[];
}

const KNOWN_KEYS: Readonly<Record<string, readonly string[]>> = {
  manifest: [
    "$schema",
    "name",
    "title",
    "description",
    "contracts",
    "contributes",
    "effects",
    "license",
    "bundledLicenses",
    "skills",
    "examples",
    "platforms",
  ],
  contributes: [...CONTRACT_NAMES.map((name) => PLUGIN_CONTRACTS[name].key), "packs", "themes"],
  entry: ["id", "entry", "export", "title"],
  command: ["command", "entry", "export"],
  pack: ["item"],
  theme: ["theme"],
  license: ["package", "license", "class", "summary", "url"],
  example: ["id", "path", "baselines"],
};

/** The contract each `contributes` key's contributions implement. */
export const CONTRACT_OF_KEY: Readonly<Record<ContributesKey, ContractNameType>> =
  Object.fromEntries(CONTRACT_NAMES.map((name) => [PLUGIN_CONTRACTS[name].key, name])) as Record<
    ContributesKey,
    ContractNameType
  >;

/**
 * Checks the `"mostra"` key of a `package.json` (`value`), reporting every problem with its path.
 * Unknown keys are warnings, so manifests grow additively; everything Mostra can't load is an
 * error.
 */
export function checkPluginManifest(value: unknown): ManifestCheck {
  const issues: ManifestIssue[] = [];
  const at = (...path: (string | number)[]): (string | number)[] => ["mostra", ...path];
  const error = (message: string, ...path: (string | number)[]): void => {
    issues.push({ path: at(...path), severity: "error", message });
  };
  const warn = (message: string, ...path: (string | number)[]): void => {
    issues.push({ path: at(...path), severity: "warning", message });
  };
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    error("The mostra key must be an object: the plugin's manifest.");
    return { issues };
  }
  const parsed = PluginManifestSchema.safeParse(value);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const path = issue.path.filter(
        (part): part is string | number => typeof part === "string" || typeof part === "number",
      );
      if (issue.code === "unrecognized_keys") {
        // Only `contracts` is closed: a contract this release doesn't implement can't load.
        for (const key of issue.keys) {
          error(
            `Mostra implements no contract "${key}"; it implements ${CONTRACT_NAMES.join(", ")}.`,
            ...path,
            key,
          );
        }
      } else error(issueMessage(issue), ...path);
    }
  }
  const raw = value as Record<string, unknown>;
  const unknownKeys = (object: unknown, known: readonly string[], ...path: (string | number)[]) => {
    if (typeof object !== "object" || object === null || Array.isArray(object)) return;
    for (const key of Object.keys(object)) {
      if (!known.includes(key)) {
        warn(`This Mostra release doesn't know the key "${key}"; it is ignored.`, ...path, key);
      }
    }
  };
  unknownKeys(raw, KNOWN_KEYS["manifest"] ?? []);
  unknownKeys(raw["contributes"], KNOWN_KEYS["contributes"] ?? [], "contributes");
  const contributes = (raw["contributes"] ?? {}) as Record<string, unknown>;
  for (const [key, list] of Object.entries(contributes)) {
    if (!Array.isArray(list)) continue;
    list.forEach((item, index) => {
      const known =
        key === "cliCommands"
          ? KNOWN_KEYS["command"]
          : key === "packs"
            ? KNOWN_KEYS["pack"]
            : key === "themes"
              ? KNOWN_KEYS["theme"]
              : KNOWN_KEYS["entry"];
      unknownKeys(item, known ?? [], "contributes", key, index);
    });
  }
  // Theme entries the lenient read leaves out (D179 item 4).
  const themes = (raw["contributes"] as Record<string, unknown> | undefined)?.["themes"];
  if (themes !== undefined) {
    if (!Array.isArray(themes)) {
      warn(
        'contributes.themes is a list of { "theme": "./themes/<name>.json" }; it is ignored.',
        "contributes",
        "themes",
      );
    } else {
      themes.forEach((item, index) => {
        if (!PluginThemeEntrySchema.safeParse(item).success) {
          warn(
            'A theme entry is { "theme": "./themes/<name>.json" }, a path inside the package; this one is ignored.',
            "contributes",
            "themes",
            index,
          );
        }
      });
    }
  }
  if (Array.isArray(raw["bundledLicenses"])) {
    raw["bundledLicenses"].forEach((item, index) => {
      unknownKeys(item, KNOWN_KEYS["license"] ?? [], "bundledLicenses", index);
    });
  }
  if (Array.isArray(raw["examples"])) {
    raw["examples"].forEach((item, index) => {
      unknownKeys(item, KNOWN_KEYS["example"] ?? [], "examples", index);
    });
  }
  // The rules beyond the schema run on what the manifest holds even when part of it is wrong, so
  // one run reports every invalid field (EX-02); each looks only at values of the right type.
  const view = lenientView(raw);
  // Each kind of contribution needs its contract, and IDs are unique per contract.
  let contributions = 0;
  for (const name of CONTRACT_NAMES) {
    const key = PLUGIN_CONTRACTS[name].key;
    const list = view.contributes[key];
    if (list === undefined) continue;
    contributions += list.length;
    if (list.length > 0 && !view.contracts.has(name)) {
      error(
        `contributes.${key} needs the contract it implements: add "${name}" with a range to contracts.`,
        "contributes",
        key,
      );
    }
    const seen = new Map<string, number>();
    list.forEach((item, index) => {
      const id = key === "cliCommands" ? item["command"] : item["id"];
      if (typeof id !== "string") return;
      const first = seen.get(id);
      if (first !== undefined) {
        error(
          `"${id}" is contributed twice (also at contributes.${key}[${first}]).`,
          "contributes",
          key,
          index,
        );
      } else seen.set(id, index);
      if (key === "cliCommands") {
        const taken = coreCommandTaken(id.split(" "));
        if (taken !== undefined) {
          error(
            `"mostra ${id}" would collide with Mostra's own "mostra ${taken.join(" ")}".`,
            "contributes",
            key,
            index,
            "command",
          );
        }
      }
    });
  }
  for (const name of view.contracts) {
    const key = PLUGIN_CONTRACTS[name].key;
    if ((view.contributes[key]?.length ?? 0) === 0) {
      warn(
        `The manifest declares the ${name} contract but contributes nothing to it.`,
        "contracts",
        name,
      );
    }
  }
  if (
    view.contributesObject &&
    contributions === 0 &&
    (view.contributes["packs"]?.length ?? 0) === 0 &&
    (view.contributes["themes"]?.length ?? 0) === 0
  ) {
    error("The plugin contributes nothing: add an entry to contributes.", "contributes");
  }
  // Licenses: the plugin's own, and each bundled one, must be expressions Mostra can read.
  if (typeof raw["license"] === "string") {
    try {
      parseLicenseExpression(raw["license"]);
    } catch (problem) {
      if (!(problem instanceof LicenseExpressionError)) throw problem;
      error(
        `${problem.message} Use an SPDX expression, or LicenseRef-<name> for another license.`,
        "license",
      );
    }
  }
  view.bundledLicenses.forEach((bundled, index) => {
    const license = bundled["license"];
    if (typeof license === "string") {
      try {
        parseLicenseExpression(license);
      } catch (problem) {
        if (!(problem instanceof LicenseExpressionError)) throw problem;
        error(problem.message, "bundledLicenses", index, "license");
      }
    }
    const licenseClass = bundled["class"];
    if (typeof licenseClass === "string" && typeof license === "string") {
      if (!isLicenseRef(license)) {
        error(
          "class applies only to a LicenseRef-: Mostra classes SPDX licenses from the SPDX License List itself.",
          "bundledLicenses",
          index,
          "class",
        );
      } else if (
        !ACKNOWLEDGED_CLASSES.has(licenseClass as LicenseClass) ||
        licenseClass === "unknown"
      ) {
        error(
          'A LicenseRef- is never OSI-approved: its class is "source-available" or "proprietary".',
          "bundledLicenses",
          index,
          "class",
        );
      }
    }
  });
  view.effects.forEach((effect, index) => {
    if (typeof effect === "string" && !PLUGIN_EFFECTS.includes(effect)) {
      warn(
        `This Mostra release doesn't know the effect "${effect}" (it knows ${PLUGIN_EFFECTS.join(", ")}); it is shown as declared.`,
        "effects",
        index,
      );
    }
  });
  view.platforms.forEach((platform, index) => {
    if (typeof platform === "string" && !PLUGIN_PLATFORMS.includes(platform)) {
      warn(
        `"${platform}" isn't a system Mostra runs on (${PLUGIN_PLATFORMS.join(", ")}).`,
        "platforms",
        index,
      );
    }
  });
  if (!parsed.success) return { issues };
  const manifest = parsed.data;
  return issues.some((issue) => issue.severity === "error") ? { issues } : { manifest, issues };
}

/** What the rules beyond the schema read of a manifest, whatever its shape. */
interface LenientView {
  /** The contracts it declares, by a name Mostra implements (any range). */
  readonly contracts: ReadonlySet<ContractNameType>;
  readonly contributesObject: boolean;
  /** Each kind's list of objects. */
  readonly contributes: Readonly<Record<string, readonly Record<string, unknown>[]>>;
  readonly bundledLicenses: readonly Record<string, unknown>[];
  readonly effects: readonly unknown[];
  readonly platforms: readonly unknown[];
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function lenientView(raw: Record<string, unknown>): LenientView {
  const contracts = new Set<ContractNameType>();
  if (isObject(raw["contracts"])) {
    for (const key of Object.keys(raw["contracts"])) {
      if ((CONTRACT_NAMES as readonly string[]).includes(key))
        contracts.add(key as ContractNameType);
    }
  }
  const contributes: Record<string, Record<string, unknown>[]> = {};
  if (isObject(raw["contributes"])) {
    for (const [key, list] of Object.entries(raw["contributes"])) {
      if (Array.isArray(list)) contributes[key] = list.filter(isObject);
    }
  }
  return {
    contracts,
    contributesObject: isObject(raw["contributes"]),
    contributes,
    bundledLicenses: Array.isArray(raw["bundledLicenses"])
      ? raw["bundledLicenses"].filter(isObject)
      : [],
    effects: Array.isArray(raw["effects"]) ? raw["effects"] : [],
    platforms: Array.isArray(raw["platforms"]) ? raw["platforms"] : [],
  };
}

/** A Zod issue in the manifest's words. */
function issueMessage(issue: z.core.$ZodIssue): string {
  if (issue.code === "invalid_type") {
    return issue.input === undefined
      ? `This field is required (${issue.expected}).`
      : `Expected ${issue.expected}.`;
  }
  if (issue.code === "invalid_value") {
    return `Expected one of ${issue.values.map((value) => JSON.stringify(value)).join(", ")}.`;
  }
  if (issue.code === "invalid_format" && issue.format === "regex") {
    return `Expected ${issue.message.replace(/^Invalid string: must match pattern .*$/, "the documented form")}.`;
  }
  return issue.message;
}

/** Where a plugin with this manifest may be installed: every scope its contracts allow. */
export function manifestScopes(manifest: PluginManifest): readonly ("artifact" | "home")[] {
  const kinds = CONTRACT_NAMES.filter(
    (name) => (manifest.contributes[PLUGIN_CONTRACTS[name].key]?.length ?? 0) > 0,
  );
  // Packs and themes belong to the artifact that uses them (D172 item 4, D179 item 4).
  const packs =
    (manifest.contributes.packs?.length ?? 0) > 0 || (manifest.contributes.themes?.length ?? 0) > 0;
  const home = !packs && kinds.every((name) => PLUGIN_CONTRACTS[name].scopes.includes("home"));
  return home ? ["artifact", "home"] : ["artifact"];
}
