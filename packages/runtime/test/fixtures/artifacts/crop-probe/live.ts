import { defineLive } from "@mostra/server";

/** A producer a crop must never start; a page that shows it waits for its first value. */
export const probe = defineLive({ load: async () => "produced" });
