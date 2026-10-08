import { mergeConfig, defineConfig } from "vitest/config";
import base from "./vitest.config.ts";

export default mergeConfig(base, defineConfig({
  test: {
    setupFiles: ["tests/wizards/isolated-db.setup.ts"],
    maxWorkers: 1,
  },
}));
