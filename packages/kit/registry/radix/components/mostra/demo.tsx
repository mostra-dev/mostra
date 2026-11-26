"use client";

/**
 * Web demos (D185, TM-08): a front end the artifact builds into its version, shown in a device's
 * frame at that device's viewport and scaled to fit, with a switcher between viewports. The demo
 * is fully interactive: its own routing, its own data, its own storage, in a frame of the page's
 * origin; comments anchor inside it. `values` reach it as `postMessage` data
 * (`{ "mostra/demo.values": values }`), and what it posts to its parent reaches `onMessage`.
 *
 * ```tsx
 * import { WebDemo } from "@mostra/kit/demo";
 *
 * <WebDemo demo="app" path="/settings" device="iphone-15" />
 * ```
 *
 * Ordinary React on the theme's tokens, the same in either base; it takes `className`, and
 * `mostra add mostra-demo` copies it into the artifact for editing (D68, KT-10).
 */

import { useDemo } from "@mostra/react";
import { cn } from "cn";
import * as React from "react";

/** A device a demo can be framed as, and its viewport in CSS pixels. */
export interface DemoDevice {
  readonly label: string;
  readonly width: number;
  readonly height: number;
  /** How the frame is drawn around the viewport. */
  readonly frame: "phone" | "tablet" | "browser";
}

/** A device's name. */
export type DemoDeviceName = "iphone-15" | "pixel-8" | "ipad" | "laptop" | "desktop";

/** The devices `<WebDemo>` frames a demo as. */
export const DEMO_DEVICES: Readonly<Record<DemoDeviceName, DemoDevice>> = {
  "iphone-15": { label: "Phone", width: 393, height: 852, frame: "phone" },
  "pixel-8": { label: "Android", width: 412, height: 915, frame: "phone" },
  ipad: { label: "Tablet", width: 820, height: 1180, frame: "tablet" },
  laptop: { label: "Laptop", width: 1280, height: 800, frame: "browser" },
  desktop: { label: "Desktop", width: 1440, height: 900, frame: "browser" },
};

/** {@link WebDemo}'s props. */
export interface WebDemoProps extends Omit<React.ComponentProps<"figure">, "onMessage"> {
  /** The demo's name in the manifest's `demos`. */
  readonly demo: string;
  /** The page of the demo to open: `/settings`. Default its first page. */
  readonly path?: string;
  /** The device it opens as, or `"none"` for no frame, the demo filling the width. Default `laptop`. */
  readonly device?: DemoDeviceName | "none";
  /** The devices the viewer can switch between; `false` for no switcher. Default phone, tablet, laptop. */
  readonly devices?: readonly DemoDeviceName[] | false;
  /** With `device="none"`: the frame's height in CSS pixels. Default 640. */
  readonly height?: number;
  /** The frame's accessible name. Default the demo's name. */
  readonly title?: string;
  /** Values the demo receives on load and on every change, as `{ "mostra/demo.values": values }`. */
  readonly values?: unknown;
  /** What the demo posts to its parent window. */
  readonly onMessage?: (data: unknown) => void;
}

const DEFAULT_DEVICES: readonly DemoDeviceName[] = ["iphone-15", "ipad", "laptop"];

/** The words a viewer reads where a demo can't show. */
const WORDS = {
  unknown: "This demo isn't part of this version.",
  "folder-only":
    "This demo can't run inside a single file. It's included in the folder version of this export; ask the sender for that.",
  unavailable: "This demo shows on the full page.",
} as const;

/** The frame's border and corner, per kind of device, in CSS pixels. */
const BEZEL = { phone: 12, tablet: 16, browser: 0 } as const;
const CORNER = { phone: 52, tablet: 32, browser: 12 } as const;
/** The browser frame's title bar. */
const BAR = 36;

/** The width a container gives its content, followed as it changes. */
function useWidth(ref: React.RefObject<HTMLElement | null>): number {
  const [width, setWidth] = React.useState(0);
  React.useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    setWidth(element.clientWidth);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setWidth(element.clientWidth));
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

