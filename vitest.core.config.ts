import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/tests/**/*.test.ts"],
    globals: true,
    coverage: {
      reporter: ["text", "html"],
      include: [
        "src/app/api/auth/login/route.ts",
        "src/app/api/bill/create/route.ts",
        "src/app/api/bill/discount/route.ts",
        "src/app/api/bill/latest/route.ts",
        "src/app/api/bill/search/route.ts",
        "src/app/api/bill/unpaid/route.ts",
        "src/lib/billTotals.ts",
      ],
      exclude: [
        "android/**",
        "scripts/**",
        "dist/**",
        "node_modules/**",
      ],
      thresholds: {
        statements: 80,
        branches: 80,
        functions: 80,
        lines: 80,
      },
    },
  },
});
