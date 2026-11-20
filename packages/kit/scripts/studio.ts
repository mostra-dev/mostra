/**
 * The kit's changes to the shadcn items it pins, the same for both bases (D27: two bases cost CI
 * time, not duplicate code). They move every part onto the kit's token contract (D181 item 3), so
 * a theme's shape, depth, surfaces and type reach it, and give the parts the motion and states the
 * built-in themes are designed around. Each change must still find its place in the pinned items:
 * the generator fails on one that no longer does, so a newer shadcn can't silently drop it.
 *
 * - `CLASS_RULES` change the classes of every class list that matches a part's role (a floating
 *   surface, a menu item, a field), across every item: one rule restyles all 65.
 * - `CLASS_CHANGES` replace a whole class string of one part (the button's sizes, the card).
 * - `FILE_CHANGES` adapt what an item assumes about its project, or take the kit's own file
 *   (`parts/<base>/…`) where the part needs more than classes (the tabs' moving indicator).
 */
import { readFileSync } from "node:fs";

/** A class rule: which class lists it applies to, and what it does to their classes. */
export interface ClassRule {
  readonly name: string;
  /** Whether a class list is this rule's: its classes, and the installed file it is in. */
  readonly when: (classes: ReadonlySet<string>, file: string) => boolean;
  /** Each class to replace (`null` drops it), applied where the class is present. */
  readonly map: Readonly<Record<string, string | null>>;
  /** Classes to add when the rule applies. */
  readonly add?: readonly string[];
}

const has = (classes: ReadonlySet<string>, ...names: string[]): boolean =>
  names.every((name) => classes.has(name));
const hasAny = (classes: ReadonlySet<string>, ...names: string[]): boolean =>
  names.some((name) => classes.has(name));

/** Drops shadcn's own depth from a surface: the kit's shadow tokens carry edge and depth. */
const DEPTH: Readonly<Record<string, null>> = {
  "ring-1": null,
  "ring-foreground/10": null,
  shadow: null,
  "shadow-sm": null,
  "shadow-md": null,
  "shadow-lg": null,
  "shadow-xl": null,
};

/** The highlight of a menu's current item, by pointer or keys. */
const MENU_HIGHLIGHT: Readonly<Record<string, string>> = {
  "focus:bg-accent": "focus:bg-(--menu-highlight)",
  "focus:text-accent-foreground": "focus:text-(--menu-highlight-fg)",
  "focus:**:text-accent-foreground": "focus:**:text-(--menu-highlight-fg)",
  "not-data-[variant=destructive]:focus:**:text-accent-foreground":
    "not-data-[variant=destructive]:focus:**:text-(--menu-highlight-fg)",
  "data-highlighted:bg-accent": "data-highlighted:bg-(--menu-highlight)",
  "data-highlighted:text-accent-foreground": "data-highlighted:text-(--menu-highlight-fg)",
  "not-data-[variant=destructive]:data-highlighted:**:text-accent-foreground":
    "not-data-[variant=destructive]:data-highlighted:**:text-(--menu-highlight-fg)",
  "data-open:bg-accent": "data-open:bg-(--menu-highlight)",
  "data-open:text-accent-foreground": "data-open:text-(--menu-highlight-fg)",
  "data-popup-open:bg-accent": "data-popup-open:bg-(--menu-highlight)",
  "data-popup-open:text-accent-foreground": "data-popup-open:text-(--menu-highlight-fg)",
};

