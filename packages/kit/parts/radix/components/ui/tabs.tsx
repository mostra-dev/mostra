"use client";

import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "cn";
import { Tabs as TabsPrimitive } from "radix-ui";
import * as React from "react";

function Tabs({
  className,
  orientation = "horizontal",
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      data-orientation={orientation}
      className={cn("group/tabs flex gap-3 data-horizontal:flex-col", className)}
      {...props}
    />
  );
}

const tabsListVariants = cva(
  "group/tabs-list relative isolate inline-flex w-fit items-center text-muted-foreground group-data-vertical/tabs:h-fit group-data-vertical/tabs:flex-col",
  {
    variants: {
      variant: {
        default:
          "rounded-(--tabs-radius) bg-(--tabs-track-bg) p-(--tabs-track-pad) shadow-(--tabs-track-shadow)",
        line: "gap-1 shadow-[inset_0_-1px_0_var(--border)]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

/**
 * Where the active tab is inside its list, as Base UI's tab indicator gives it
 * (`--active-tab-left`, `-top`, `-width`, `-height`), so the indicator moves to it.
 */
function useActiveTab(list: React.RefObject<HTMLDivElement | null>): React.CSSProperties {
  const [box, setBox] = React.useState<React.CSSProperties>({});
  React.useLayoutEffect(() => {
    const element = list.current;
    if (element === null) return;
    const measure = () => {
      const active = element.querySelector<HTMLElement>(
        '[data-slot="tabs-trigger"][data-state="active"]',
      );
      if (active === null) return setBox({ opacity: 0 });
      setBox({
        "--active-tab-left": `${active.offsetLeft}px`,
        "--active-tab-top": `${active.offsetTop}px`,
        "--active-tab-width": `${active.offsetWidth}px`,
        "--active-tab-height": `${active.offsetHeight}px`,
      } as React.CSSProperties);
    };
    measure();
    const resized = new ResizeObserver(measure);
    resized.observe(element);
    const changed = new MutationObserver(measure);
    changed.observe(element, { subtree: true, attributes: true, attributeFilter: ["data-state"] });
    return () => {
      resized.disconnect();
      changed.disconnect();
    };
  }, [list]);
  return box;
}

function TabsList({
  className,
  variant = "default",
  children,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List> & VariantProps<typeof tabsListVariants>) {
  const list = React.useRef<HTMLDivElement>(null);
  const active = useActiveTab(list);
  return (
    <TabsPrimitive.List
      ref={list}
      data-slot="tabs-list"
      data-variant={variant}
      className={cn(tabsListVariants({ variant }), className)}
      {...props}
    >
      {children}
      <span
        aria-hidden
        data-slot="tabs-indicator"
        style={active}
        className={cn(
          "absolute -z-10 transition-[left,top,width,height] duration-(--state-ms) ease-(--ease-out) motion-reduce:transition-none",
          "top-[calc(var(--active-tab-top)+var(--active-tab-height)-var(--tabs-indicator-h))] left-(--active-tab-left) h-(--tabs-indicator-h) w-(--active-tab-width) [--tabs-indicator-h:calc(var(--tabs-indicator-fill)*var(--active-tab-height)+(1-var(--tabs-indicator-fill))*var(--tabs-indicator-line))]",
          "rounded-(--tabs-indicator-radius) bg-(--tabs-indicator-bg) shadow-(--tabs-indicator-shadow)",
          "group-data-[variant=line]/tabs-list:top-[calc(var(--active-tab-top)+var(--active-tab-height)-2px)] group-data-[variant=line]/tabs-list:h-0.5 group-data-[variant=line]/tabs-list:rounded-none group-data-[variant=line]/tabs-list:bg-foreground group-data-[variant=line]/tabs-list:shadow-none",
        )}
      />
    </TabsPrimitive.List>
  );
}

function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        "relative inline-flex h-(--control-h-sm) flex-1 items-center justify-center gap-1.5 rounded-(--tabs-indicator-radius) px-4 text-[0.9375rem] font-medium whitespace-nowrap text-muted-foreground transition-colors duration-(--state-ms) outline-none group-data-vertical/tabs:w-full group-data-vertical/tabs:justify-start hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-50 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        "data-active:text-(--tabs-active-fg) group-data-[variant=line]/tabs-list:rounded-none group-data-[variant=line]/tabs-list:px-1 group-data-[variant=line]/tabs-list:data-active:text-foreground",
        className,
      )}
      {...props}
    />
  );
}

function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn("flex-1 text-sm outline-none", className)}
      {...props}
    />
  );
}

export { Tabs, TabsContent, TabsList, TabsTrigger, tabsListVariants };
