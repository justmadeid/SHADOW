import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "contract",
    environment: "node",
    include: ["apps/**/*.contract.spec.ts", "packages/**/*.contract.spec.ts"],
    passWithNoTests: false,
    fileParallelism: false,
    clearMocks: true,
    restoreMocks: true,
    testTimeout: 45_000,
    hookTimeout: 45_000,
  },
});
