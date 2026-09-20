import { defineConfig } from "vitest/config";
import path from "path";

/**
 * The project's test runner.
 *
 * Tests live under `tests/<subject>/*.test.ts`. A permanent test first has to
 * satisfy the admission policy in replit.md; tests are not the default output
 * of every task. Qualifying tests belong in an existing subject directory,
 * not in a fresh top-level script under scripts/dev.
 *
 * The aliases below mirror `vite.config.ts` and the `paths` block in
 * `tsconfig.json`, so a test imports `@shared/...` / `@/...` exactly the way
 * application code does.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
    },
  },
  // The root tsconfig sets `jsx: "preserve"` for Vite's own pipeline, which
  // would leave JSX in place for esbuild here. Transform it instead, so a
  // component test needs no per-file tsconfig workaround.
  oxc: {
    jsx: { runtime: "automatic" },
  },
  test: {
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    environment: "node",
    // Some suites boot real server modules (storage, passport, the env
    // registry) and mutate process-wide state; a process per file keeps them
    // from seeing each other's mutations.
    pool: "forks",
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
