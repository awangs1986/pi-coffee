import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["test-package/**/*.test.ts"], environment: "node" } });
