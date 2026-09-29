import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser", workers: 1, retries: 0,
  use: { baseURL: "http://127.0.0.1:3100", browserName: "chromium", serviceWorkers: "block" },
  webServer: {
    command: "node node_modules/next/dist/bin/next dev --hostname 127.0.0.1 --port 3100",
    url: "http://127.0.0.1:3100", reuseExistingServer: false, timeout: 120000,
    env: { INFOBIP_API_KEY: "", INFOBIP_API_BASE_URL: "", INFOBIP_2FA_APPLICATION_ID: "", INFOBIP_2FA_MESSAGE_ID: "" },
  },
});
