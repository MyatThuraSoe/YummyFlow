import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg"],
      manifest: {
        name: "MegaDine POS",
        short_name: "MegaDine",
        description: "Offline-first restaurant point of sale",
        theme_color: "#ffffff",
        background_color: "#ffffff",
        display: "fullscreen",
        start_url: "/",
        icons: [
          { src: "favicon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,ico}"],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith("/api/v1/menu"),
            handler: "StaleWhileRevalidate",
            options: { cacheName: "menu-cache" },
          },
          {
            urlPattern: ({ url }) => url.pathname.startsWith("/api/v1/tables"),
            handler: "StaleWhileRevalidate",
            options: { cacheName: "tables-cache" },
          },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://localhost:3001", changeOrigin: true },
      "/socket.io": { target: "http://localhost:3001", ws: true },
    },
  },
});