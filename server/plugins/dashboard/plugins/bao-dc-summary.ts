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
 * Four sections (Fund ruling): a linked FMLA-eligible COUNT (the complete
 * list lives on its own page), the approval queue, currently-on-DC (active
 * grants), and annual-maximum-reached. Denial-letter and upcoming-month
 * previews were removed; the authoritative reporting calculations behind
 * them are unchanged and still used elsewhere.
 *
 * Actions:
 *  - (default)      fmla count + queue + active grants + max-out + net
 *  - upload-review  the heavier upload-anomaly scan, loaded on demand
 */
export const baoDcSummaryPlugin: DashboardPlugin = {
  id: "bao-dc-summary",
  name: "Disability Credit",
  description:
    "Live Disability Credit operations: FMLA-eligible count, approval queue, workers currently on Disability Credit, annual max-out, upload review, and net grant activity",
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
      // Only the COUNT ships to the dashboard — the full list has its own
      // linked page backed by the same reporting service.
      return {
        fmlaEligibleCount: populations.fmlaEligible.length,
        activeGrants,
        queue,
        maxedOut,
        netActivity,
      };
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
