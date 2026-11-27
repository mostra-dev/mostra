/**
 * `@mostra/kit`: Mostra's kit (D26, D27, D181). Its parts are files more than exports: the
 * per-base registry (`registry/base/`, `registry/radix/`) that `@/components/ui/<name>` resolves
 * into when the artifact has no copy of its own, and that `mostra add <name>` copies; Mostra's own
 * modules (`@mostra/kit/<module>`, each listed in {@link KIT_MODULES}), the same in either base:
 * the questionnaire, the page's layout, review sets, the library parts (charts, the live chart,
 * ECharts, tables, Mermaid, React Flow, code, math, maps, 3D scenes and whiteboards, WP-19), the
 * team's parts, web demos and action buttons (WP-24); and `kit.css`, the utilities every theme's
 * stylesheet builds on. Themes are `@mostra/themes`.
 *
 * @packageDocumentation
 */

/**
 * The kit's own modules, each `@mostra/kit/<name>` and the registry item `mostra-<name>`. Those in
 * {@link KIT_ON_DEMAND_MODULES} import libraries that install on demand (D65).
 */
export const KIT_MODULES: readonly [
  "questionnaire",
  "layout",
  "review",
  "tokens",
  "page-context",
  "live-chart",
  "charts",
  "echarts",
  "data-table",
  "mermaid",
  "flow",
  "code",
  "math",
  "map",
  "scene",
  "whiteboard",
  "team",
  "demo",
  "action",
] = [
  "questionnaire",
  "layout",
  "review",
  "tokens",
  "page-context",
  "live-chart",
  "charts",
  "echarts",
  "data-table",
  "mermaid",
  "flow",
  "code",
  "math",
  "map",
  "scene",
  "whiteboard",
  "team",
  "demo",
  "action",
];

/** The kit modules whose libraries aren't in the warm set: MapLibre with deck.gl, three.js, Excalidraw. */
export const KIT_ON_DEMAND_MODULES: readonly ["map", "scene", "whiteboard"] = [
  "map",
  "scene",
  "whiteboard",
];

/** The shadcn bases the kit carries a registry for (D27); `base`, Base UI, is the default (D72). */
export const KIT_BASES: readonly ["base", "radix"] = ["base", "radix"];
