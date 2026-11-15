/**
 * Diagnostic codes of the PACK area: source packs, shadcn registry items copied into an artifact (D30, EX-03).
 */
import type { AreaCatalog } from "../spec.ts";

/** The codes of the PACK area, in the order they were added. */
export const packDiagnosticCodes = [
  "MOSTRA_PACK_ADDRESS_INVALID",
  "MOSTRA_PACK_ITEM_NOT_FOUND",
  "MOSTRA_PACK_ITEM_INVALID",
  "MOSTRA_PACK_FETCH_FAILED",
  "MOSTRA_PACK_OFFLINE",
  "MOSTRA_PACK_TARGET_INVALID",
  "MOSTRA_PACK_FILE_EXISTS",
  "MOSTRA_PACK_CSS_UNIMPORTED",
  "MOSTRA_PACK_NOT_APPLIED",
  // gen:codes
] as const;

/** The codes of the PACK area. */
export type PackDiagnosticCode = (typeof packDiagnosticCodes)[number];

/** The PACK area's catalog entries. */
export const packDiagnostics: AreaCatalog<PackDiagnosticCode> = {
  MOSTRA_PACK_ADDRESS_INVALID: {
    severity: "error",
    phase: "host",
    title: "Item address not understood",
    hint: "Use an item URL, a local .json item, owner/repo/item for GitHub, or an @namespace/item your components.json registers.",
    docs: {
      explanation:
        "`mostra add` reads an item address in shadcn's forms: an `https:` URL of an item's JSON, a path to a local `.json` item, a GitHub item (`owner/repo/item[#ref]`), or `@namespace/item` resolved through the `registries` of the artifact's `components.json`. A bare name in an item's `registryDependencies` means shadcn's own registry. This address is none of those, or names a namespace the artifact doesn't register, or a plain `http:` URL to another machine.",
      fix: 'Correct the address, or add the namespace to `registries` in the artifact\'s `components.json` (`"@acme": "https://registry.acme.com/r/{name}.json"`).',
    },
  },
  MOSTRA_PACK_ITEM_NOT_FOUND: {
    severity: "error",
    phase: "network",
    title: "Registry item not found",
    hint: "Check the address; for a GitHub item, check the repository's registry.json and the ref.",
    docs: {
      explanation:
        "The registry answered that the item doesn't exist (HTTP 404), the local file isn't there, or a GitHub repository's root `registry.json` has no item by that name. The message names the address and where Mostra looked.",
      fix: "Correct the address. For a GitHub item, `owner/repo/item` names an item of the repository's root `registry.json`, at its default branch unless `#ref` says otherwise.",
    },
  },
  MOSTRA_PACK_ITEM_INVALID: {
    severity: "error",
    phase: "manifest",
    title: "Registry item invalid",
    hint: "Fix the field this diagnostic names in the item's JSON.",
    docs: {
      explanation:
        "The item isn't a shadcn registry item Mostra can install: it isn't JSON, misses `name` or `type`, a file has no `path`, a `registry:file` or `registry:page` has no `target`, a file has neither `content` nor a path its registry holds, or the `mostra` block has a wrong value. Every field shadcn's schema allows is accepted, and unknown keys are kept.",
      fix: "Correct the item (its JSON Schema is `https://ui.shadcn.com/schema/registry-item.json`, plus the `mostra` block in `@mostra/protocol/schemas/plugin-manifest.schema.json`).",
    },
  },
  MOSTRA_PACK_FETCH_FAILED: {
    severity: "error",
    phase: "network",
    title: "Registry item couldn't be read",
    hint: "Check the network and the registry, then run the command again.",
    docs: {
      explanation:
        "Reading the item failed: the registry couldn't be reached, answered an error other than 404, sent more than 8 MiB, took longer than 30 s, or redirected to an address Mostra doesn't follow. Nothing was written.",
      fix: "Run the command again once the registry answers. Behind a proxy, set `HTTPS_PROXY` for the Mostra daemon.",
    },
  },
  MOSTRA_PACK_OFFLINE: {
    severity: "error",
    phase: "network",
    title: "Registry item unavailable offline",
    hint: "Connect to the network, or add the item from a local .json file.",
    docs: {
      explanation:
        "Mostra is offline (`MOSTRA_OFFLINE` is set, or no network interface is up), and the item, or one of its registry dependencies, is on a remote registry. Nothing was written.",
      fix: "Run the command again with the network up, or download the item and add it from its file: `mostra add ./item.json --artifact <path>`.",
    },
  },
  MOSTRA_PACK_TARGET_INVALID: {
    severity: "error",
    phase: "host",
    title: "Item file outside the artifact",
    hint: "Ask the item's author to fix its target; Mostra writes an item's files only inside the artifact.",
    docs: {
      explanation:
        "A file of the item would land outside the artifact's directory (`../`, an absolute path), on a name not every system can hold (`<>:\"|?*`, a Windows device name, a trailing dot or space), on Mostra's own files, or on two names that differ only in case. Nothing was written.",
      fix: "Use a corrected item, or copy the files you need into the artifact yourself.",
    },
  },
  MOSTRA_PACK_FILE_EXISTS: {
    severity: "error",
    phase: "host",
    title: "File already exists",
    hint: "Run the command again with `--overwrite` to replace the files the message lists, or move them first.",
    docs: {
      explanation:
        "The artifact already has files where the item writes, with other content. Mostra never replaces an artifact's file without being asked, as shadcn asks before it overwrites; nothing was written.",
      fix: "Add `--overwrite` to replace them (`mostra add <item> --artifact <path> --overwrite`), or rename your files and add the item again.",
    },
  },
  MOSTRA_PACK_CSS_UNIMPORTED: {
    severity: "warning",
    phase: "compile",
    title: "Item CSS not imported",
    hint: "Import the stylesheet this diagnostic names from the artifact's entry.",
    docs: {
      explanation:
        "The item brings CSS variables or rules, which Mostra wrote into a stylesheet of the artifact, but the artifact's entry doesn't import that stylesheet, so the page doesn't load them yet. Mostra writes into the stylesheet the entry imports when there is one (or the one `components.json` names), and creates `styles.css` otherwise.",
      fix: 'Add `import "./styles.css";` (the path the message names) to the artifact\'s entry, after any other stylesheet.',
    },
  },
  MOSTRA_PACK_NOT_APPLIED: {
    severity: "hint",
    phase: "host",
    title: "Item part not applied",
    hint: "Read what the item asked for and apply it yourself if the artifact needs it.",
    docs: {
      explanation:
        "The item asks for something an artifact doesn't have: environment variables (`envVars`; server code reads secrets with `secret()`, set by `mostra secret set`), a Tailwind 3 configuration (`tailwind.config`; Tailwind 4 reads `cssVars.theme`), a font through `next/font`, or a design-system configuration (`registry:base`, `registry:style`). Mostra installs the rest and lists these.",
      fix: "Set the secrets the item's server code needs with `mostra secret set NAME`, and move any Tailwind 3 theme into the item's `cssVars.theme` or your stylesheet's `@theme`.",
    },
  },
  // gen:entries
};
