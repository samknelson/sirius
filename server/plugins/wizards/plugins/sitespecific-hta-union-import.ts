import { registerWizardPlugin } from "../registry";
import type { WizardPlugin, WizardStepContext } from "../types";
import {
  HtaUnionImportWizard,
  type HtaInactivityScanSummary,
} from "../engine/types/hta_union_import";
import { storage } from "../../../storage";
import { createUnifiedOptionsStorage } from "../../../storage/unified-options";
import { isComponentEnabled } from "../../../modules/components";
import { logger } from "../../../logger";
import {
  buildUploadStep,
  buildMapStep,
  buildValidateStep,
  buildProcessStep,
  buildFeedResultsStep,
  prepareFeedDataUpdate,
} from "./feed-steps";

const HTA_COMPONENT = "sitespecific.hta";
const unifiedOptionsStorage = createUnifiedOptionsStorage();

export interface WorkerScanDetail {
  workerId: string;
  workerName: string;
  currentStatus: string;
  lastActiveDate: string | null;
  action: "deactivated" | "already_inactive" | "still_active" | "error";
  reason: string;
}

export interface InactivityScanResult {
  scanned: number;
  deactivated: number;
  alreadyInactive: number;
  stillActive: number;
  errors: string[];
  mode: "live" | "test";
  details: WorkerScanDetail[];
}

