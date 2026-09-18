import {
  getEnvironmentVariable,
  isEnvironmentVariableSetInProcess,
} from "../config/env-registry";

export const CRON_EXECUTION_ENV = "CRON_EXECUTION";

export interface CronExecutionPolicy {
  allowed: boolean;
  configuredValue: "enabled" | "disabled" | "missing" | "invalid";
  reason: string;
  requiresRestartAfterDatabaseRefresh: boolean;
}

/**
 * The one authority for whether this process may execute cron work.
 *
 * Production is deliberately stricter than development: the value must be
 * supplied by the deployment itself. A copied database override therefore
 * cannot accidentally turn cron on in PROD after a refresh.
 */
export function getCronExecutionPolicy(): CronExecutionPolicy {
  const raw = getEnvironmentVariable(CRON_EXECUTION_ENV)?.trim().toLowerCase();
  const deployed = getEnvironmentVariable("NODE_ENV") === "production";
  const deploymentConfigured = isEnvironmentVariableSetInProcess(CRON_EXECUTION_ENV);

  if (deployed && !deploymentConfigured) {
    return {
      allowed: false,
      configuredValue: raw ? "invalid" : "missing",
      reason:
        "Cron execution is suppressed because this deployment does not explicitly set CRON_EXECUTION.",
      requiresRestartAfterDatabaseRefresh: true,
    };
  }

  if (raw === "enabled") {
    return {
      allowed: true,
      configuredValue: "enabled",
      reason: "Cron execution is enabled for this deployment.",
      requiresRestartAfterDatabaseRefresh: true,
    };
  }

  if (raw === "disabled") {
    return {
      allowed: false,
      configuredValue: "disabled",
      reason:
        "Cron configurations remain enabled in the database, but execution is suppressed for this deployment.",
      requiresRestartAfterDatabaseRefresh: true,
    };
  }

  if (!deployed && raw === undefined) {
    return {
      allowed: true,
      configuredValue: "missing",
      reason: "Cron execution is enabled by the local development default.",
      requiresRestartAfterDatabaseRefresh: true,
    };
  }

  return {
    allowed: false,
    configuredValue: raw === undefined ? "missing" : "invalid",
    reason: raw === undefined
      ? "Cron execution is suppressed because CRON_EXECUTION is not configured."
      : "Cron execution is suppressed because CRON_EXECUTION must be exactly enabled or disabled.",
    requiresRestartAfterDatabaseRefresh: true,
  };
}

export class CronExecutionSuppressedError extends Error {
  readonly code = "CRON_EXECUTION_SUPPRESSED";
  readonly status = 409;

  constructor(readonly policy: CronExecutionPolicy = getCronExecutionPolicy()) {
    super(policy.reason);
    this.name = "CronExecutionSuppressedError";
  }
}

export function assertCronExecutionAllowed(): CronExecutionPolicy {
  const policy = getCronExecutionPolicy();
  if (!policy.allowed) throw new CronExecutionSuppressedError(policy);
  return policy;
}