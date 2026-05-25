import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    restoreMocks: true,
    clearMocks: true,
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    exclude: ["tests/**", "node_modules/**"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
