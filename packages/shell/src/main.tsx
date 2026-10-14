// First: the shell never evaluates generated code (see jitless.ts).
import "./jitless.ts";
import { createRoot } from "react-dom/client";
import { Shell } from "./shell.tsx";
import "./shell.css";

const root = document.getElementById("root");
if (root) createRoot(root).render(<Shell />);
