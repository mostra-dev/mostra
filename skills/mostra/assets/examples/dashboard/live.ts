import { defineLive } from "@mostra/server";

export interface Deploys {
  readonly today: number;
  readonly failed: number;
  readonly medianMinutes: number;
  readonly lastDays: readonly { readonly day: string; readonly deploys: number }[];
}

/** Reloads every minute while someone looks. Replace the body with a call to your CI's API. */
export const deploys = defineLive({
  refresh: "1m",
  load: async (): Promise<Deploys> => ({
    today: 14,
    failed: 1,
    medianMinutes: 6.4,
    lastDays: [
      { day: "Mon", deploys: 11 },
      { day: "Tue", deploys: 17 },
      { day: "Wed", deploys: 9 },
      { day: "Thu", deploys: 15 },
      { day: "Fri", deploys: 14 },
    ],
  }),
});
