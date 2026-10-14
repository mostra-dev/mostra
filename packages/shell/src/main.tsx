import { createRoot } from "react-dom/client";
import { Shell } from "./shell.tsx";
import "./shell.css";

const root = document.getElementById("root");
if (root) createRoot(root).render(<Shell />);