export const CLASS_RULES: readonly ClassRule[] = [
  {
    // Dialogs: the theme's dialog radius and padding, the popover's depth.
    name: "dialog surface",
    when: (c) =>
      has(c, "bg-popover", "fixed", "-translate-x-1/2") && hasAny(c, "ring-1", "shadow-lg"),
    map: {
      ...DEPTH,
      "rounded-xl": "rounded-(--dialog-radius)",
      "p-4": "p-(--dialog-pad)",
      "gap-4": "gap-5",
      "text-sm": "text-[0.9375rem]",
      "duration-100": "duration-150",
    },
    add: ["shadow-popover"],
  },
  {
    // Menus, popovers, select lists, hover cards, toasts: the popover's radius and depth.
    name: "floating surface",
    when: (c) =>
      c.has("bg-popover") &&
      !c.has("fixed") &&
      hasAny(c, "ring-1", "shadow-md", "shadow-lg", "shadow") &&
      !c.has("opacity-0"),
    map: {
      ...DEPTH,
      "rounded-lg": "rounded-popover",
      "rounded-xl": "rounded-popover",
      "rounded-2xl": "rounded-popover",
      border: null,
      "p-1": "p-(--menu-pad)",
    },
    add: ["shadow-popover"],
  },
  {
    // Sheets and drawers: a panel at the window's edge, with the popover's depth.
    name: "edge panel",
    when: (c) =>
      c.has("bg-popover") && c.has("fixed") && !c.has("-translate-x-1/2") && c.has("shadow-lg"),
    map: { ...DEPTH },
    add: ["shadow-popover"],
  },
  {
    // Menu items of every menu: the theme's highlight, a radius concentric with the menu, room.
    name: "menu item",
    when: (c) =>
      (c.has("cursor-default") || c.has("group/menubar-item")) &&
      hasAny(c, "focus:bg-accent", "data-highlighted:bg-accent"),
    map: {
      ...MENU_HIGHLIGHT,
      "rounded-md": "rounded-(--menu-item-radius)",
      "rounded-sm": "rounded-(--menu-item-radius)",
      "py-1": "py-2",
      "px-1.5": "px-2.5",
      "pl-1.5": "pl-2.5",
      "pr-1.5": "pr-2.5",
      "text-sm": "text-[0.9375rem]",
    },
  },
  {
    // Fields people type in or pick from: the theme's field, edge, radius and height.
    name: "field",
    when: (c) =>
      c.has("border-input") &&
      c.has("rounded-lg") &&
      hasAny(c, "h-8", "min-h-8", "min-h-16", "field-sizing-content", "data-[size=default]:h-8"),
    map: {
      "rounded-lg": "rounded-control",
      "bg-transparent": "bg-(--field)",
      "h-8": "h-(--control-h)",
      "min-h-8": "min-h-(--control-h)",
      "min-h-16": "min-h-24",
      "px-2.5": "px-3.5",
      "pl-2.5": "pl-3.5",
      "py-1": null,
      "dark:bg-input/30": null,
      "md:text-sm": null,
      "transition-colors": "transition-[border-color,box-shadow]",
      "data-[size=default]:h-8": "data-[size=default]:h-(--control-h)",
      "data-[size=sm]:h-7": "data-[size=sm]:h-(--control-h-sm)",
      "focus-visible:ring-ring/50": "focus-visible:ring-ring/30",
    },
    add: ["shadow-control", "duration-(--state-ms)"],
  },
  {
    // Cards: the theme's card radius and depth, and its spacing.
    name: "card",
    when: (c) => c.has("group/card"),
    map: {
      ...DEPTH,
      "rounded-xl": "rounded-card",
      "py-(--card-spacing)": "pt-(--card-pad-top) pb-(--card-pad-bottom)",
      "[--card-spacing:--spacing(4)]": "[--card-spacing:var(--card-gap)]",
      "*:[img:first-child]:rounded-t-xl": "*:[img:first-child]:rounded-t-card",
      "*:[img:last-child]:rounded-b-xl": "*:[img:last-child]:rounded-b-card",
    },
    add: ["shadow-card"],
  },
  {
    // A card's parts: inset by the theme's card padding.
    name: "card part",
    when: (c, file) => file === "components/ui/card.tsx" && c.has("px-(--card-spacing)"),
    map: {
      "px-(--card-spacing)": "px-(--card-pad-x)",
      "rounded-t-xl": "rounded-t-card",
    },
  },
];

