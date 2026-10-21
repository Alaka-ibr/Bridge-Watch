import { defineConfig, devices } from "@playwright/test";
import { dirname } from "path";
import { fileURLToPath } from "url";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:4173";
const configDir = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  testDir: "./tests/visual",
  timeout: 60_000,
  expect: {
    timeout: 5_000,
    toHaveScreenshot: {
      animations: "disabled",
      caret: "hide",
      scale: "css",
    },
  },
  fullyParallel: true,
  reporter: [["list"], ["json", { outputFile: "visual-results.json" }]],
  use: {
    baseURL,
    serviceWorkers: "block",
    headless: true,
    locale: "en-US",
    colorScheme: "dark",
    reducedMotion: "reduce",
    viewport: { width: 1440, height: 1400 },
  },
  snapshotPathTemplate: "{testDir}/__screenshots__/{testFilePath}/{projectName}/{arg}{ext}",
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "firefox",
      use: { ...devices["Desktop Firefox"] },
    },
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"] },
    },
  ],
  webServer: {
    command: process.env.PLAYWRIGHT_SERVER_CMD ?? "npm run dev -- --host 127.0.0.1 --port 4173",
    cwd: configDir,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});