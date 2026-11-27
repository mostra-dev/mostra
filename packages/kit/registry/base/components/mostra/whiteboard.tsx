"use client";

/**
 * A whiteboard on Excalidraw (D26, D65): a hand-drawn canvas a person sketches on, saved as a field
 * like every kit input (`id`, D52), so the drawing comes back after a reload and arrives in results
 * under its label. It follows the page's light or dark and takes the theme's accent for its own
 * controls. Its fonts are served from the page's own origin (the build copies them beside the
 * version), so it draws offline; only the CJK handwriting font, loaded just for those characters,
 * comes from Excalidraw's CDN. Excalidraw installs on demand the first time a page uses the module,
 * at the version the kit pins. Takes `className`; `mostra add mostra-whiteboard` copies it (D68).
 */

import "@excalidraw/excalidraw/index.css";
import { CaptureUpdateAction, Excalidraw, hashElementsVersion } from "@excalidraw/excalidraw";
import { useTokens } from "@mostra/kit/tokens";
import { useField } from "@mostra/react";
import { cn } from "cn";
import * as React from "react";

declare global {
  interface Window {
    EXCALIDRAW_ASSET_PATH?: string | string[];
  }
}

/**
 * Where Excalidraw finds its fonts: beside the version, where the build copies them
 * (`kit-assets/excalidraw/fonts/`).
 */
if (typeof window !== "undefined" && window.EXCALIDRAW_ASSET_PATH === undefined) {
  window.EXCALIDRAW_ASSET_PATH = new URL("/kit-assets/excalidraw/", window.location.href).href;
}

/** A drawing as the field holds it: Excalidraw's elements, and the images they show. */
export interface Drawing {
  readonly elements: readonly unknown[];
  readonly files?: Readonly<Record<string, unknown>>;
}

/** {@link Whiteboard}'s props. */
export interface WhiteboardProps extends Omit<React.ComponentProps<"div">, "id" | "children"> {
  /** The field the drawing saves as (D52): stable, and unique on the page. */
  readonly id: string;
  /** What the drawing is, for the field's label in results and for screen readers. */
  readonly label: string;
  /** The drawing it starts with: Excalidraw elements (`convertToExcalidrawElements` helps). */
  readonly initial?: Drawing;
  /** The board's height in CSS pixels. Default 480. */
  readonly height?: number;
  /** Show the drawing without letting the person change it. */
  readonly readOnly?: boolean;
  /** Whether Submit waits for a drawing. */
  readonly required?: boolean;
}

const EMPTY: Drawing = { elements: [] };

/** Excalidraw's imperative handle, as its `excalidrawAPI` prop hands it over. */
type ExcalidrawAPI = Parameters<
  NonNullable<React.ComponentProps<typeof Excalidraw>["excalidrawAPI"]>
>[0];

/**
 * A whiteboard whose drawing saves as a field.
 *
 * ```tsx
 * <Whiteboard id="layout-sketch" label="Sketch the layout you want" height={520} />
 * ```
 */
