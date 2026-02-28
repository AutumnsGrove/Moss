import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/index.ts"],
    },
  },
  resolve: {
    alias: {
      "@shared": "./src/shared",
      "@gateway": "./src/gateway",
      "@agent": "./src/agent",
      "@scheduler": "./src/scheduler",
      "@memory": "./src/memory",
      "@skills": "./src/skills",
    },
  },
});
