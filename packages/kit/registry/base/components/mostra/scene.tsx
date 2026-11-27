"use client";

/**
 * 3D scenes with react-three-fiber in the page's theme (D26, D65): `Scene` is a three.js canvas set
 * up for a page (a camera that frames the content, soft light, orbit controls, an optional floor
 * grid in the theme's rules, a transparent background so the page's own shows through), and its
 * children are ordinary react-three-fiber elements (`<mesh>`, drei's helpers). `useTokens()` gives
 * the theme's colours for materials. three.js, react-three-fiber and drei install on demand the
 * first time a page uses the module, at the versions the kit pins. Takes `className`; `mostra add
 * mostra-scene` copies it (D68).
 */

import { useTokens } from "@mostra/kit/tokens";
import { Bounds, Grid, OrbitControls } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { cn } from "cn";
import type * as React from "react";

export { useTokens } from "@mostra/kit/tokens";

/** {@link Scene}'s props. */
export interface SceneProps extends Omit<React.ComponentProps<"figure">, "title" | "children"> {
  /** The scene: react-three-fiber elements (`<mesh><boxGeometry /><meshStandardMaterial /></mesh>`). */
  readonly children: React.ReactNode;
  /** What the scene shows, for screen readers and above it. */
  readonly title?: React.ReactNode;
  /** The canvas's height in CSS pixels. Default 360. */
  readonly height?: number;
  /** Where the camera starts, `[x, y, z]`. Default `[3, 2.5, 4]`. */
  readonly camera?: readonly [number, number, number];
  /** Let people orbit, pan and zoom. Default true. */
  readonly controls?: boolean;
  /** Draw a floor grid in the theme's rules. Default true. */
  readonly grid?: boolean;
  /** Fit the camera to the scene's content. Default true. */
  readonly fit?: boolean;
  /** Turn the scene slowly (off when the person prefers reduced motion). Default false. */
  readonly autoRotate?: boolean;
}

/**
 * Whether this browser draws WebGL 2, asked once: three.js (since r163) draws with nothing older, and a browser
 * may offer WebGL 1 alone (Firefox on a machine its graphics policy holds back does).
 */
let webgl: boolean | undefined;
function canDrawWebGL(): boolean {
  if (webgl === undefined) {
    try {
      webgl = document.createElement("canvas").getContext("webgl2") !== null;
    } catch {
      webgl = false;
    }
  }
  return webgl;
}

/**
 * A three.js scene in the page's theme.
 *
 * ```tsx
 * <Scene title="The part">
 *   <mesh><torusKnotGeometry args={[0.8, 0.25, 128, 16]} /><meshStandardMaterial color={useTokens().chart[0]} /></mesh>
 * </Scene>
 * ```
 */
export function Scene({
  children,
  title,
  height = 360,
  camera = [3, 2.5, 4],
  controls = true,
  grid = true,
  fit = true,
  autoRotate = false,
  className,
  ...props
}: SceneProps): React.JSX.Element {
  const tokens = useTokens();
  const reduce =
    typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  return (
    <figure
      data-slot="scene"
      className={cn("flex min-w-0 flex-col gap-2 text-card-foreground", className)}
      {...props}
    >
      {title !== undefined && <figcaption className="text-sm font-medium">{title}</figcaption>}
      <div
        style={{ height }}
        className="w-full min-w-0 overflow-hidden rounded-card bg-card shadow-card"
        {...(typeof title === "string" ? { role: "img", "aria-label": title } : {})}
      >
        {typeof document !== "undefined" && !canDrawWebGL() ? (
          <p className="grid h-full place-items-center p-4 text-center text-sm text-muted-foreground">
            This browser can't draw 3D scenes: WebGL 2 is turned off or missing.
          </p>
        ) : (
          <Canvas
            camera={{ position: [camera[0], camera[1], camera[2]], fov: 45 }}
            dpr={[1, 2]}
            gl={{ antialias: true, preserveDrawingBuffer: true }}
            frameloop={autoRotate && !reduce ? "always" : "demand"}
          >
            <ambientLight intensity={0.6} />
            <directionalLight position={[5, 8, 5]} intensity={1.2} />
            <directionalLight position={[-4, 2, -3]} intensity={0.35} />
            {fit ? (
              <Bounds fit clip observe margin={1.2}>
                {children}
              </Bounds>
            ) : (
              children
            )}
            {grid && (
              <Grid
                position={[0, -0.001, 0]}
                args={[20, 20]}
                cellColor={tokens.border}
                sectionColor={tokens.input}
                fadeDistance={18}
                infiniteGrid
              />
            )}
            {controls && (
              <OrbitControls
                makeDefault
                enableDamping={!reduce}
                autoRotate={autoRotate && !reduce}
                autoRotateSpeed={0.6}
              />
            )}
          </Canvas>
        )}
      </div>
    </figure>
  );
}