/** A demo the version keeps, in a device's frame (D185 item 6). */
export function WebDemo({
  demo,
  path,
  device = "laptop",
  devices = DEFAULT_DEVICES,
  height = 640,
  title,
  values,
  onMessage,
  className,
  ...props
}: WebDemoProps): React.JSX.Element {
  const handle = useDemo(demo, path !== undefined ? { path } : {});
  const [current, setCurrent] = React.useState<DemoDeviceName | "none">(device);
  React.useEffect(() => setCurrent(device), [device]);
  const box = React.useRef<HTMLDivElement>(null);
  const width = useWidth(box);
  const frame = React.useRef<HTMLIFrameElement>(null);

  const post = React.useCallback(() => {
    if (values === undefined) return;
    frame.current?.contentWindow?.postMessage({ "mostra/demo.values": values }, "*");
  }, [values]);
  React.useEffect(post, [post]);
  React.useEffect(() => {
    if (!onMessage) return;
    const listener = (event: MessageEvent): void => {
      if (event.source !== frame.current?.contentWindow) return;
      onMessage(event.data);
    };
    window.addEventListener("message", listener);
    return () => window.removeEventListener("message", listener);
  }, [onMessage]);

  const spec = current === "none" ? undefined : DEMO_DEVICES[current];
  const bezel = spec ? BEZEL[spec.frame] : 0;
  const bar = spec?.frame === "browser" ? BAR : 0;
  const outerWidth = spec ? spec.width + bezel * 2 : 0;
  const outerHeight = spec ? spec.height + bezel * 2 + bar : height;
  // The demo sees the device's real width (its media queries apply); the frame is scaled to fit.
  const scale = spec && width > 0 ? Math.min(1, width / outerWidth) : 1;
  const switcher =
    devices !== false && devices.length > 1 ? (
      <div role="group" aria-label="Viewport" className="flex flex-wrap justify-center gap-1">
        {devices.map((name) => (
          <button
            key={name}
            type="button"
            aria-pressed={current === name}
            onClick={() => setCurrent(name)}
            className={cn(
              "rounded-full border px-3 py-1 text-xs transition-colors",
              current === name
                ? "border-(--primary) bg-(--primary) text-(--primary-foreground)"
                : "border-(--border) bg-(--background) text-(--muted-foreground) hover:text-(--foreground)",
            )}
          >
            {DEMO_DEVICES[name].label}
          </button>
        ))}
      </div>
    ) : null;

  const content =
    handle.status === "ready" ? (
      <iframe
        ref={frame}
        title={title ?? demo}
        data-mostra-demo={demo}
        {...(handle.srcdoc !== undefined ? { srcDoc: handle.srcdoc } : { src: handle.src })}
        onLoad={() => {
          handle.loaded();
          post();
        }}
        className="block border-0 bg-white"
        style={
          spec
            ? { width: spec.width, height: spec.height }
            : { width: "100%", height: outerHeight }
        }
      />
    ) : (
      <div
        role="note"
        className="flex items-center justify-center p-6 text-center text-sm text-(--muted-foreground)"
        style={
          spec
            ? { width: spec.width, height: spec.height }
            : { width: "100%", height: outerHeight }
        }
      >
        {WORDS[handle.status]}
      </div>
    );

  return (
    <figure
      data-slot="web-demo"
      data-device={current}
      data-status={handle.status}
      className={cn("my-0 flex flex-col items-center gap-3", className)}
      {...props}
    >
      {switcher}
      <div ref={box} className="w-full">
        {spec ? (
          <div
            className="mx-auto"
            style={{ width: outerWidth * scale, height: outerHeight * scale }}
          >
            <div
              className={cn(
                "overflow-hidden",
                spec.frame === "browser"
                  ? "border border-(--border) bg-(--muted) shadow-card"
                  : "bg-neutral-900 shadow-card",
              )}
              style={{
                width: outerWidth,
                height: outerHeight,
                padding: bezel,
                borderRadius: CORNER[spec.frame],
                transform: `scale(${scale})`,
                transformOrigin: "top left",
              }}
            >
              {spec.frame === "browser" ? (
                <div
                  aria-hidden="true"
                  className="flex items-center gap-1.5 px-3"
                  style={{ height: BAR }}
                >
                  <span className="size-2.5 rounded-full bg-(--border)" />
                  <span className="size-2.5 rounded-full bg-(--border)" />
                  <span className="size-2.5 rounded-full bg-(--border)" />
                  <span className="ml-3 truncate rounded-md bg-(--background) px-3 py-0.5 text-xs text-(--muted-foreground)">
                    {path ?? "/"}
                  </span>
                </div>
              ) : null}
              <div
                className="overflow-hidden"
                style={{
                  borderRadius: spec.frame === "browser" ? 0 : CORNER[spec.frame] - bezel,
                }}
              >
                {content}
              </div>
            </div>
          </div>
        ) : (
          <div className="overflow-hidden rounded-card border border-(--border)">{content}</div>
        )}
      </div>
    </figure>
  );
}
