import { registerWizardPlugin } from "../registry";
import type {
  WizardPlugin,
  WizardStepHandler,
  WizardStepContext,
  WizardCreateContext,
  WizardCreateResult,
} from "../types";
import type { FeedWizard, FeedField } from "../../../wizards/feed";
import { gbhetLegalWorkersMonthly } from "../../../wizards/types/gbhet_legal_workers_monthly";
import { gbhetLegalWorkersCorrections } from "../../../wizards/types/gbhet_legal_workers_corrections";
import { createUnifiedOptionsStorage } from "../../../storage/unified-options";
import {
  buildUploadStep,
  buildMapStep,
  buildProcessStep,
  buildFeedResultsStep,
} from "./feed-steps";

/**
 * GBHET legal workers feeds (monthly + corrections), in a box. Both are
 * employer-scoped feed wizards that add ZERO routes:
 *
 *   Upload → Map → Benefits → Validate → Process → Review
 *
 * Two steps are wizard-specific and use the fixed dispatcher escape hatches
 * (no bespoke routes):
 *
 *   - `benefits` (custom): associate mapped benefit-eligibility columns with
 *     trust benefits, stored as `benefitConfig` on `wizard.data` via the
 *     generic submit route.
 *   - `validate` (run + submit + data): the base feed validation surfaces
 *     unrecognized employment statuses; the client maps them and saves via
 *     the generic submit route (status-mapping is handled by a GENERIC step
 *     handler, not a wizard-specific endpoint) and re-runs validation.
 *
 * Entity-scoping (admin OR employer.mine) is enforced generically by the
 * dispatcher + create route from `entityType: "employer"`.
 */

const optionsStorage = createUnifiedOptionsStorage();

/** Field ids of mapped benefit-eligibility columns (from either mapping shape). */
function mappedBenefitFieldIds(feed: FeedWizard, data: any): string[] {
  const mapping: Record<string, string> = data.columnMapping || {};
  const keys = Object.keys(mapping);
  const isOldFormat = keys.length > 0 && keys.every((k) => k.startsWith("col_"));
  const mappedIds = new Set<string>(
    isOldFormat
      ? (Object.values(mapping).filter(
          (v) => v && v !== "_unmapped",
        ) as string[])
      : keys.filter((k) => mapping[k] && mapping[k] !== "_unmapped"),
  );
  return (feed.getFields?.() ?? [])
    .filter(
      (f: FeedField) =>
        f.type === "benefit" &&
        (f as any).isBenefitEligibility &&
        mappedIds.has(f.id),
    )
    .map((f: FeedField) => f.id);
}

interface BenefitFieldConfig {
  fieldId: string;
  benefitId: string;
  benefitName?: string;
}

/** `custom` benefits step: map benefit-eligibility columns to trust benefits. */
function buildBenefitsStep(feed: FeedWizard): WizardStepHandler {
  return {
    id: "benefits",
    name: "Benefits",
    description: "Associate benefit eligibility columns with trust benefits",
    kind: "custom",
    component: "GbhetBenefits",
    getState: (wizard) => {
      const data = (wizard.data as any) || {};
      // Nothing to configure if no benefit-eligibility column was mapped.
      if (mappedBenefitFieldIds(feed, data).length === 0) return "completed";
      if (Array.isArray(data.benefitConfig)) return "completed";
      return wizard.currentStep === "benefits" ? "in_progress" : "pending";
    },
    submit: (ctx: WizardStepContext) => {
      const input = ctx.input as { benefitConfig?: BenefitFieldConfig[] };
      const benefitConfig = Array.isArray(input.benefitConfig)
        ? input.benefitConfig
        : [];
      return { data: { benefitConfig } };
    },
  };
}

/**
 * `validate` step — run + status-mapping submit + data read, all through the
 * fixed dispatcher routes. The step is `completed` (Next enabled) only once
 * validation has run clean AND every employment status is mapped.
 */
