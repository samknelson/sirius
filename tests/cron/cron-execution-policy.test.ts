import { afterEach, describe, expect, it } from "vitest";
import {
  setEnvironmentVariableOverride,
} from "../../server/config/env-registry";
import {
  assertCronExecutionAllowed,
  CronExecutionSuppressedError,
  getCronExecutionPolicy,
} from "../../server/cron/execution-policy";

const originalNodeEnv = process.env.NODE_ENV;
const originalCronExecution = process.env.CRON_EXECUTION;

afterEach(() => {
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
  if (originalCronExecution === undefined) delete process.env.CRON_EXECUTION;
  else process.env.CRON_EXECUTION = originalCronExecution;
  setEnvironmentVariableOverride("CRON_EXECUTION", null);
});

describe("cron deployment execution policy", () => {
  it("allows an explicitly enabled production deployment", () => {
    process.env.NODE_ENV = "production";
    process.env.CRON_EXECUTION = "enabled";
    expect(getCronExecutionPolicy().allowed).toBe(true);
    expect(() => assertCronExecutionAllowed()).not.toThrow();
  });

  it("suppresses an explicitly disabled production deployment", () => {
    process.env.NODE_ENV = "production";
    process.env.CRON_EXECUTION = "disabled";
    const policy = getCronExecutionPolicy();
    expect(policy.allowed).toBe(false);
    expect(policy.configuredValue).toBe("disabled");
    expect(() => assertCronExecutionAllowed()).toThrow(CronExecutionSuppressedError);
  });

  it("fails closed when production configuration is missing or invalid", () => {
    process.env.NODE_ENV = "production";
    delete process.env.CRON_EXECUTION;
    expect(getCronExecutionPolicy()).toMatchObject({
      allowed: false,
      configuredValue: "missing",
    });

    process.env.CRON_EXECUTION = "yes";
    expect(getCronExecutionPolicy()).toMatchObject({
      allowed: false,
      configuredValue: "invalid",
    });
  });

  it("does not let a copied database override enable production cron", () => {
    process.env.NODE_ENV = "production";
    delete process.env.CRON_EXECUTION;
    setEnvironmentVariableOverride("CRON_EXECUTION", () => "enabled");
    expect(getCronExecutionPolicy()).toMatchObject({
      allowed: false,
      configuredValue: "invalid",
    });
  });

  it("keeps local development usable when the setting is absent", () => {
    process.env.NODE_ENV = "development";
    delete process.env.CRON_EXECUTION;
    expect(getCronExecutionPolicy()).toMatchObject({
      allowed: true,
      configuredValue: "missing",
    });
  });
});