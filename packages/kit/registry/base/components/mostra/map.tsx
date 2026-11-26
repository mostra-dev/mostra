"use client";

/**
 * Maps with MapLibre and deck.gl in the page's theme (D26, D65): a map whose ground is a world
 * outline the kit carries (Natural Earth's countries through `world-atlas`, public domain), in the
 * theme's surfaces and rules, so it draws offline, inline in a chat host and in `verify` with no
 * tile server; or any MapLibre style by its URL. On it, markers with their names, and any deck.gl
 * layers (scatter, arcs, hexagons, heat maps, paths) drawn in the map's own frame. Both libraries
 * install on demand the first time a page uses the module, at the versions the kit pins. Takes
 * `className`; `mostra add mostra-map` copies it (D68).
 */

import type { Layer } from "@deck.gl/core";
import { ScatterplotLayer, TextLayer } from "@deck.gl/layers";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { colorBytes, type Tokens, useTokens } from "@mostra/kit/tokens";
import { cn } from "cn";
import type { StyleSpecification } from "maplibre-gl";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
// MapLibre 6 runs its tiling in a module worker of its own: the build bundles it beside the page.
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import * as React from "react";
import { feature } from "topojson-client";
import countries from "world-atlas/countries-110m.json";

export type { StyleSpecification } from "maplibre-gl";

/** A place on the map: `[longitude, latitude]`. */
export type LngLat = readonly [number, number];

/** A marker: a point, its name, and its colour. */
export interface MapMarker {
  readonly position: LngLat;
  /** Its name, shown beside it and read by screen readers. */
  readonly label?: string;
  /** Its colour; default the theme's first series colour. */
  readonly color?: string;
}

/** {@link MapView}'s props. */
export interface MapViewProps extends Omit<React.ComponentProps<"figure">, "title"> {
  /** Where the map looks at first. Default `[0, 20]`. */
  readonly center?: LngLat;
  /** How close, from 0 (the world) to 22. Default 1.2. */
  readonly zoom?: number;
  /**
   * The ground: `"world"`, the kit's world outline in the theme (default); `"none"`, the theme's
   * background only; or a MapLibre style, as its URL or as an object.
   */
  readonly basemap?: "world" | "none" | string | StyleSpecification;
  /** Points with their names. */
  readonly markers?: readonly MapMarker[];
  /** deck.gl layers drawn on the map (`new ScatterplotLayer({ … })`). */
  readonly layers?: readonly Layer[];
  /** What the map shows, for screen readers and above it. */
  readonly title?: React.ReactNode;
  /** The map's height in CSS pixels. Default 400. */
  readonly height?: number;
  /** Let people pan and zoom. Default true. */
  readonly interactive?: boolean;
  /** Called once with MapLibre's map, for its own API (`map.flyTo(…)`, events). */
  readonly onReady?: (map: maplibregl.Map) => void;
}

/** A ring's signed area on the plane of longitude and latitude: positive when counterclockwise. */
function ringArea(ring: readonly (readonly number[])[]): number {
  let sum = 0;
  for (let index = 0, last = ring.length - 1; index < ring.length; last = index++) {
    const [x1 = 0, y1 = 0] = ring[last] ?? [];
    const [x2 = 0, y2 = 0] = ring[index] ?? [];
    sum += (x1 - x2) * (y1 + y2);
  }
  return sum / 2;
}

/**
 * A polygon's rings wound as GeoJSON's RFC 7946 has them (its outer ring counterclockwise, its holes
 * clockwise): TopoJSON's simplified rings don't promise it, and MapLibre's tiler reads a ring wound
 * the other way as a hole, leaving countries unfilled.
 */
function rewound(polygon: number[][][]): number[][][] {
  return polygon.map((ring, index) =>
    ringArea(ring) > 0 === (index === 0) ? ring : [...ring].reverse(),
  );
}

/** The world's countries, once, as GeoJSON. */
let world: GeoJSON.FeatureCollection | undefined;
maplibregl.setWorkerUrl(workerUrl);
function worldOutline(): GeoJSON.FeatureCollection {
  if (world !== undefined) return world;
  const collection = feature(
    countries as unknown as Parameters<typeof feature>[0],
    (countries as unknown as { objects: { countries: Parameters<typeof feature>[1] } }).objects
      .countries,
  ) as unknown as GeoJSON.FeatureCollection;
  world = {
    type: "FeatureCollection",
    features: collection.features.map((country) => {
      const geometry = country.geometry;
      if (geometry?.type === "Polygon") {
        return {
          ...country,
          geometry: { ...geometry, coordinates: rewound(geometry.coordinates) },
        };
      }
      if (geometry?.type === "MultiPolygon") {
        return {
          ...country,
          geometry: { ...geometry, coordinates: geometry.coordinates.map(rewound) },
        };
      }
      return country;
    }),
  };
  return world;
}

/** A MapLibre style for the ground, from the page's tokens. */
export function mapStyle(basemap: "world" | "none", tokens: Tokens): StyleSpecification {
  return {
    version: 8,
    sources: basemap === "world" ? { countries: { type: "geojson", data: worldOutline() } } : {},
    layers: [
      { id: "background", type: "background", paint: { "background-color": tokens.muted } },
      ...(basemap === "world"
        ? ([
            {
              id: "land",
              type: "fill",
              source: "countries",
              paint: { "fill-color": tokens.card },
            },
            {
              id: "borders",
              type: "line",
              source: "countries",
              paint: { "line-color": tokens.border, "line-width": 0.7 },
            },
          ] as StyleSpecification["layers"])
        : []),
    ],
  };
}

