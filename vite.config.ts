import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig(({ mode }) => ({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon.svg"],
      manifest: {
        name: "KanjiGraph",
        short_name: "KanjiGraph",
        description: "Explore the words you have studied in Anki",
        theme_color: "#1d1e21",
        background_color: "#1d1e21",
        display: "standalone",
        icons: [
          {
            src: "/icon.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any maskable",
          },
        ],
      },
      workbox: { navigateFallback: "/index.html" },
    }),
  ],
  server: {
    proxy: {
      "/api": {
        target:
          loadEnv(mode, ".", "KANJIGRAPH_").KANJIGRAPH_API_TARGET ||
          "http://127.0.0.1:8000",
        changeOrigin: false,
      },
    },
  },
}));