/** Whole class strings of one part, as shadcn writes them, and what the kit writes instead. */
export const CLASS_CHANGES: readonly (readonly [from: string, to: string])[] = [
  // A tinted badge's text: its tone mixed toward the text colour, so it holds 4.5:1 on its own
  // tint over any card (the tone alone is 4.5:1 on the card, not on the tint).
  [
    '"bg-destructive/10 text-destructive focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:focus-visible:ring-destructive/40 [a]:hover:bg-destructive/20"',
    '"bg-destructive/10 text-[color-mix(in_oklab,var(--destructive)_72%,var(--foreground))] focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:focus-visible:ring-destructive/40 [a]:hover:bg-destructive/20"',
  ],
  // The card's content: inset as its header and footer are (a single class, which the rules,
  // reading class lists, leave alone).
  ['cn("px-(--card-spacing)", className)', 'cn("px-(--card-pad-x)", className)'],
  // The button: the theme's radius, depth and heights, the press, and hover by mixing.
  [
    "group/button inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
    "group/button press inline-flex shrink-0 items-center justify-center rounded-button border bg-clip-padding font-medium whitespace-nowrap outline-none select-none focus-visible:ring-3 focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  ],
  [
    "bg-primary text-primary-foreground hover:bg-primary/80",
    "border-transparent bg-primary text-primary-foreground shadow-button hover:bg-[color-mix(in_oklab,var(--primary),var(--foreground)_14%)]",
  ],
  [
    "border-border bg-background hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50",
    "border-(--button-outline-border) bg-(--button-outline-bg) text-foreground shadow-control hover:bg-muted aria-expanded:bg-muted",
  ],
  [
    "bg-secondary text-secondary-foreground hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] aria-expanded:bg-secondary aria-expanded:text-secondary-foreground",
    "border-transparent bg-secondary text-secondary-foreground hover:bg-[color-mix(in_oklab,var(--secondary),var(--foreground)_6%)] aria-expanded:bg-secondary aria-expanded:text-secondary-foreground",
  ],
  [
    "hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:hover:bg-muted/50",
    "border-transparent text-foreground hover:bg-muted aria-expanded:bg-muted",
  ],
  [
    "bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:hover:bg-destructive/30 dark:focus-visible:ring-destructive/40",
    "border-transparent bg-destructive text-destructive-foreground hover:bg-[color-mix(in_oklab,var(--destructive),var(--foreground)_14%)] focus-visible:ring-destructive/30",
  ],
  [
    "h-8 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
    "h-(--control-h) gap-2 px-5 text-[0.9375rem] has-data-[icon=inline-end]:pr-4 has-data-[icon=inline-start]:pl-4",
  ],
  [
    "h-6 gap-1 rounded-[min(var(--radius-md),10px)] px-2 text-xs in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
    "h-7 gap-1 px-2.5 text-xs has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 [&_svg:not([class*='size-'])]:size-3",
  ],
  [
    "h-7 gap-1 rounded-[min(var(--radius-md),12px)] px-2.5 text-[0.8rem] in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
    "h-(--control-h-sm) gap-1.5 px-3.5 text-sm has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3 [&_svg:not([class*='size-'])]:size-3.5",
  ],
  [
    "h-9 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
    "h-12 gap-2 px-7 text-base has-data-[icon=inline-end]:pr-6 has-data-[icon=inline-start]:pl-6",
  ],
  ['icon: "size-8"', 'icon: "size-(--control-h)"'],
  // Each variant names its own edge, so a variant used without `cn` (`buttonVariants(…)` on a
  // link or a trigger) never meets a base edge it would have to override.
  [
    'link: "text-primary underline-offset-4 hover:underline",\n      },\n      size: {',
    'link: "border-transparent text-primary underline-offset-4 hover:underline",\n      },\n      size: {',
  ],
  [
    "size-6 rounded-[min(var(--radius-md),10px)] in-data-[slot=button-group]:rounded-lg [&_svg:not([class*='size-'])]:size-3",
    "size-7 [&_svg:not([class*='size-'])]:size-3",
  ],
  [
    "size-7 rounded-[min(var(--radius-md),12px)] in-data-[slot=button-group]:rounded-lg",
    "size-(--control-h-sm)",
  ],
  ['"icon-lg": "size-9"', '"icon-lg": "size-12"'],

  // The badge: the theme's badge radius, a little taller and bolder.
  [
    "group/badge inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-4xl border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-all",
    "group/badge inline-flex h-6 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-badge border border-transparent px-2.5 text-xs font-semibold whitespace-nowrap transition-colors",
  ],

  // A card's title: the theme's card title face, size and weight.
  [
    "font-heading text-base leading-snug font-medium group-data-[size=sm]/card:text-sm",
    "font-(family-name:--card-title-font) text-(length:--card-title-size) leading-snug font-(--card-title-weight) group-data-[size=sm]/card:text-base",
  ],
  // A card's footer: a rule above it, the card's own ground.
  [
    "flex items-center rounded-b-xl border-t bg-muted/50 p-(--card-spacing)",
    "flex items-center gap-3 border-t px-(--card-pad-x) pt-(--card-gap) pb-(--card-pad-bottom)",
  ],

  // Dialogs: the footer sits in the dialog, the title in the theme's heading face.
  [
    "-mx-4 -mb-4 flex flex-col-reverse gap-2 rounded-b-xl border-t bg-muted/50 p-4 sm:flex-row sm:justify-end",
    "flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end",
  ],
  [
    "-mx-4 -mb-4 flex flex-col-reverse gap-2 rounded-b-xl border-t bg-muted/50 p-4 group-data-[size=sm]/alert-dialog-content:grid group-data-[size=sm]/alert-dialog-content:grid-cols-2 sm:flex-row sm:justify-end",
    "flex flex-col-reverse gap-2 pt-1 group-data-[size=sm]/alert-dialog-content:grid group-data-[size=sm]/alert-dialog-content:grid-cols-2 sm:flex-row sm:justify-end",
  ],
  [
    "font-heading text-base leading-none font-medium",
    "font-heading text-(length:--dialog-title-size) leading-tight font-(--heading-weight) tracking-(--heading-tracking)",
  ],
  [
    "font-heading text-base font-medium sm:group-data-[size=default]/alert-dialog-content:group-has-data-[slot=alert-dialog-media]/alert-dialog-content:col-start-2",
    "font-heading text-(length:--dialog-title-size) leading-tight font-(--heading-weight) tracking-(--heading-tracking) sm:group-data-[size=default]/alert-dialog-content:group-has-data-[slot=alert-dialog-media]/alert-dialog-content:col-start-2",
  ],
  ['className="absolute top-2 right-2"', 'className="absolute top-3 right-3"'],
  // A select's list: inset by the menu's padding, as every menu's items are.
  [
    "<SelectPrimitive.List>{children}</SelectPrimitive.List>",
    '<SelectPrimitive.List className="p-(--menu-pad)">{children}</SelectPrimitive.List>',
  ],
  [
    '"data-[position=popper]:h-(--radix-select-trigger-height) data-[position=popper]:w-full data-[position=popper]:min-w-(--radix-select-trigger-width)",',
    '"p-(--menu-pad) data-[position=popper]:h-(--radix-select-trigger-height) data-[position=popper]:w-full data-[position=popper]:min-w-(--radix-select-trigger-width)",',
  ],
];

/** The kit's own file for a part, where it needs more than classes. */
const part = (base: string, path: string): string =>
  readFileSync(new URL(`../parts/${base}/${path}`, import.meta.url), "utf8");

/** How a page's appearance reaches the toaster: Mostra's, not `next-themes`'. */
const SONNER_APPEARANCE = `import * as React from "react"

/** The page's appearance as Mostra sets it on \`<html data-appearance>\`, else the device's. */
function useAppearance(): ToasterProps["theme"] {
  const read = (): ToasterProps["theme"] => {
    const value = typeof document === "undefined" ? undefined : document.documentElement.dataset["appearance"]
    return value === "light" || value === "dark" ? value : "system"
  }
  const [appearance, setAppearance] = React.useState(read)
  React.useEffect(() => {
    const observer = new MutationObserver(() => setAppearance(read()))
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-appearance"] })
    return () => observer.disconnect()
  }, [])
  return appearance
}
`;

/** Whole-file changes by installed path, given the base. */
export const FILE_CHANGES: Readonly<Record<string, (code: string, base: string) => string>> = {
  // The Base UI item imports React and never uses it (TS6133 under an artifact's own
  // `noUnusedLocals`; VERIFIED_FACTS, kit components).
  "components/ui/scroll-area.tsx": (code, base) =>
    base === "base" ? code.replace(/^import \* as React from "react"\n/m, "") : code,
  // An artifact has no `next-themes`: the toaster follows the page's appearance instead.
  "components/ui/sonner.tsx": (code) => {
    const out = code
      .replace('import { useTheme } from "next-themes"\n', "")
      .replace(/(import \{[^}]*\} from "lucide-react"\n)/, `$1\n${SONNER_APPEARANCE}`)
      .replace('  const { theme = "system" } = useTheme()\n', "  const theme = useAppearance()\n")
      .replace('theme={theme as ToasterProps["theme"]}', "theme={theme}");
    if (out.includes("next-themes") || !out.includes("useAppearance()")) {
      throw new Error("sonner.tsx no longer reads its theme the way the kit's change expects.");
    }
    return out;
  },
  // The tabs: an indicator that moves to the chosen tab rather than jumping (Base UI's own
  // indicator; for Radix, the kit measures the active tab), in the theme's shape.
  "components/ui/tabs.tsx": (code, base) => {
    if (!code.includes("tabsListVariants")) {
      throw new Error("tabs.tsx no longer has the API the kit's tabs keep.");
    }
    return part(base, "components/ui/tabs.tsx");
  },
  // The badge: the variants a status needs besides shadcn's, in the theme's colours.
  "components/ui/badge.tsx": (code) => {
    const anchor = '        link: "text-primary underline-offset-4 hover:underline",\n';
    if (!code.includes(anchor)) throw new Error("badge.tsx no longer has its link variant.");
    return code.replace(
      anchor,
      `${anchor}        accent: "bg-accent text-accent-foreground",\n        success: "bg-success/12 text-[color-mix(in_oklab,var(--success)_72%,var(--foreground))]",\n        warning: "bg-warning/12 text-[color-mix(in_oklab,var(--warning)_72%,var(--foreground))]",\n`,
    );
  },
  // Radix's slider names its root, while a screen reader meets its thumbs (role slider): the
  // name given to the slider (`aria-label`, `aria-labelledby`) is each thumb's too.
  "components/ui/slider.tsx": (code, base) => {
    if (base !== "radix") return code;
    const params = "  max = 100,\n  ...props\n}";
    const thumb = '        <SliderPrimitive.Thumb\n          data-slot="slider-thumb"\n';
    if (!code.includes(params) || !code.includes(thumb)) {
      throw new Error("slider.tsx (Radix) no longer has its props or its thumbs where expected.");
    }
    return code
      .replace(
        params,
        '  max = 100,\n  "aria-label": ariaLabel,\n  "aria-labelledby": ariaLabelledBy,\n  ...props\n}',
      )
      .replace(
        thumb,
        `${thumb}          aria-label={ariaLabel}\n          aria-labelledby={ariaLabelledBy}\n`,
      );
  },
  // A table wider than the page scrolls in its own frame, which the keyboard must reach too
  // (axe's scrollable-region-focusable): it takes the focus.
  "components/ui/table.tsx": (code) => {
    const anchor = '      data-slot="table-container"\n';
    if (!code.includes(anchor)) throw new Error("table.tsx no longer has its container.");
    return code.replace(anchor, `${anchor}      tabIndex={0}\n`);
  },
};

