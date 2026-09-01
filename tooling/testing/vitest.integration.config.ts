import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "integration",
    environment: "node",
    include: ["apps/**/*.integration.spec.ts", "packages/**/*.integration.spec.ts"],
    exclude: ["**/node_modules/**", "**/.next/**", "**/dist/**", "**/e2e/**"],
    passWithNoTests: true,
    fileParallelism: false,
    clearMocks: true,
    restoreMocks: true,
    mockReset: true,
    testTimeout: 60_000,
    hookTimeout: 60_000,
    teardownTimeout: 30_000,
  },
});
