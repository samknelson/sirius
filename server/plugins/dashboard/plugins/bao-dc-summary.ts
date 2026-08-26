import { registerDashboardPlugin } from "../registry";
import type { DashboardPlugin } from "../types";
import {
  getDcUpcomingPopulations,
  listDcActiveGrants,
  listDcApprovalQueue,
  listDcMaxedOutWorkers,
  listDcUploadReviewFindings,
  getDcNetGrantActivity,
} from "../../../services/sitespecific/bao/dc-reporting";

/**
 * Disability Credit operational dashboard — live views only (every number is
 * derived at read time from case/month/event/hours rows). BAO-gated, staff.
 *
 * Actions:
 *  - (default)      populations + active grants + queue + max-out + net
 *  - upload-review  the heavier upload-anomaly scan, loaded on demand
 */
export const baoDcSummaryPlugin: DashboardPlugin = {
  id: "bao-dc-summary",
  name: "Disability Credit",
  description:
    "Live Disability Credit operations: upcoming populations (FMLA-eligible, active denial letters, upcoming months), active grants, approval queue, annual max-out, upload review, and net grant activity",
  requiredComponent: "sitespecific.bao",
  requiredPolicy: "staff",

  content: {
    // Default (no-action) content — the main dashboard payload.
    "": async () => {
      const [populations, activeGrants, queue, maxedOut, netActivity] =
        await Promise.all([
          getDcUpcomingPopulations(),
          listDcActiveGrants(),
          listDcApprovalQueue(),
          listDcMaxedOutWorkers(),
          getDcNetGrantActivity(),
        ]);
      return { populations, activeGrants, queue, maxedOut, netActivity };
    },
    "upload-review": async () => ({
      findings: await listDcUploadReviewFindings(),
    }),
  },

  client: {
    component: "bao-dc-summary:BaoDcSummary",
    order: 7,
    requiredPermissions: ["staff", "admin"],
  },
};

registerDashboardPlugin(baoDcSummaryPlugin);
