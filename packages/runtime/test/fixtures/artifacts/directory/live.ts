import { defineLive } from "@mostra/server";

export const openWork = defineLive({
  refresh: "5m",
  load: async () => ({ count: 2 }),
});
