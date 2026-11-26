import { Page, Section } from "@mostra/kit/layout";
import { MapView } from "@mostra/kit/map";
import { Scene, useTokens } from "@mostra/kit/scene";
import { Whiteboard } from "@mostra/kit/whiteboard";
import { defineArtifact } from "@mostra/react";

export const artifact = defineArtifact({
  title: "Maps, 3D and a whiteboard",
  kit: { theme: "studio" },
});

function Knot() {
  const tokens = useTokens();
  return (
    <mesh rotation={[0.4, 0.2, 0]}>
      <torusKnotGeometry args={[0.8, 0.25, 96, 12]} />
      <meshStandardMaterial color={tokens.chart[0]} />
    </mesh>
  );
}

export default function OnDemand() {
  return (
    <Page title="Maps, 3D and a whiteboard" width="wide">
      <Section title="Map">
        <MapView
          title="Offices"
          center={[8, 48]}
          zoom={3}
          markers={[
            { position: [13.4, 52.5], label: "Berlin" },
            { position: [2.35, 48.86], label: "Paris" },
          ]}
        />
      </Section>
      <Section title="Scene">
        <Scene title="A knot">
          <Knot />
        </Scene>
      </Section>
      <Section title="Whiteboard">
        <Whiteboard id="sketch" label="Sketch the layout" height={360} />
      </Section>
    </Page>
  );
}
