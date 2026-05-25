import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const shared = fileURLToPath(new URL("../shared", import.meta.url));

export default defineConfig({
  resolve: {
    alias: { "@shared": shared },
  },
  test: {
    environment: "node",
    setupFiles: ["./test/setup.ts"],
    include: ["**/*.test.ts", "../shared/**/*.test.ts"],
    fileParallelism: false, // share one DB; avoid cross-test races
  },
});