function buildGbhetValidateStep(feed: FeedWizard): WizardStepHandler {
  return {
    id: "validate",
    name: "Validate",
    description: "Validate rows and map any unrecognized employment statuses",
    kind: "run",
    component: "GbhetValidate",
    getState: (wizard) => {
      const data = (wizard.data as any) || {};
      const vr = data.validationResults;
      if (!vr) return wizard.currentStep === "validate" ? "in_progress" : "pending";
      const clean =
        (vr.invalidRows ?? 0) === 0 &&
        !(vr.unmappedStatuses && vr.unmappedStatuses.length > 0);
      if (clean) return "completed";
      return wizard.currentStep === "validate" ? "in_progress" : "pending";
    },
    run: async (ctx: WizardStepContext) => {
      await feed.validateFeedData(ctx.wizardId, 100, (p) => {
        const pct =
          p.total > 0
            ? Math.min(99, Math.round((p.processed / p.total) * 100))
            : 0;
        void ctx.reportProgress(pct);
      });
      // validationResults (incl. unmappedStatuses / ssnWarnings) persisted by
      // the base method; nothing to merge here.
    },
    getData: async (ctx: WizardStepContext) => {
      const data = (ctx.wizard.data as any) || {};
      const employerId = ctx.wizard.entityId;
      const existingMappings = employerId
        ? await ctx.storage.wizardEmploymentStatusMappings.getByEmployer(
            employerId,
          )
        : [];
      return {
        validationResults: data.validationResults ?? null,
        existingMappings,
      };
    },
    submit: async (ctx: WizardStepContext) => {
      const employerId = ctx.wizard.entityId;
      if (!employerId) {
        throw new Error("This wizard is not linked to an employer");
      }
      const input = ctx.input as {
        mappings?: Array<{ sourceStatus: string; targetStatusId: string }>;
      };
      const mappings = input.mappings;
      if (!Array.isArray(mappings) || mappings.length === 0) {
        throw new Error("A non-empty mappings array is required");
      }
      for (const m of mappings) {
        if (!m || !m.sourceStatus || !m.targetStatusId) {
          throw new Error(
            "Each mapping must have a sourceStatus and a targetStatusId",
          );
        }
      }
      const validStatuses = await optionsStorage.list("employment-status");
      const validStatusIds = new Set(validStatuses.map((s: any) => s.id));
      for (const m of mappings) {
        if (!validStatusIds.has(m.targetStatusId)) {
          throw new Error(`Invalid target status ID: ${m.targetStatusId}`);
        }
      }
      await ctx.storage.wizardEmploymentStatusMappings.upsertBatch(
        employerId,
        mappings,
      );
      // No data merge — the client re-runs validation to clear the unmapped
      // statuses now that the mappings exist.
      return {};
    },
  };
}

function buildGbhetSteps(feed: FeedWizard): WizardStepHandler[] {
  return [
    buildUploadStep(feed, "Upload the legal workers file"),
    buildMapStep(feed, "Map Columns", "Map file columns to legal worker fields"),
    buildBenefitsStep(feed),
    buildGbhetValidateStep(feed),
    buildProcessStep(feed),
    buildFeedResultsStep({ id: "review", name: "Review" }),
  ];
}

/** Shared year/month launch-argument parse + validation. */
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
      error: "An employer is required for legal workers monthly wizards",
      status: 400,
    };
  }
  const parsed = parseYearMonth(ctx.input);
  if ("error" in parsed) return parsed;
  const result = await ctx.storage.wizards.createMonthlyWizard({
    wizard: ctx.input as any,
    employerId: entityId,
    year: parsed.year,
    month: parsed.month,
  });
  if (!result.success || !result.wizard) {
    return { error: result.error ?? "Failed to create wizard", status: 400 };
  }
  return { wizard: result.wizard };
}

async function createCorrections(
  ctx: WizardCreateContext,
): Promise<WizardCreateResult> {
  const entityId = ctx.input.entityId;
  if (!entityId) {
    return {
      error: "An employer is required for legal workers corrections wizards",
      status: 400,
    };
  }
  const parsed = parseYearMonth(ctx.input);
  if ("error" in parsed) return parsed;
  const result = await ctx.storage.wizards.createCorrectionsWizard({
    wizard: ctx.input as any,
    employerId: entityId,
    year: parsed.year,
    month: parsed.month,
  });
  if (!result.success || !result.wizard) {
    return { error: result.error ?? "Failed to create wizard", status: 400 };
  }
  return { wizard: result.wizard };
}

const LAUNCH_ARGUMENTS = [
  { id: "year", name: "Year", type: "year", required: true },
  { id: "month", name: "Month", type: "month", required: true },
];

export const gbhetLegalWorkersMonthlyPlugin: WizardPlugin = {
  id: "gbhet_legal_workers_monthly",
  name: "GBHET Legal Workers Monthly",
  description: "Monthly legal workers feed for an employer",
  requiredComponent: "sitespecific.gbhet.legal",
  entityType: "employer",
  category: "Feed",
  launchArguments: LAUNCH_ARGUMENTS,
  create: createMonthly,
  steps: buildGbhetSteps(gbhetLegalWorkersMonthly),
};

export const gbhetLegalWorkersCorrectionsPlugin: WizardPlugin = {
  id: "gbhet_legal_workers_corrections",
  name: "GBHET Legal Workers Corrections",
  description: "Corrections feed for a completed monthly legal workers wizard",
  requiredComponent: "sitespecific.gbhet.legal",
  entityType: "employer",
  category: "Feed",
  launchArguments: LAUNCH_ARGUMENTS,
  create: createCorrections,
  steps: buildGbhetSteps(gbhetLegalWorkersCorrections),
};

registerWizardPlugin(gbhetLegalWorkersMonthlyPlugin);
registerWizardPlugin(gbhetLegalWorkersCorrectionsPlugin);
