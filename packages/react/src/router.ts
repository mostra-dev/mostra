/**
 * `pages/` routing on React Router (D57): the generated entry hands the routes, and the entry's
 * layout when it has one, to {@link mountRoutes}. The history follows the delivery target (D111):
 * browser history behind Mostra's gateway (deep links work, D98), hash routing in a static export
 * (any static host serves it), memory routing inside an MCP App (its frame has no URL of its own).
 * Every navigation is reported to the shell, so comments record their page (WP-20).
 *
 * Artifact code navigates with React Router's own `<Link to>` and `useNavigate`.
 */
import type { DeliveryTarget } from "@mostra/protocol";
import { type ComponentType, createElement, type ReactNode } from "react";
import {
  createBrowserRouter,
  createHashRouter,
  createMemoryRouter,
  Outlet,
  type RouteObject,
} from "react-router";
import { RouterProvider } from "react-router/dom";
import { prepareArtifact, renderArtifact, reportPage } from "./mount.ts";

/** One route of a `pages/` artifact: its React Router path and its page. */
export interface PageRouteModule {
  readonly path: string;
  readonly page: ComponentType;
}

/** How a router keeps its location: in the address bar, in its hash, or in memory. */
export type HistoryMode = "browser" | "hash" | "memory";

/** The history mode for a delivery target (D57, D111). */
export function historyMode(target: DeliveryTarget): HistoryMode {
  if (target === "static") return "hash";
  if (target === "mcp-app") return "memory";
  return "browser";
}

/** The route tree: the pages, inside the layout when there is one. */
export function routeTree(
  routes: readonly PageRouteModule[],
  layout?: ComponentType<{ children?: ReactNode }>,
): RouteObject[] {
  const pages: RouteObject[] = routes.map((route) => ({
    path: route.path,
    element: createElement(route.page),
  }));
  if (!layout) return pages;
  return [{ element: createElement(layout, null, createElement(Outlet)), children: pages }];
}

/**
 * Mounts a `pages/` artifact (D57). The generated entry calls it; artifact code doesn't need to.
 */
export async function mountRoutes(options: {
  readonly routes: readonly PageRouteModule[];
  readonly layout?: ComponentType<{ children?: ReactNode }>;
}): Promise<void> {
  const runtime = await prepareArtifact();
  const tree = routeTree(options.routes, options.layout);
  const mode = historyMode(runtime.target);
  const router =
    mode === "hash"
      ? createHashRouter(tree)
      : mode === "memory"
        ? createMemoryRouter(tree)
        : createBrowserRouter(tree);
  const pathOf = (): string => {
    const location = router.state.location;
    return `${location.pathname}${location.search}${location.hash}`;
  };
  let last = "";
  const report = (): void => {
    const path = pathOf();
    if (path === last) return;
    last = path;
    reportPage(runtime, path, document.title);
  };
  router.subscribe(report);
  renderArtifact(runtime, createElement(RouterProvider, { router }));
  report();
  document.documentElement.dataset["mostraHistory"] = mode;
}
