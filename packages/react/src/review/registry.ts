/// <reference lib="dom" />
/**
 * The page's anchor providers (WP-20; D172 item 2, `@mostra/contract-anchor-provider`): the
 * built-in ones (a kit chart's datum, a slide, a timeline's time) and those the page or its plugins
 * register, finest first. The review agent asks them before the generic layers.
 */
import type { PageAnchorProvider } from "./anchors.ts";
import { BUILT_IN_PROVIDERS } from "./providers.ts";

const registered: PageAnchorProvider[] = [];

/**
 * Registers an anchor provider for this page: what a viewer points at that the provider
 * `matches`, comments anchor with its `serialize`d data, found again with its `resolve`. A
 * provider made with `defineAnchorProvider` from `@mostra/contract-anchor-provider`, or any object
 * of its shape. Registering an ID twice keeps the first.
 */
export function registerAnchorProvider(provider: PageAnchorProvider): void {
  if (typeof provider?.serialize !== "function" || typeof provider.resolve !== "function") {
    throw new TypeError("registerAnchorProvider needs a provider with serialize and resolve.");
  }
  if (!registered.some((entry) => entry.id === provider.id)) registered.push(provider);
}

/** Every provider of the page: the registered ones first, then the built-in ones. @internal */
export function anchorProviders(): readonly PageAnchorProvider[] {
  return [...registered, ...BUILT_IN_PROVIDERS];
}
