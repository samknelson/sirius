import { registerWizardPlugin } from "../registry";
import type {
  WizardPlugin,
  WizardStepHandler,
  WizardStepContext,
  WizardCreateContext,
  WizardCreateResult,
  WizardUpdateContext,
  WizardUpdateResult,
} from "../types";
import type { JsonSchema } from "@shared/json-schema-form";
import { baoMonthlyHours } from "../engine/types/bao_monthly_hours";
import { buildGbhetValidateStep } from "./gbhet-legal-workers";
import {
  buildUploadStep,
  buildMapStep,
  buildProcessStep,
  buildFeedResultsStep,
  prepareFeedDataUpdate,
} from "./feed-steps";

/**
 * BAO Monthly Hours Upload wizard — employer-scoped monthly feed, gated by
 * the `sitespecific.bao` component:
 *
 *   Upload → Map → Validate → Verify New Workers → Process → Review
 *
 * Modeled on the GBHET legal-workers monthly wizard MINUS the benefits step,
 * PLUS a `verify` step: before processing, every row whose SSN matches no
 * existing worker is listed together with near-match candidates (same
 * name/DOB, different SSN) for optional review. Confirmed and unreviewed
 * rows create a new worker during processing (unreviewed rows carry a
 * warning in the results); explicitly rejected rows fail with a clear
 * per-row error instead of creating a possible duplicate.
 */

interface VerifyRow {
  rowIndex: number;
  ssnDigits: string;
  ssnMasked: string;
  firstName: string | null;
  lastName: string | null;
  dateOfBirth: string | null;
  candidates: Array<{
    id: string;
    siriusId: number | null;
    displayName: string | null;
    given: string | null;
    family: string | null;
    birthDate: string | null;
    ssnLast4: string | null;
  }>;
}

function maskSsnDigits(digits: string): string {
  if (digits.length < 4) return "***-**-****";
  return `***-**-${digits.slice(-4)}`;
}

function buildVerifyStep(): WizardStepHandler {
  return {
    id: "verify",
    name: "Verify New Workers",
    description:
      "Confirm or reject creation of workers whose SSN is not in the system",
    kind: "run",
    component: "VerifyNewWorkers",
    getState: (wizard) => {
      const data = (wizard.data as any) || {};
      // Verification only makes sense after a clean validation.
      const vr = data.validationResults;
      const validated =
        vr &&
        (vr.invalidRows ?? 0) === 0 &&
        !(vr.unmappedStatuses && vr.unmappedStatuses.length > 0);
      if (!validated) {
        return wizard.currentStep === "verify" ? "in_progress" : "pending";
      }
      const verify = data.verifyNewWorkers as
        | { rows: VerifyRow[]; completedAt?: string }
        | undefined;
      if (!verify) {
        return wizard.currentStep === "verify" ? "in_progress" : "pending";
      }
      // Once the scan has run, the step is complete: reviewing each row is
      // recommended but not required. Unreviewed rows are still created
      // during processing, with a warning attached; rejected rows are
      // skipped.
      return "completed";
    },
    run: async (ctx: WizardStepContext) => {
      const { mappedRows, wizard } = await baoMonthlyHours.loadMappedRows(
        ctx.wizardId,
      );

      const rows: VerifyRow[] = [];
      const seenSsns = new Set<string>();
      let processed = 0;
      for (let i = 0; i < mappedRows.length; i++) {
        const row = mappedRows[i];
        processed++;
        if (processed % 50 === 0) {
          const pct = Math.min(
            99,
            Math.round((processed / mappedRows.length) * 100),
          );
          void ctx.reportProgress(pct);
        }
        const rawSsn = row.ssn?.toString().trim();
        if (!rawSsn) continue;
        const digits = rawSsn.replace(/\D/g, "");
        if (digits.length === 0 || digits.length > 9) continue;
        const padded = digits.padStart(9, "0");
        if (seenSsns.has(padded)) continue;

        const existing = await ctx.storage.workers.getWorkerBySSN(padded);
        if (existing) continue;
        seenSsns.add(padded);

        const firstName = row.firstName?.toString().trim() || null;
        const lastName = row.lastName?.toString().trim() || null;
        let birthDate: string | null = null;
        const rawDob = row.dateOfBirth?.toString().trim();
        if (rawDob) {
          try {
            birthDate = (baoMonthlyHours as any).parseDate(rawDob) ?? null;
          } catch {
            birthDate = null;
          }
        }

        const candidates = await ctx.storage.workers.findPotentialSsnMatches({
          given: firstName,
          family: lastName,
          birthDate,
          employerId: wizard.entityId,
        });

        rows.push({
          rowIndex: i,
          ssnDigits: padded,
          ssnMasked: maskSsnDigits(padded),
          firstName,
          lastName,
          dateOfBirth: birthDate,
          candidates,
        });
      }

      // Drop stale decisions for SSNs no longer in the file.
      const data = (wizard.data as any) || {};
      const priorDecisions = (data.newWorkerDecisions || {}) as Record<
        string,
        string
      >;
      const keptDecisions: Record<string, string> = {};
      for (const r of rows) {
        if (priorDecisions[r.ssnDigits]) {
          keptDecisions[r.ssnDigits] = priorDecisions[r.ssnDigits];
        }
      }

      return {
        data: {
          verifyNewWorkers: {
            rows,
            completedAt: new Date().toISOString(),
          },
          newWorkerDecisions: keptDecisions,
        },
      };
    },
    getData: async (ctx: WizardStepContext) => {
      const data = (ctx.wizard.data as any) || {};
      return {
        verifyNewWorkers: data.verifyNewWorkers ?? null,
        newWorkerDecisions: data.newWorkerDecisions ?? {},
      };
    },
    submit: async (ctx: WizardStepContext) => {
      const input = ctx.input as {
        decisions?: Record<string, string>;
      };
      const decisions = input.decisions;
      if (!decisions || typeof decisions !== "object") {
        throw new Error("A decisions object is required");
      }
      const data = (ctx.wizard.data as any) || {};
      const verify = data.verifyNewWorkers as
        | { rows: VerifyRow[] }
        | undefined;
      if (!verify) {
        throw new Error(
          "Run the new-worker scan before submitting decisions",
        );
      }
      const knownSsns = new Set(verify.rows.map((r) => r.ssnDigits));
      const merged: Record<string, string> = {
        ...((data.newWorkerDecisions || {}) as Record<string, string>),
      };
      for (const [ssnDigits, decision] of Object.entries(decisions)) {
        if (!knownSsns.has(ssnDigits)) {
          throw new Error(
            `Decision submitted for an SSN not in the scan results`,
          );
        }
        if (decision !== "confirm" && decision !== "reject") {
          throw new Error(
            `Invalid decision "${decision}" — must be "confirm" or "reject"`,
          );
        }
        merged[ssnDigits] = decision;
      }
      return { data: { newWorkerDecisions: merged } };
    },
  };
}