export function Whiteboard({
  id,
  label,
  initial = EMPTY,
  height = 480,
  readOnly = false,
  required = false,
  className,
  style,
  ...props
}: WhiteboardProps): React.JSX.Element {
  const tokens = useTokens();
  const [drawing, setDrawing, meta] = useField<Drawing>(id, initial, {
    label,
    required,
    validate: (value) =>
      required && value.elements.length === 0 ? "Draw something first." : undefined,
  });
  // The drawing Excalidraw starts from: the saved one when the page loads.
  const [start] = React.useState(drawing);
  // The drawing the board holds, by its elements' ids and versions: what it last wrote to the field
  // or took from it. A field value that differs came from elsewhere (another tab, a conflict's
  // "take theirs"), and the board shows it before the next stroke saves (Opus review of WP-19,
  // finding 2).
  const held = React.useRef(hashElementsVersion(drawing.elements as never));
  const [api, setApi] = React.useState<ExcalidrawAPI | null>(null);
  React.useEffect(() => {
    if (api === null) return;
    const incoming = hashElementsVersion(drawing.elements as never);
    if (incoming === held.current) return;
    held.current = incoming;
    if (drawing.files) api.addFiles(Object.values(drawing.files) as never);
    // Not the person's own step, so not one undo takes back.
    api.updateScene({
      elements: drawing.elements as never,
      captureUpdate: CaptureUpdateAction.NEVER,
    });
  }, [api, drawing]);
  const write = React.useRef(setDrawing);
  React.useLayoutEffect(() => {
    write.current = setDrawing;
  });
  // Excalidraw reports every pointer move: the field takes the drawing when it changed, its deleted
  // elements and unused images left out (the field saves after a pause and before any submit).
  const onChange = React.useCallback(
    (
      elements: Parameters<NonNullable<React.ComponentProps<typeof Excalidraw>["onChange"]>>[0],
      _appState: unknown,
      files: Readonly<Record<string, unknown>>,
    ) => {
      const kept = elements.filter((element) => !element.isDeleted);
      const next = hashElementsVersion(kept);
      if (next === held.current) return;
      held.current = next;
      const used = new Set<string>(
        kept.flatMap((element) =>
          "fileId" in element && typeof element.fileId === "string" ? [element.fileId] : [],
        ),
      );
      const shown = Object.fromEntries(
        Object.entries(files).filter(([fileId]) => used.has(fileId)),
      );
      write.current({
        elements: kept,
        ...(Object.keys(shown).length > 0 ? { files: shown } : {}),
      });
    },
    [],
  );
  const labelId = React.useId();
  const board = React.useRef<HTMLFieldSetElement>(null);

  // Excalidraw's own controls, named for screen readers where it leaves them unnamed: its menu
  // button has only an icon, its zoom button reads its percentage, and its footer is a page
  // landmark inside the page's own (axe's button-name, label-content-name-mismatch,
  // landmark-contentinfo-is-top-level).
  React.useEffect(() => {
    const element = board.current;
    if (!element) return;
    const name = (): void => {
      for (const button of element.querySelectorAll(".main-menu-trigger")) {
        if (!button.getAttribute("aria-label")) button.setAttribute("aria-label", "Menu");
      }
      for (const button of element.querySelectorAll(".reset-zoom-button")) {
        const text = button.textContent?.trim() ?? "";
        const label = `${text} zoom, reset`;
        if (text !== "" && button.getAttribute("aria-label") !== label) {
          button.setAttribute("aria-label", label);
        }
      }
      for (const footer of element.querySelectorAll("footer")) {
        if (footer.getAttribute("role") !== "group") footer.setAttribute("role", "group");
      }
    };
    name();
    const observer = new MutationObserver(name);
    observer.observe(element, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, []);

  return (
    <div
      data-slot="whiteboard"
      data-field={id}
      className={cn("flex min-w-0 flex-col gap-1.5", className)}
      style={style}
      {...props}
    >
      <span id={labelId} className="text-sm font-medium">
        {label}
        {required && <span aria-hidden="true"> *</span>}
      </span>
      <fieldset
        ref={board}
        aria-labelledby={labelId}
        data-presence-id={id}
        style={
          {
            height,
            "--color-primary": "var(--primary)",
            "--color-primary-darker": "var(--primary)",
            "--color-primary-darkest": "var(--primary)",
            "--color-primary-light": "color-mix(in oklab, var(--primary) 18%, var(--card))",
          } as React.CSSProperties
        }
        className="m-0 min-w-0 overflow-hidden rounded-card border-0 p-0 shadow-card"
      >
        <Excalidraw
          initialData={{
            elements: start.elements as never,
            ...(start.files ? { files: start.files as never } : {}),
            appState: { viewBackgroundColor: "transparent" } as never,
          }}
          theme={tokens.appearance}
          viewModeEnabled={readOnly}
          name={label}
          UIOptions={{
            canvasActions: { loadScene: false, saveToActiveFile: false, export: false },
          }}
          onChange={onChange as never}
          excalidrawAPI={setApi}
        />
      </fieldset>
      {meta.error !== undefined && (
        <p role="alert" className="text-xs text-destructive">
          {meta.error}
        </p>
      )}
    </div>
  );
}
