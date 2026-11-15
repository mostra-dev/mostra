---
"@mostra/runtime": patch
---

The release age (a day, for a package resolved without an exact version) no longer holds back the extension contracts' packages, `@mostra/contract-*`, wherever they sit in a plugin's tree: a plugin built on a contract released today installs today (D173). A release too young that a named package depends on is now refused with words that say it installs once it is a day old, rather than advising to name it exactly.
