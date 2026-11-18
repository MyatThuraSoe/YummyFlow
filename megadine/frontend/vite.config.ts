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
        theme_color: "#6F4E37",
        background_color: "#ffffff",
        display: "standalone",
        start_url: "/",
        icons: [
          { src: "favicon.svg", sizes: "any", type: "image/svg+xml", purpose: "any maskable" },
        ],
      },
      workbox: {
        // Control the current tab as soon as the precache is ready, so a
        // tablet that loses the network on its first visit still loads offline.
        clientsClaim: true,
        skipWaiting: true,
        // Locale JSON is fetched at runtime by i18next; without it in the
        // precache an offline reload suspends forever on the loading spinner.
        globPatterns: ["**/*.{js,css,html,svg,png,ico,json,webmanifest}"],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith("/locales/"),
            handler: "CacheFirst",
            options: { cacheName: "locales-cache" },
          },
          {
            urlPattern: ({ url }) => url.pathname.startsWith("/api/v1/menu"),
            handler: "NetworkFirst",
            options: { cacheName: "menu-cache", networkTimeoutSeconds: 2 },
          },
          {
            urlPattern: ({ url }) => url.pathname.startsWith("/api/v1/shifts/current"),
            handler: "NetworkFirst",
            options: { cacheName: "shift-cache", networkTimeoutSeconds: 2 },
          },
          {
            urlPattern: ({ url }) => url.pathname.startsWith("/api/v1/admin/settings"),
            handler: "NetworkFirst",
            options: { cacheName: "settings-cache", networkTimeoutSeconds: 2 },
          },
          {
            urlPattern: ({ url }) => url.pathname.startsWith("/api/v1/orders/open"),
            handler: "NetworkFirst",
            options: { cacheName: "open-orders-cache", networkTimeoutSeconds: 2 },
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