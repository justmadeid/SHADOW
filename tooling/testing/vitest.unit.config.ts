import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "unit",
    environment: "node",
    include: [
      "apps/**/*.spec.ts",
      "apps/**/*.spec.tsx",
      "packages/**/*.spec.ts",
      "packages/**/*.spec.tsx",
    ],
    exclude: [
      "**/*.integration.spec.ts",
      "**/*.contract.spec.ts",
      "**/e2e/**",
      "**/node_modules/**",
      "**/.next/**",
      "**/dist/**",
    ],
    passWithNoTests: true,
    clearMocks: true,
    restoreMocks: true,
    mockReset: true,
    testTimeout: 10_000,
    hookTimeout: 10_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "html"],
      reportsDirectory: "coverage/unit",
    },
  },
});
