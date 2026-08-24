import { defineConfig } from "vitest/config";
import path from "path";

/**
 * The project's test runner.
 *
 * Tests live under `tests/<subject>/*.test.ts` — one directory per subject
 * (html, auth, env, …) so `npm test` reports them grouped. A new test belongs
 * in an existing subject directory, or a new one if it genuinely opens a new
 * subject; it does NOT belong in a fresh top-level script under `scripts/dev/`.
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
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
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
