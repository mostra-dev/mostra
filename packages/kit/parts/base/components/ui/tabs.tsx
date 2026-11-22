"use client";

import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "cn";

function Tabs({ className, orientation = "horizontal", ...props }: TabsPrimitive.Root.Props) {
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

function TabsList({
  className,
  variant = "default",
  children,
  ...props
}: TabsPrimitive.List.Props & VariantProps<typeof tabsListVariants>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant={variant}
      className={cn(tabsListVariants({ variant }), className)}
      {...props}
    >
      {children}
      <TabsPrimitive.Indicator
        data-slot="tabs-indicator"
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

function TabsTrigger({ className, ...props }: TabsPrimitive.Tab.Props) {
  return (
    <TabsPrimitive.Tab
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

function TabsContent({ className, ...props }: TabsPrimitive.Panel.Props) {
  return (
    <TabsPrimitive.Panel
      data-slot="tabs-content"
      className={cn("flex-1 text-sm outline-none", className)}
      {...props}
    />
  );
}

export { Tabs, TabsContent, TabsList, TabsTrigger, tabsListVariants };
