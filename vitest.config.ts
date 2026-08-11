import { defineConfig } from "vitest/config";

/**
 * Workspace-wide unit tests. The suites here cover the parts of the TypeScript layer where a
 * mistake costs money or lets an attacker through — exact money arithmetic, budget caps, the
 * gateway's replay/idempotency guards, and co-signed receipt construction.
 */
export default defineConfig({
  test: {
    include: ["packages/**/test/**/*.test.ts", "tools/**/test/**/*.test.ts", "apps/**/test/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", "**/.next/**"],
    environment: "node",
  },
  resolve: {
    alias: {
      "@tiagoh/core": new URL("./packages/core/src/index.ts", import.meta.url).pathname,
      "@tiagoh/gateway": new URL("./packages/gateway/src/index.ts", import.meta.url).pathname,
      "@tiagoh/client": new URL("./packages/client/src/index.ts", import.meta.url).pathname,
      "@tiagoh/agent": new URL("./packages/agent/src/index.ts", import.meta.url).pathname,
      "@/lib": new URL("./apps/dashboard/lib", import.meta.url).pathname,
    },
  },
});
