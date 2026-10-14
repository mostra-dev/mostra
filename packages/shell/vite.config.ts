import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The shell is served by the gateway under /_mostra/shell/ on the shell origin (D98); its page is
// the same for every artifact, and everything it learns about one comes from the session API.
export default defineConfig({
  base: "/_mostra/shell/",
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
    // No inline scripts or styles, so the shell's Content-Security-Policy can be 'self' only.
    assetsInlineLimit: 0,
    modulePreload: { polyfill: false },
  },
});
