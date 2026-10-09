import path from "node:path";
import { defineConfig } from "vite";

/**
 * Config used only by `scripts/ssr-smoke.tsx`
 * (`vite-node --config scripts/vite.probe.config.ts scripts/ssr-smoke.tsx`).
 *
 * The app's real config relies on `resolve.tsconfigPaths`, which vite-node's
 * bundled Vite does not honour — so the `@` alias is declared explicitly here.
 * Must be run from the `frontend/` directory.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(process.cwd(), "app"),
    },
  },
  esbuild: {
    jsx: "automatic",
  },
});
