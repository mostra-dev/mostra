# Plugins and packs: other people's components, exporters and commands

Two kinds of extension reach an artifact. A **pack** is source you copy in: a shadcn registry item (a component, a block, a hook), whose files become the artifact's own and are yours to edit. A **plugin** is an npm package with a `"mostra"` manifest that Mostra loads: an exporter, a CLI command, an engine a component mounts, a verify check. Both install into one artifact and are recorded in its lockfile, so its versions carry them.

## Contents

- Copy an item in: `mostra add`
- Install a plugin: `mostra plugin add`
- Licenses that need an acknowledgment
- Use what a plugin contributes
- Write a plugin

## Copy an item in: `mostra add`

`mostra add` takes the kit's part names and shadcn's addresses as well as npm packages, and installs any shadcn registry item as shadcn would. A bare name the kit has (`button`, `mostra-questionnaire`) is the kit's part for the artifact's base; any other bare name, or one with a version (`button@1`), is an npm package:

| Address | Example |
|---|---|
| A part of the kit, by name | `mostra add button dialog --artifact <dir>` |
| An item's URL | `mostra add https://ui.shadcn.com/r/styles/new-york-v4/login-01.json --artifact <dir>` |
| A GitHub repository's registry | `mostra add acme/ui/date-field#v1.2.0 --artifact <dir>` |
| A namespace `components.json` registers | `mostra add @acme/date-field --artifact <dir>` |
| A local item | `mostra add ./items/date-field.json --artifact <dir>` |
| A pack an installed plugin carries | `mostra add plugin:mostra-pack-acme/date-field --artifact <dir>` |

The item's registry dependencies come with it, its files land where shadcn puts them (`components/ui/`, `components/`, `lib/`, `hooks/`, or its `target`), its npm packages join the lockfile, and its CSS joins the stylesheet your entry imports. Nothing is written until every file is checked. A file you already have with other content stops the install: add `--overwrite` to replace it. A page item (`registry:page`) lands in `pages/` when the artifact has one. *Done when* the files are listed in the output and `mostra verify <dir>` passes with them imported.

Read the notes `mostra add` prints. An item's environment variables become secrets (`mostra secret set NAME --artifact <dir>`), and a stylesheet your entry doesn't import yet needs its `import "./styles.css";`.

## Install a plugin: `mostra plugin add`

```sh
mostra plugin add mostra-plugin-pdf --artifact <dir>
mostra plugin list --artifact <dir>
mostra plugin remove mostra-plugin-pdf --artifact <dir>
```

Mostra checks each plugin before it records anything: the contract versions it needs are ones this release implements, no other plugin of the artifact contributes the same ID, every entry exports a definition stamped with its contract, and every license it brings is disclosed. `verify` and `publish` check the artifact's plugins again, so a plugin this release can't load is reported before a version is made. A plugin of only exporters and CLI commands may be installed for every artifact of the home with `--global` in place of `--artifact`.

## Licenses that need an acknowledgment

An install that brings a source-available or proprietary license, or one Mostra can't read, stops with `MOSTRA_LICENSE_UNACCEPTED`, naming each license, its class and the packages under it. That is disclosure, not a refusal: tell the person what the license asks (its summary and link are in the message) and, once they agree, repeat the command the diagnostic's fix gives, with `--accept-license <id>` for each license. The acknowledgment is recorded in the artifact's lockfile and needs no repeat. A `mostra add <package>` that upgrades a plugin, or changes what one depends on, is checked the same way and takes the same flag. A host may accept licenses for its home, in which case none of this stops you. OSI-approved, public-domain and other free licenses need nothing.

## Use what a plugin contributes

- An exporter: `mostra export <dir> --as <id> --out <path>`, with `--option name=value` for each option its schema takes (a value is read as JSON when it parses).
- A CLI command: run `mostra` followed by its words, from the artifact's directory (or anywhere, for the home's plugins). `mostra plugin list` names each one.
- An engine or a connector: import the plugin's package in the page or in `live.ts`, as its README shows.
- An anchor provider: nothing to import. Every page of the artifact registers the anchor providers its plugins contribute, so comments on their content anchor in their terms.
- A theme: name its ID in the artifact's stack (`kit: { theme: "acme-dark" }`, or after a built-in one); `mostra theme list --artifact <dir>` lists it beside Mostra's.

## Write a plugin

A plugin is an npm package whose `package.json` has a `"mostra"` manifest and whose entries export what one of the contract packages' `define*` functions returns: `@mostra/contract-exporter`, `-cli-command`, `-connector`, `-embed-engine`, `-anchor-provider` or `-verify-check`. Each package's README has a complete example. A theme is a JSON file the manifest lists under `contributes.themes` (`[{ "theme": "./themes/acme.json" }]`), in the form `@mostra/themes/theme.schema.json` describes: every color in light and dark by role, the faces with their files in the package, and any of the kit's tokens. `mostra plugin validate <dir>` reports every problem with its place in `package.json`. *Done when* it says `valid`.