/** The markers as deck.gl layers: a dot each, and its name beside it. */
function markerLayers(markers: readonly MapMarker[], tokens: Tokens): Layer[] {
  if (markers.length === 0) return [];
  return [
    new ScatterplotLayer<MapMarker>({
      id: "mostra-markers",
      data: [...markers],
      getPosition: (marker) => [marker.position[0], marker.position[1]],
      getFillColor: (marker) => colorBytes(marker.color ?? tokens.chart[0]),
      getLineColor: colorBytes(tokens.card),
      lineWidthUnits: "pixels",
      getLineWidth: 2,
      stroked: true,
      radiusUnits: "pixels",
      getRadius: 6,
      pickable: true,
    }) as unknown as Layer,
    new TextLayer<MapMarker>({
      id: "mostra-marker-labels",
      data: markers.filter((marker) => marker.label !== undefined),
      getPosition: (marker) => [marker.position[0], marker.position[1]],
      getText: (marker) => marker.label ?? "",
      getColor: colorBytes(tokens.foreground),
      getSize: 12,
      getPixelOffset: [0, -16],
      fontFamily: tokens.fontSans,
      background: true,
      getBackgroundColor: colorBytes(tokens.card),
      backgroundPadding: [4, 2],
    }) as unknown as Layer,
  ];
}

const NO_MARKERS: readonly MapMarker[] = [];
const NO_LAYERS: readonly Layer[] = [];

/**
 * A map in the page's theme, with markers and deck.gl layers.
 *
 * ```tsx
 * <MapView title="Offices" center={[10, 50]} zoom={3} markers={[{ position: [13.4, 52.5], label: "Berlin" }, { position: [2.35, 48.86], label: "Paris" }]} />
 * ```
 */
export function MapView({
  center = [0, 20],
  zoom = 1.2,
  basemap = "world",
  markers = NO_MARKERS,
  layers = NO_LAYERS,
  title,
  height = 400,
  interactive = true,
  onReady,
  className,
  ...props
}: MapViewProps): React.JSX.Element {
  const tokens = useTokens();
  const host = React.useRef<HTMLDivElement>(null);
  const map = React.useRef<maplibregl.Map | null>(null);
  const overlay = React.useRef<MapboxOverlay | null>(null);
  const style = React.useMemo(
    () => (basemap === "world" || basemap === "none" ? mapStyle(basemap, tokens) : basemap),
    [basemap, tokens],
  );
  const drawn = React.useMemo(
    () => [...layers, ...markerLayers(markers, tokens)],
    [layers, markers, tokens],
  );
  const latest = React.useRef({ center, zoom, onReady, style, basemap, drawn });
  const shownStyle = React.useRef<typeof style | undefined>(undefined);
  React.useLayoutEffect(() => {
    latest.current = { center, zoom, onReady, style, basemap, drawn };
  });

  // The map, made once for its host, with the camera and ground of then; the ground, markers and
  // layers follow below.
  React.useEffect(() => {
    const element = host.current;
    if (!element) return;
    const ground = latest.current.style;
    const created = new maplibregl.Map({
      container: element,
      style: ground as StyleSpecification | string,
      center: [latest.current.center[0], latest.current.center[1]],
      zoom: latest.current.zoom,
      interactive,
      attributionControl:
        latest.current.basemap === "world" || latest.current.basemap === "none"
          ? false
          : { compact: true },
      fadeDuration: 0,
    });
    shownStyle.current = ground;
    // deck.gl draws on a canvas of its own over the map, kept in step with its camera: the way of
    // drawing both MapLibre majors share.
    const deck = new MapboxOverlay({ interleaved: false, layers: latest.current.drawn });
    created.addControl(deck as unknown as maplibregl.IControl);
    if (interactive) created.addControl(new maplibregl.NavigationControl({ showCompass: false }));
    map.current = created;
    overlay.current = deck;
    latest.current.onReady?.(created);
    return () => {
      created.remove();
      if (map.current === created) map.current = null;
      if (overlay.current === deck) overlay.current = null;
    };
  }, [interactive]);

  // The ground follows the theme, its light or dark, and the basemap asked for (the map was made
  // with the first).
  React.useEffect(() => {
    if (shownStyle.current === style) return;
    shownStyle.current = style;
    map.current?.setStyle(style as StyleSpecification | string, { diff: false });
  }, [style]);

  // The markers and layers, drawn by deck.gl in the map's frame.
  React.useEffect(() => {
    overlay.current?.setProps({ layers: drawn });
  }, [drawn]);

  const titleId = React.useId();
  const named = markers.filter((marker) => marker.label !== undefined);
  return (
    <figure
      data-slot="map"
      aria-labelledby={title !== undefined ? titleId : undefined}
      className={cn("flex min-w-0 flex-col gap-2 text-card-foreground", className)}
      {...props}
    >
      {title !== undefined && (
        <figcaption id={titleId} className="text-sm font-medium">
          {title}
        </figcaption>
      )}
      <div
        ref={host}
        style={{ height }}
        className="relative w-full min-w-0 overflow-hidden rounded-card shadow-card [&_.maplibregl-ctrl-group]:rounded-control! [&_.maplibregl-ctrl-group]:bg-card! [&_.maplibregl-ctrl-group]:shadow-card!"
      />
      {named.length > 0 && (
        <ul className="sr-only">
          {named.map((marker) => (
            <li key={`${marker.label}-${marker.position[0]}-${marker.position[1]}`}>
              {marker.label}: {marker.position[1].toFixed(2)}°, {marker.position[0].toFixed(2)}°
            </li>
          ))}
        </ul>
      )}
    </figure>
  );
}
