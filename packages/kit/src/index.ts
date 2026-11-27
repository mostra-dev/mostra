/**
 * `@mostra/kit`: Mostra's kit (D26, D27, D181). Its parts are files more than exports: the
 * per-base registry (`registry/base/`, `registry/radix/`) that `@/components/ui/<name>` resolves
 * into when the artifact has no copy of its own, and that `mostra add <name>` copies; Mostra's own
 * modules, `@mostra/kit/questionnaire`, `@mostra/kit/layout`, `@mostra/kit/review`, `@mostra/kit/demo` and `@mostra/kit/action`, the same in either base; and
 * `kit.css`, the utilities every theme's stylesheet builds on. Themes are `@mostra/themes`.
 *
 * @packageDocumentation
 */

/** The kit's own modules, each `@mostra/kit/<name>` and the registry item `mostra-<name>`. */
export const KIT_MODULES: readonly ["questionnaire", "layout", "review", "demo", "action"] = [
  "questionnaire",
  "layout",
  "review",
  "demo",
  "action",
];

/** The shadcn bases the kit carries a registry for (D27); `base`, Base UI, is the default (D72). */
export const KIT_BASES: readonly ["base", "radix"] = ["base", "radix"];
