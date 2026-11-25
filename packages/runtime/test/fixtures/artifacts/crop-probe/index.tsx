import { defineArtifact, useLive, useViewer } from "@mostra/react";
import { useEffect, useState } from "react";
import { ping } from "./actions.ts";

export const artifact = defineArtifact({ title: "Crop probe" });

/**
 * What a comment's crop shows, as one colour (WP-20's review, finding 2): red when a server
 * function ran, green when the page acts as the owner, blue when a pushed source shows the value
 * viewers saw and no producer made a value for the crop.
 */
export default function Page() {
  const viewer = useViewer();
  const produced = useLive("probe");
  const seen = useLive("seen");
  const [ran, setRan] = useState(false);
  useEffect(() => {
    ping().then(
      () => setRan(true),
      () => undefined,
    );
  }, []);
  const red = ran ? 255 : 0;
  const green = viewer.source === "local" ? 255 : 0;
  const blue = seen.data === "seeded" && produced.data === undefined ? 255 : 0;
  return (
    <main style={{ margin: 0, padding: 40 }}>
      <div
        data-review-id="probe"
        style={{ width: 480, height: 240, background: `rgb(${red}, ${green}, ${blue})` }}
      />
    </main>
  );
}