/**
 * Every double-quoted string literal, matched left to right so each pairs its own quotes; those
 * holding two or more names of Tailwind's shape are class lists.
 */
const STRING = /"((?:[^"\\\n]|\\.)*)"/g;
const CLASS_NAME = /^[!-~]+$/;

/**
 * Applies the kit's changes to one file of an item, recording which changes found their place
 * (`used`), so the generator can fail on one that no longer does.
 */
export function restyle(code: string, file: string, used: Map<string, number>): string {
  let out = code;
  for (const [from, to] of CLASS_CHANGES) {
    if (!out.includes(from)) continue;
    used.set(from, (used.get(from) ?? 0) + out.split(from).length - 1);
    out = out.split(from).join(to);
  }
  return out.replace(STRING, (literal, text: string) => {
    const names = text.split(/[ \t]+/).filter((name) => name !== "");
    if (names.length < 2 || !names.every((name) => CLASS_NAME.test(name))) return literal;
    let classes = names;
    let changed = false;
    for (const rule of CLASS_RULES) {
      if (!rule.when(new Set(classes), file)) continue;
      used.set(`rule: ${rule.name}`, (used.get(`rule: ${rule.name}`) ?? 0) + 1);
      changed = true;
      const next: string[] = [];
      for (const name of classes) {
        const mapped = Object.hasOwn(rule.map, name) ? rule.map[name] : name;
        if (mapped !== null && mapped !== undefined && !next.includes(mapped)) next.push(mapped);
      }
      for (const name of rule.add ?? []) if (!next.includes(name)) next.push(name);
      classes = next;
    }
    return changed ? `"${classes.join(" ")}"` : literal;
  });
}

/** Every change's key, for the generator's check that each still finds its place. */
export const CHANGE_KEYS: readonly string[] = [
  ...CLASS_CHANGES.map(([from]) => from),
  ...CLASS_RULES.map((rule) => `rule: ${rule.name}`),
];