export interface InactivityScanOptions {
  /** "test" reports what would happen without writing. Default "test". */
  mode?: "live" | "test";
  /** Option lists already loaded by the import (fetched when omitted). */
  workStatusOptions?: Array<{ id: string; name: string }>;
  memberStatusOptions?: Array<{ id: string; name: string }>;
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * HTA inactivity scan. Each Union roster import writes a dated work-status
 * entry per worker; this deactivates every worker currently holding the
 * "Union" member status whose most recent work status is "Active" but whose
 * last "Active" entry is three months old or older. Only meaningful right
 * after a Union import, which is the only caller.
 */
export async function runHtaInactivityScan(
  options: InactivityScanOptions = {},
): Promise<InactivityScanResult> {
  const mode = options.mode || "test";
  const result: InactivityScanResult = {
    scanned: 0,
    deactivated: 0,
    alreadyInactive: 0,
    stillActive: 0,
    errors: [],
    mode,
    details: [],
  };

  if (!(await isComponentEnabled(HTA_COMPONENT))) {
    result.errors.push(`Component "${HTA_COMPONENT}" is not enabled; inactivity scan skipped`);
    return result;
  }

  const msOptions =
    options.memberStatusOptions ?? (await unifiedOptionsStorage.list("worker-ms"));
  const unionMsOption = msOptions.find((o) => o.name.toLowerCase() === "union");
  if (!unionMsOption) {
    result.errors.push('No "Union" member status option found in options_worker_ms');
    return result;
  }

  const wsOptions =
    options.workStatusOptions ?? (await unifiedOptionsStorage.list("worker-ws"));
  const activeWsOption = wsOptions.find((o) => o.name.toLowerCase() === "active");
  const inactiveWsOption = wsOptions.find((o) => o.name.toLowerCase() === "inactive");
  if (!activeWsOption) {
    result.errors.push('No "Active" work status option found in options_worker_ws');
    return result;
  }
  if (!inactiveWsOption) {
    result.errors.push('No "Inactive" work status option found in options_worker_ws');
    return result;
  }
  const wsNames = new Map(wsOptions.map((o) => [o.id, o.name]));

  // One row per (worker, industry) currently holding Union; a worker may
  // hold it in several industries, so dedupe.
  const holders = await storage.workerMsh.getWorkerIdsWithCurrentMs([unionMsOption.id]);
  const targetWorkerIds = Array.from(new Set(holders.map((h) => h.workerId)));
  result.scanned = targetWorkerIds.length;

  const now = new Date();
  const today = ymd(now);
  const cutoff = ymd(new Date(now.getFullYear(), now.getMonth() - 3, now.getDate()));

  for (const workerId of targetWorkerIds) {
    try {
      const workerName = await storage.workers.getWorkerDisplayName(workerId);
      // Newest first, same tie-break as the current-status lookup.
      const history: Array<{ wsId: string; date: string }> =
        await storage.workerWsh.getWorkerWsh(workerId);
      const currentWsId = history[0]?.wsId ?? null;
      const currentStatus = currentWsId
        ? wsNames.get(currentWsId) || "Unknown"
        : "No entries";

      if (currentWsId !== activeWsOption.id) {
        result.alreadyInactive++;
        result.details.push({
          workerId,
          workerName,
          currentStatus,
          lastActiveDate: null,
          action: "already_inactive",
          reason: `Most recent work status is "${currentStatus}" (not Active)`,
        });
        continue;
      }

      const lastActiveDate =
        history.find((e) => e.wsId === activeWsOption.id)?.date ?? null;

      if (!lastActiveDate || lastActiveDate <= cutoff) {
        if (mode === "live") {
          await storage.workerWsh.createWorkerWsh({
            workerId,
            date: today,
            wsId: inactiveWsOption.id,
            data: { source: "hta_inactivity_scan" },
          });
        }
        result.deactivated++;
        result.details.push({
          workerId,
          workerName,
          currentStatus,
          lastActiveDate,
          action: "deactivated",
          reason: lastActiveDate
            ? `Last Active entry on ${lastActiveDate} is older than 3 months (cutoff: ${cutoff})`
            : "No Active work status entry found",
        });
      } else {
        result.stillActive++;
        result.details.push({
          workerId,
          workerName,
          currentStatus,
          lastActiveDate,
          action: "still_active",
          reason: `Last Active entry on ${lastActiveDate} is within 3 months`,
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result.errors.push(`Error processing worker ${workerId}: ${message}`);
      result.details.push({
        workerId,
        workerName: workerId,
        currentStatus: "Unknown",
        lastActiveDate: null,
        action: "error",
        reason: message,
      });
      logger.error(`Inactivity scan error for worker ${workerId}`, {
        service: "hta-inactivity-scan",
        error: message,
      });
    }
  }

  logger.info(
    `Inactivity scan complete (${mode}): scanned=${result.scanned}, deactivated=${result.deactivated}, alreadyInactive=${result.alreadyInactive}, errors=${result.errors.length}`,
    { service: "hta-inactivity-scan" },
  );
  return result;
}

/** The HTA import engine with this plugin's inactivity scan plugged in. */
class SitespecificHtaUnionImportWizard extends HtaUnionImportWizard {
  protected override async runInactivityScan(): Promise<HtaInactivityScanSummary> {
    const r = await runHtaInactivityScan({
      mode: "live",
      workStatusOptions: await this.getWorkStatusOptions(),
      memberStatusOptions: await this.getMemberStatusOptions(),
    });
    return {
      scanned: r.scanned,
      deactivated: r.deactivated,
      alreadyInactive: r.alreadyInactive,
      stillActive: r.stillActive,
      errors: r.errors,
      details: r.details,
    };
  }
}

const feed = new SitespecificHtaUnionImportWizard();

/**
 * HTA union / apprentice import, in a box. Upload → Configure (Union vs
 * Apprentice) → Map → Validate → Process → Review. The legacy wizard took
 * `memberStatusType` as a launch argument; here it is captured as an
 * in-wizard `form` step that writes `launchArguments.memberStatusType` on
 * `wizard.data` (where `HtaUnionImportWizard.getMemberStatusType` reads it),
 * so no framework launch-argument plumbing — and no wizard route — is
 * needed. The inactivity scan (defined above) runs automatically after a Union
 * import via the engine's `runInactivityScan` hook.
 */
export const htaUnionImportPlugin: WizardPlugin = {
  id: "hta_union_import",
  name: "HTA Union/Apprentice Import",
  description:
    "Import union or apprentice members from HTA files, updating worker, employment, and contact records",
  requiredComponent: "sitespecific.hta",
  category: "Import",
  prepareUpdate: prepareFeedDataUpdate,
  steps: [
    buildUploadStep(feed, "Upload the member data file"),
    {
      id: "configure",
      name: "Configure",
      description: "Choose whether this import is for Union or Apprentice members",
      kind: "form",
      schema: {
        type: "object",
        properties: {
          memberStatusType: {
            type: "string",
            title: "Member Status Type",
            description:
              "Union or Apprentice — controls hours handling and the inactivity scan.",
            enum: ["Union", "Apprentice"],
            default: "Union",
          },
        },
        required: ["memberStatusType"],
      },
      getState: (wizard) => {
        const data = (wizard.data as any) || {};
        if (data.launchArguments?.memberStatusType) return "completed";
        return wizard.currentStep === "configure" ? "in_progress" : "pending";
      },
      submit: (ctx: WizardStepContext) => {
        const input = ctx.input as { memberStatusType?: string };
        const memberStatusType = input.memberStatusType || "Union";
        const existing =
          ((ctx.wizard.data as any)?.launchArguments as Record<
            string,
            unknown
          >) || {};
        return {
          data: { launchArguments: { ...existing, memberStatusType } },
        };
      },
    },
    buildMapStep(feed, "Map", "Map file columns to member fields"),
    buildValidateStep(feed),
    buildProcessStep(feed),
    buildFeedResultsStep({
      id: "review",
      name: "Review",
      description: "Review import results",
    }),
  ],
};

registerWizardPlugin(htaUnionImportPlugin);
