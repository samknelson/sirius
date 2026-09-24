/**
 * Per-variable environment-override rows (`ENV_{NAME}` variables rows) and
 * their cache invalidation, including the generic variable-route
 * rename/delete paths.
 *
 * Needs the dev database.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { storage } from "../../server/storage";
import {
  envOverrideVariableName,
  getEnvOverrideMap,
  initEnvOverrides,
  refreshEnvOverrides,
} from "../../server/services/env-overrides";
import {
  getEnvironmentVariable,
  getRawProcessEnv,
  isEnvironmentVariableOverridable,
  registerEnvironmentVariables,
} from "../../server/config/env-registry";
import {
  runVariableOnWrite,
  validateVariableValue,
  redactVariableForRead,
} from "../../server/modules/system/variable-registry";

const TEST_ENV = "TEST_ENV_OVERRIDE_ROWS_VAR";
const ROW = envOverrideVariableName(TEST_ENV);
const RENAMED = "renamed_out_of_env_namespace_test";

async function cleanup() {
  for (const n of [ROW, RENAMED]) {
    const row = await storage.variables.getByName(n);
    if (row) await storage.variables.delete(row.id);
  }
  await refreshEnvOverrides();
}

describe("environment override rows", () => {
  beforeAll(async () => {
    registerEnvironmentVariables([
      { name: TEST_ENV, description: "test", secret: false, category: "core" },
    ]);
    await cleanup();
    await initEnvOverrides();
  });

  afterAll(async () => {
    await cleanup();
  });

  it("overridability covers registered names only, with no denylist", () => {
    expect(isEnvironmentVariableOverridable(TEST_ENV), "registered var overridable").toBe(true);
    expect(
      isEnvironmentVariableOverridable("SESSION_SECRET"),
      "SESSION_SECRET overridable (owner decision)",
    ).toBe(true);
    expect(
      isEnvironmentVariableOverridable("NOT_A_REAL_VAR_XYZ"),
      "unregistered not overridable",
    ).toBe(false);
  });

  it("ENV_* row values are validated: string only, no empty, no sentinel", () => {
    expect(validateVariableValue(ROW, "x").ok, "ENV_* accepts string").toBe(true);
    expect(validateVariableValue(ROW, "").ok, "ENV_* rejects empty").toBe(false);
    expect(
      validateVariableValue(ROW, "__UNSET__").ok,
      "ENV_* rejects sentinel",
    ).toBe(false);
    expect(validateVariableValue(ROW, { a: 1 }).ok, "ENV_* rejects object").toBe(false);
  });

  it("create + hook populates the cache; the real environment still wins", async () => {
    const created = await storage.variables.create({ name: ROW, value: "row-value" });
    try {
      await runVariableOnWrite(ROW);
      expect(
        getEnvOverrideMap().get(TEST_ENV),
        "cache has override after create+hook",
      ).toBe("row-value");

      // Simulating raw environment values is the point of these assertions, so
      // they use the sanctioned whole-environment accessor rather than
      // touching the environment object directly.
      const env = getRawProcessEnv();
      delete env[TEST_ENV];
      expect(
        getEnvironmentVariable(TEST_ENV),
        "getter serves override when env absent",
      ).toBe("row-value");
      env[TEST_ENV] = "real-env";
      expect(getEnvironmentVariable(TEST_ENV), "real env wins").toBe("real-env");
      env[TEST_ENV] = "__UNSET__";
      expect(
        getEnvironmentVariable(TEST_ENV),
        "__UNSET__ releases to override",
      ).toBe("row-value");
      delete env[TEST_ENV];

      // Redaction: non-secret env var's override value is readable; unknown
      // redacted.
      expect(
        redactVariableForRead({ name: ROW, value: "row-value" }).value,
        "non-secret ENV_* not redacted",
      ).toBe("row-value");
      expect(
        redactVariableForRead({ name: "ENV_TOTALLY_UNKNOWN", value: "v" }).value,
        "unknown ENV_* redacted defensively",
      ).toBe("[redacted]");

      // Rename OUT of the ENV_ namespace via the generic update path: the
      // route runs hooks for BOTH names; simulate exactly that.
      await storage.variables.update(created.id, { name: RENAMED });
      for (const hookName of Array.from(new Set([ROW, RENAMED]))) {
        await runVariableOnWrite(hookName);
      }
      expect(
        getEnvOverrideMap().get(TEST_ENV),
        "override gone after rename out of namespace",
      ).toBeUndefined();
      expect(
        getEnvironmentVariable(TEST_ENV),
        "getter no longer serves override",
      ).toBeUndefined();

      // Rename BACK into the namespace: hook for new name restores it.
      await storage.variables.update(created.id, { name: ROW });
      for (const hookName of Array.from(new Set([RENAMED, ROW]))) {
        await runVariableOnWrite(hookName);
      }
      expect(
        getEnvOverrideMap().get(TEST_ENV),
        "override restored after rename back",
      ).toBe("row-value");

      // Delete via generic path (delete + hook for the row name).
      await storage.variables.delete(created.id);
      await runVariableOnWrite(ROW);
      expect(
        getEnvOverrideMap().get(TEST_ENV),
        "override gone after delete+hook",
      ).toBeUndefined();
    } finally {
      await cleanup();
    }
  });
});
