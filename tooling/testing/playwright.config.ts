import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000";

export default defineConfig({
  testDir: "../../e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,

  timeout: 30_000,

  expect: {
    timeout: 5_000,
  },

  reporter: process.env.CI
    ? [["github"], ["html", { open: "never" }]]
    : [["list"], ["html", { open: "never" }]],

  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },

  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
      },
    },
  ],

  outputDir: "../../test-results/playwright",

  webServer: process.env.E2E_EXTERNAL_SERVER
    ? undefined
    : [
        {
          command: "node shell-fixture.mjs",
          url: "http://127.0.0.1:43101/health",
          reuseExistingServer: false,
        },
        {
          command: "pnpm --filter platform-web dev",
          url: baseURL,
          reuseExistingServer: false,
          env: {
            WEB_ORIGIN: "http://127.0.0.1:3000",
            WEB_PLATFORM_API_URL: "http://127.0.0.1:43101/api/v1",
            WEB_OIDC_ISSUER: "http://127.0.0.1:43101",
            WEB_OIDC_CLIENT_ID: "platform-web-test",
            WEB_OIDC_AUDIENCE: "platform-api-test",
            WEB_SESSION_KEY: "ab".repeat(32),
            WEB_OIDC_CLIENT_SECRET: "synthetic-test-client-secret",
            WEB_OIDC_SCOPE: "openid",
          },
          timeout: 120_000,
        },
      ],
});
