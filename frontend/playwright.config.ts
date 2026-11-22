import { defineConfig } from "@playwright/test";

const baseURL = process.env.KANJIKINJO_TEST_BASE_URL ?? "http://127.0.0.1:5174";

export default defineConfig({
  testDir: "./tests",
  outputDir: "./node_modules/.cache/playwright-results",
  use: {
    baseURL,
    channel: process.env.KANJIKINJO_TEST_BROWSER,
    serviceWorkers: "block",
  },
  webServer: process.env.KANJIKINJO_TEST_BASE_URL
    ? undefined
    : {
        command: "npm run dev -- --host 127.0.0.1 --port 5174 --strictPort",
        url: baseURL,
        reuseExistingServer: !process.env.CI,
      },
});
