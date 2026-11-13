// First: the shell never evaluates generated code (see jitless.ts).
import "./jitless.ts";
import { createRoot } from "react-dom/client";
import { applyAppearance } from "./appearance.ts";
import { Shell } from "./shell.tsx";
import "@mostra/themes/css/studio.css";
import "./shell.css";

// The person's light or dark, before anything is drawn (D171 item 6).
applyAppearance();

const root = document.getElementById("root");
if (root) createRoot(root).render(<Shell />);
