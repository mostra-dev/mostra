/**
 * `@mostra/protocol/plugin`: the plugin system's rules as data and pure functions (D30, D31,
 * INTERFACES §14), for the instance, the CLI and tools. Nothing here does I/O:
 * - the extension contracts this release implements, and the IDs and commands that are Mostra's;
 * - the plugin manifest (the `"mostra"` key of `package.json`) and its checks;
 * - source pack items (shadcn's `registry-item.json` with a `mostra` block) and their addresses;
 * - SPDX license expressions, license classes and which need an acknowledgment.
 *
 * Its own entry, so the browser packages that import `@mostra/protocol` never carry the SPDX
 * License List.
 */

export {
  BUILT_IN_EXPORTERS,
  CONTRACT_NAMES,
  CORE_COMMANDS,
  type ContractInfo,
  type ContributesKey,
  coreCommandTaken,
  PLUGIN_CONTRACTS,
  stampServed,
} from "./plugin/contracts.ts";
export {
  ACKNOWLEDGED_CLASSES,
  formatLicenseExpression,
  isLicenseRef,
  type LicenseExpression,
  LicenseExpressionError,
  type LicenseTerm,
  licenseTerms,
  packageLicense,
  packageLicenseTerms,
  parseLicenseExpression,
  SPDX_LICENSE_LIST_VERSION,
  type SpdxEntry,
  spdxClass,
  spdxLicense,
  unreadableLicenseRef,
} from "./plugin/license.ts";
export {
  type BundledLicense,
  CONTRACT_OF_KEY,
  CONTRIBUTION_ID,
  checkPluginManifest,
  type ManifestCheck,
  type ManifestIssue,
  manifestScopes,
  PACKAGE_PATH,
  PLUGIN_EFFECTS,
  PLUGIN_MANIFEST_REVISION,
  PLUGIN_NAME,
  PLUGIN_PLATFORMS,
  type PluginCommandEntry,
  type PluginContributes,
  type PluginEntry,
  type PluginExample,
  type PluginManifest,
  PluginManifestSchema,
  type PluginPackEntry,
  type PluginThemeEntry,
  pluginManifestRegistry,
} from "./plugin/manifest.ts";
export {
  PACK_VARIABLES,
  type PackAddress,
  type PackMostraBlock,
  packVariables,
  parsePackAddress,
  type Registry,
  type RegistryCssValue,
  type RegistryCssVars,
  type RegistryFile,
  type RegistryFont,
  type RegistryItem,
  RegistryItemSchema,
  RegistrySchema,
} from "./plugin/registry-item.ts";
export type { ContractName, LicenseClass, PluginScope } from "./plugins.ts";