/**
 * Wrap the shared feed prepareUpdate to ALSO clear verify-step data whenever
 * the upstream input changes (new upload, changed mapping/headers/mode) —
 * i.e. exactly when validationResults get cleared.
 */
function prepareBaoDataUpdate(ctx: WizardUpdateContext): WizardUpdateResult {
  const result = prepareFeedDataUpdate(ctx);
  if ("error" in result && result.error) return result;
  const mergedData = (result as { data?: any }).data;
  if (mergedData && mergedData.validationResults === undefined) {
    delete mergedData.verifyNewWorkers;
    delete mergedData.newWorkerDecisions;
    if (mergedData.progress) {
      delete mergedData.progress.verify;
    }
  }
  return result;
}

function buildBaoSteps(): WizardStepHandler[] {
  return [
    buildUploadStep(baoMonthlyHours, "Upload the monthly hours file"),
    buildMapStep(
      baoMonthlyHours,
      "Map Columns",
      "Map file columns to worker hour fields",
    ),
    buildGbhetValidateStep(baoMonthlyHours),
    buildVerifyStep(),
    buildProcessStep(baoMonthlyHours),
    buildFeedResultsStep({ id: "review", name: "Review" }),
  ];
}

function parseYearMonth(
  input: WizardCreateContext["input"],
): { year: number; month: number } | { error: string; status: number } {
  const la = ((input.data as any)?.launchArguments as any) || {};
  const year = Number(la.year);
  const month = Number(la.month);
  if (!Number.isInteger(year) || year < 1900 || year > 2100) {
    return {
      error: "Year must be a valid integer between 1900 and 2100",
      status: 400,
    };
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    return { error: "Month must be an integer between 1 and 12", status: 400 };
  }
  return { year, month };
}

async function createMonthly(
  ctx: WizardCreateContext,
): Promise<WizardCreateResult> {
  const entityId = ctx.input.entityId;
  if (!entityId) {
    return {
      error: "An employer is required for BAO monthly hours wizards",
      status: 400,
    };
  }
  const parsed = parseYearMonth(ctx.input);
  if ("error" in parsed) return parsed;
  const existing = await ctx.storage.wizards.findMonthlyWizardsForPeriod(
    entityId,
    parsed.year,
    parsed.month,
    "bao_monthly_hours",
  );
  if (existing.length > 0) {
    return {
      error: `A BAO monthly hours wizard already exists for this employer in ${parsed.month}/${parsed.year}`,
      status: 400,
    };
  }
  const wizard = await ctx.storage.wizards.createMonthlyWizard({
    wizard: ctx.input as any,
    employerId: entityId,
    year: parsed.year,
    month: parsed.month,
  });
  return { wizard };
}

const LAUNCH_SCHEMA: JsonSchema = {
  type: "object",
  required: ["year", "month"],
  properties: {
    year: {
      type: "integer",
      title: "Year",
      minimum: 1900,
      maximum: 2100,
    },
    month: {
      type: "integer",
      title: "Month",
      enum: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
      enumNames: [
        "January",
        "February",
        "March",
        "April",
        "May",
        "June",
        "July",
        "August",
        "September",
        "October",
        "November",
        "December",
      ],
    },
  },
};

export const baoMonthlyHoursPlugin: WizardPlugin = {
  id: "bao_monthly_hours",
  name: "BAO Monthly Hours Upload",
  description:
    "Monthly hours upload for a BAO employer, with new-worker verification and optional employee withholding payments",
  requiredComponent: "sitespecific.bao",
  entityType: "employer",
  category: "Feed",
  isMonthly: true,
  launchSchema: LAUNCH_SCHEMA,
  create: createMonthly,
  prepareUpdate: prepareBaoDataUpdate,
  getFields: () => baoMonthlyHours.getFields?.() ?? [],
  steps: buildBaoSteps(),
};

registerWizardPlugin(baoMonthlyHoursPlugin);
