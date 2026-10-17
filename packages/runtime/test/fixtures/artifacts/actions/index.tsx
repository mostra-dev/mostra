import { defineArtifact } from "@mostra/react";
import { echo } from "./actions";

export const artifact = defineArtifact({
  title: "Actions fixture",
  limits: { watchdogMs: 2000, heapMb: 96 },
});

export default function Page() {
  return <button type="button" onClick={() => void echo("hi")}>Echo</button>;
}
