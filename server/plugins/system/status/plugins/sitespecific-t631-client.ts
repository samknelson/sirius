import { registerSystemStatusPlugin } from "../registry";
import type { StatusMessage } from "../types";
import {
  getEnvironmentVariable,
  registerEnvironmentVariables,
} from "../../../../config/env-registry";
import { isMaintenanceModeError } from "../../../../services/maintenance-flag";

// changeTakesEffect: "immediate" for all five — see the matching registration
// in server/modules/sitespecific/t631/client/fetch.ts, whose getConfig()
// re-reads them per request. This plugin re-reads them per status scan.
// Registration is last-one-wins, so both copies must stay in step.
registerEnvironmentVariables([
  { name: "SITESPECIFIC_T631_CLIENT_URL", description: "Base URL of the remote T631 service.", secret: false, category: "sitespecific.t631.client", changeTakesEffect: "immediate", },
  { name: "SITESPECIFIC_T631_CLIENT_ACCOUNT_ID", description: "Account id for the remote T631 service.", secret: false, category: "sitespecific.t631.client", changeTakesEffect: "immediate", },
  { name: "SITESPECIFIC_T631_CLIENT_ACCESS_TOKEN", description: "Access token for the remote T631 service.", secret: true, category: "sitespecific.t631.client", changeTakesEffect: "immediate", },
  { name: "SITESPECIFIC_T631_CLIENT_EMPLOYER_ID", description: "Employer id for the remote T631 service.", secret: false, category: "sitespecific.t631.client", changeTakesEffect: "immediate", },
  { name: "SITESPECIFIC_T631_CLIENT_EMPLOYER_TOKEN", description: "Employer token for the remote T631 service.", secret: true, category: "sitespecific.t631.client", changeTakesEffect: "immediate", },
]);

const REQUIRED_ENV_VARS = [
  "SITESPECIFIC_T631_CLIENT_URL",
  "SITESPECIFIC_T631_CLIENT_ACCOUNT_ID",
  "SITESPECIFIC_T631_CLIENT_ACCESS_TOKEN",
  "SITESPECIFIC_T631_CLIENT_EMPLOYER_ID",
  "SITESPECIFIC_T631_CLIENT_EMPLOYER_TOKEN",
] as const;

/**
 * Status plugin contributed by the sitespecific.t631.client component:
 * hidden entirely when the component is disabled (framework component
 * gating), notice when the client is unconfigured, error when the remote
 * service ping fails.
 */
registerSystemStatusPlugin({
  id: "sitespecific.t631.client",
  name: "T631 Client",
  description: "Connection status of the remote T631 service.",
  requiredComponent: "sitespecific.t631.client",
  async scan(): Promise<StatusMessage[]> {
    const missing = REQUIRED_ENV_VARS.filter((name) => !getEnvironmentVariable(name));
    if (missing.length > 0) {
      return [
        {
          priority: "notice",
          title: "T631 client not configured",
          details: `Missing environment variables: ${missing.join(", ")}.`,
        },
      ];
    }
    const host = (() => {
      try {
        return new URL(getEnvironmentVariable("SITESPECIFIC_T631_CLIENT_URL")!).hostname;
      } catch {
        return "(invalid URL)";
      }
    })();
    try {
      const { t631Fetch } = await import(
        "../../../../modules/sitespecific/t631/client/fetch"
      );
      const result = await t631Fetch("sirius_service_ping");
      if (result.success) {
        return [
          {
            priority: "info",
            title: "T631 service reachable",
            details: `Ping to ${host} succeeded in ${result.durationMs}ms.`,
          },
        ];
      }
      return [
        {
          priority: "error",
          title: "T631 service ping failed",
          details: `Ping to ${host} failed${result.response ? ` (HTTP ${result.response.status})` : ""}${result.error ? ` — ${result.error}` : ""}.`,
        },
      ];
    } catch (error) {
      // A maintenance refusal is not a broken remote service: nothing was
      // asked. Reported as the refusal it is, in the guard's own words.
      if (isMaintenanceModeError(error)) {
        return [
          {
            priority: "notice",
            title: "T631 service not contacted",
            details: error.message,
          },
        ];
      }
      return [
        {
          priority: "error",
          title: "T631 service ping failed",
          details: `Ping to ${host} threw — ${error instanceof Error ? error.message : String(error)}`,
        },
      ];
    }
  },
});
