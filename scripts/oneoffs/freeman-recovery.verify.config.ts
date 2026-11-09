import { defineConfig } from "vitest/config";
import base from "../../vitest.config.ts";

export default defineConfig({
  ...base,
  test: { include: ["scripts/oneoffs/*recovery.verify.test.ts"], environment: "node", pool: "forks", testTimeout: 15000 },
});
