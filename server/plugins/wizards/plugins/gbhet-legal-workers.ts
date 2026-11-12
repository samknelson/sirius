import { registerWizardPlugin } from "../registry";
import type {
  WizardPlugin,
  WizardStepHandler,
  WizardStepContext,
  WizardCreateContext,
  WizardCreateResult,
  WizardUpdateContext,
} from "../types";
import type { FeedWizard } from "../engine/feed";
import type { GbhetLegalWorkersWizard } from "../engine/types/gbhet_legal_workers";
import { forecastLegalUpload } from "../gbhet-legal-forecast";
import { publishLegalCompletion } from "../gbhet-legal-completion.js";
import { getEffectiveUser } from "../../../modules/masquerade";
import { storage } from "../../../storage";
import {
  mappedBenefitFieldIds, benefitConfigurationError, REQUIRED_BENEFIT_MAPPING_MESSAGE,
  type BenefitFieldConfig,
} from "../../../../shared/gbhet-legal-benefits";
import { assertGbhetBenefitConfiguration, loadGbhetBenefitSetup } from "../gbhet-legal-benefits";
import type { JsonSchema } from "@shared/json-schema-form";
import { gbhetLegalWorkersMonthly } from "../engine/types/gbhet_legal_workers_monthly";
import { gbhetLegalWorkersCorrections } from "../engine/types/gbhet_legal_workers_corrections";
import { createUnifiedOptionsStorage } from "../../../storage/unified-options";
import {
  buildUploadStep,
  buildMapStep,
  buildProcessStep,
  buildFeedResultsStep,
  prepareFeedDataUpdate,
} from "./feed-steps";

/**
 * GBHET legal workers feeds (monthly + corrections), in a box. Both are
 * employer-scoped feed wizards that add ZERO routes:
 *
 *   Upload → Map → Benefits → Validate → Preview → Process → Review
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

function isHistoricalImport(wizard: { status: string; data: unknown }) {
  return ["completed", "completed_with_errors", "complete"].includes(wizard.status) &&
    !!(wizard.data as any)?.processResults;
}

/** A change in associations changes what validation approved. Keep explicit
 * choices, but discard downstream approvals/results rather than reusing them. */
function clearLegalDownstream(data: Record<string, any>) {
  const next: Record<string, any> = { ...data, progress: { ...data.progress } };
  // Step results are shallow-merged by the dispatcher: null explicitly clears
  // old approvals, whereas an omitted/deleted key would leave them in place.
  next.validationResults = null;
  next.processResults = null;
  next.legalPreviewApproval = null;
  next.legalPreview = null;
  for (const id of ["benefits", "validate", "preview", "process", "review"]) delete next.progress[id];
  return next;
}

async function prepareLegalUpdate(feed: FeedWizard, ctx: WizardUpdateContext) {
  const allowed = new Set(["columnMapping", "hasHeaders", "mode", "benefitConfig"]);
  if (Object.keys(ctx.incoming).some(key => !allowed.has(key))) {
    return { error: "Only column mapping, headers, import mode and benefit associations can be edited.", status: 400 };
  }
  if (isHistoricalImport(ctx.existing) || (ctx.existing.data as any)?.progress?.process?.status === "in_progress") {
    return { error: "This upload has already started processing and cannot be edited.", status: 400 };
  }
  const result = prepareFeedDataUpdate(ctx);
  if (result.error) return result;
  const incoming = ctx.incoming as any;
  const data = result.data as Record<string, any>;
  if (incoming.columnMapping !== undefined &&
      !mappedBenefitFieldIds(feed.getFields?.() ?? [], incoming.columnMapping).length) {
    return { error: REQUIRED_BENEFIT_MAPPING_MESSAGE, status: 400 };
  }
  if (incoming.benefitConfig !== undefined) {
    try {
      await assertGbhetBenefitConfiguration(storage, feed.getFields?.() ?? [], data);
    } catch (error) {
      return { error: (error as Error).message, status: 400 };
    }
  }
  const existing = (ctx.existing.data ?? {}) as Record<string, any>;
  const changed = ["columnMapping", "hasHeaders", "mode", "uploadedFileId", "benefitConfig"]
    .some(key => incoming[key] !== undefined && JSON.stringify(data[key]) !== JSON.stringify(existing[key]));
  return { data: changed ? clearLegalDownstream(data) : data };
}

/** `custom` benefits step: map benefit-eligibility columns to trust benefits. */
function buildBenefitsStep(feed: FeedWizard): WizardStepHandler {
  return {
    id: "benefits",
    name: "Benefits",
    description: "Associate benefit eligibility columns with trust benefits",
    kind: "custom",
    component: "GbhetBenefits",
    getState: async (wizard) => {
      if (isHistoricalImport(wizard)) return "completed";
      const data = (wizard.data as any) || {};
      try {
        await assertGbhetBenefitConfiguration(storage, feed.getFields?.() ?? [], data);
        return "completed";
      } catch {
        // Incomplete/missing/unavailable choices never authorize navigation.
      }
      return wizard.currentStep === "benefits" ? "in_progress" : "pending";
    },
    getData: async (ctx: WizardStepContext) => {
      const setup = await loadGbhetBenefitSetup(ctx.storage, feed.getFields?.() ?? [], ctx.wizard.entityId);
      const data = (ctx.wizard.data ?? {}) as Record<string, any>;
      return {
        ...setup, configurationError: benefitConfigurationError(
          mappedBenefitFieldIds(feed.getFields?.() ?? [], data.columnMapping), data.benefitConfig,
          new Set(setup.benefits.filter(benefit => benefit.isActive).map(benefit => benefit.id)),
        ),
      };
    },
    submit: async (ctx: WizardStepContext) => {
      const input = ctx.input as { benefitConfig?: BenefitFieldConfig[] };
      const benefitConfig = Array.isArray(input.benefitConfig)
        ? input.benefitConfig
        : [];
      const data = { ...(ctx.wizard.data as any), benefitConfig };
      await assertGbhetBenefitConfiguration(ctx.storage, feed.getFields?.() ?? [], data);
      return { data: clearLegalDownstream(data) };
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
    getState: async (wizard) => {
      if (isHistoricalImport(wizard)) return "completed";
      const data = (wizard.data as any) || {};
      try {
        await assertGbhetBenefitConfiguration(storage, feed.getFields?.() ?? [], data);
      } catch {
        return wizard.currentStep === "validate" ? "in_progress" : "pending";
      }
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
      // One call per mapping: each is an operator edit of its own record, and
      // the storage layer records it — log entry and provenance — one record
      // at a time. A batch method on the storage module could not; it would
      // reach its own unwrapped `upsert` and be invisible.
      for (const m of mappings) {
        await ctx.storage.wizardEmploymentStatusMappings.upsert(
          employerId,
          m.sourceStatus,
          m.targetStatusId,
        );
      }
      // No data merge — the client re-runs validation to clear the unmapped
      // statuses now that the mappings exist.
      return {};
    },
  };
}

function buildGbhetSteps(feed: GbhetLegalWorkersWizard): WizardStepHandler[] {
  const assertEditable = (ctx: WizardStepContext) => {
    if (isHistoricalImport(ctx.wizard) || (ctx.wizard.data as any)?.progress?.process?.status === "in_progress") {
      throw new Error("This upload has already started processing and cannot be edited.");
    }
  };
  const map = buildMapStep(feed, "Map Columns", "Map file columns to legal worker fields", [{
    fieldIds: (feed.getFields?.() ?? []).filter(field => field.type === "benefit" && field.isBenefitEligibility).map(field => field.id),
    message: REQUIRED_BENEFIT_MAPPING_MESSAGE,
  }]);
  const originalMapSubmit = map.submit!;
  const originalMapState = map.getState!;
  map.getState = wizard => isHistoricalImport(wizard) ? "completed" : originalMapState(wizard);
  map.submit = async ctx => {
    assertEditable(ctx);
    const result = await originalMapSubmit(ctx);
    const old = (ctx.wizard.data ?? {}) as Record<string, any>;
    const incoming = result.data ?? {};
    const changed = ["columnMapping", "mode", "hasHeaders"]
      .some(key => JSON.stringify(incoming[key]) !== JSON.stringify(old[key]));
    return { data: changed ? clearLegalDownstream({ ...old, ...incoming }) : incoming };
  };
  const upload = buildUploadStep(feed, "Upload the legal workers file");
  const originalUpload = upload.submit!;
  upload.submit = async ctx => {
    assertEditable(ctx);
    const { dbUser } = await getEffectiveUser((ctx.req as any).session, (ctx.req as any).user);
    if (!dbUser) throw new Error("User not found");
    const contact = dbUser.email ? await ctx.storage.contacts.getContactByEmail(dbUser.email) : null;
    const result = await originalUpload(ctx);
    const fresh = await ctx.storage.wizards.getById(ctx.wizardId);
    return { ...result, data: {
      ...clearLegalDownstream({ ...((fresh?.data ?? {}) as any), ...result.data }),
      legalSubmitter: { userId: dbUser.id, contactId: contact?.id ?? null },
      legalCompletion: null,
    } };
  };
  const benefits = buildBenefitsStep(feed);
  const originalBenefits = benefits.submit!;
  benefits.submit = async ctx => { assertEditable(ctx); return originalBenefits(ctx); };
  const validate = buildGbhetValidateStep(feed);
  validate.beforeRun = async ctx => { assertEditable(ctx); };
  const originalValidateSubmit = validate.submit!;
  validate.submit = async ctx => {
    assertEditable(ctx);
    await originalValidateSubmit(ctx);
    return { data: clearLegalDownstream((ctx.wizard.data ?? {}) as Record<string, any>) };
  };
  const process = buildProcessStep(feed);
  process.failureStatus = "failed";
  process.beforeRun = async ctx => {
    if (isHistoricalImport(ctx.wizard)) throw new Error("This upload is already completed.");
    const forecast = await forecastLegalUpload(feed, ctx.wizard);
    if ((ctx.wizard.data as any)?.legalPreviewApproval !== forecast.fingerprint) {
      throw new Error("Review and approve the current Legal estimate before processing.");
    }
  };
  process.afterRunPersisted = publishLegalCompletion;
  const originalProcessRun = process.run!;
  process.run = async ctx => {
    const result = await originalProcessRun(ctx);
    const saved = await ctx.storage.wizards.getById(ctx.wizardId);
    const totals = (saved?.data as any)?.legalCompletion?.totals;
    return totals?.chargeFailures || totals?.chargeReadFailed
      ? { ...result, status: "completed_with_errors" } : result;
  };
  return [
    upload,
    map,
    benefits,
    validate,
    {
      id: "preview", name: "Preview", kind: "custom", component: "Preview",
      description: "Estimate new workers, benefit grants and additional charges",
      getState: async wizard => {
        if (isHistoricalImport(wizard)) return "completed";
        if ((wizard.data as any)?.progress?.process?.status === "in_progress") return "completed";
        if (!(wizard.data as any)?.legalPreviewApproval) return "pending";
        try {
          const forecast = await forecastLegalUpload(feed, wizard);
          return (wizard.data as any).legalPreviewApproval === forecast.fingerprint ? "completed" : "pending";
        } catch { return "pending"; }
      },
      getData: async ctx => isHistoricalImport(ctx.wizard)
        ? { historical: true, forecast: (ctx.wizard.data as any)?.legalPreview ?? null }
        : { historical: false, forecast: await forecastLegalUpload(feed, ctx.wizard) },
      submit: async ctx => {
        assertEditable(ctx);
        const forecast = await forecastLegalUpload(feed, ctx.wizard);
        if (ctx.input.fingerprint !== forecast.fingerprint) throw new Error("The estimate changed. Refresh and review it before approving.");
        return { data: { legalPreviewApproval: forecast.fingerprint, legalPreview: forecast } };
      },
    },
    process,
    buildFeedResultsStep({ id: "review", name: "Review" }),
  ];
}

/** Shared year/month launch-argument parse + validation. */
function sanitizeLegalCreate(ctx: WizardCreateContext) {
  const data = (ctx.input.data ?? {}) as Record<string, unknown>;
  ctx.input.data = Object.fromEntries(
    ["launchArguments", "columnMapping", "hasHeaders", "mode", "benefitConfig", "inheritedColumnHeaders"]
      .filter(key => data[key] !== undefined).map(key => [key, data[key]]),
  );
  ctx.input.status = "draft";
  ctx.input.currentStep = "upload";
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

/**
 * Seed a new run's feed setup from the employer's most recent prior GBHET
 * legal run (either type). Column mapping / header flag / mode / benefit
 * config are stored per wizard, so without this every new upload started
 * from a blank mapping. Explicitly provided values on the new wizard win;
 * employment-status mappings already persist per employer and need no copy.
 */
async function inheritFeedSetup(
  ctx: WizardCreateContext,
  entityId: string,
): Promise<void> {
  const data: Record<string, any> = ((ctx.input.data as any) ||= {});
  if (data.columnMapping && Object.keys(data.columnMapping).length > 0) return;

  const prior = await ctx.storage.wizards.list({ entityId });
  const source = prior.find((w) => {
    if (
      w.type !== "gbhet_legal_workers_monthly" &&
      w.type !== "gbhet_legal_workers_corrections"
    )
      return false;
    const d = (w.data as any) || {};
    return d.columnMapping && Object.keys(d.columnMapping).length > 0;
  });
  if (!source) return;

  const d = (source.data as any) || {};
  data.columnMapping = d.columnMapping;
  if (data.hasHeaders === undefined && d.hasHeaders !== undefined) {
    data.hasHeaders = d.hasHeaders;
  }
  if (
    d.hasHeaders !== false &&
    Array.isArray(d.previewRows) &&
    Array.isArray(d.previewRows[0])
  ) {
    data.inheritedColumnHeaders = d.previewRows[0];
  }
  if (data.mode === undefined && d.mode !== undefined) {
    data.mode = d.mode;
  }
  if (data.benefitConfig === undefined && Array.isArray(d.benefitConfig)) {
    data.benefitConfig = d.benefitConfig;
  }
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
  const existing = await ctx.storage.wizards.findMonthlyWizardsForPeriod(
    entityId,
    parsed.year,
    parsed.month,
    "gbhet_legal_workers_monthly",
  );
  if (existing.length > 0) {
    return {
      error: `A legal workers monthly wizard already exists for this employer in ${parsed.month}/${parsed.year}`,
      status: 400,
    };
  }
  await inheritFeedSetup(ctx, entityId);
  sanitizeLegalCreate(ctx);
  const wizard = await ctx.storage.wizards.createMonthlyWizard({
    wizard: ctx.input as any,
    employerId: entityId,
    year: parsed.year,
    month: parsed.month,
  });
  return { wizard };
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
  const completedMonthly =
    await ctx.storage.wizards.findCompletedMonthlyWizardForPeriod(
      entityId,
      parsed.year,
      parsed.month,
      "gbhet_legal_workers_monthly",
    );
  if (!completedMonthly) {
    return {
      error: `Cannot create legal workers corrections wizard: no completed legal workers monthly wizard found for ${parsed.month}/${parsed.year}`,
      status: 400,
    };
  }
  await inheritFeedSetup(ctx, entityId);
  sanitizeLegalCreate(ctx);
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

export const gbhetLegalWorkersMonthlyPlugin: WizardPlugin = {
  id: "gbhet_legal_workers_monthly",
  name: "GBHET Legal Workers Monthly",
  description: "Monthly legal workers feed for an employer",
  requiredComponent: "sitespecific.gbhet.legal",
  entityType: "employer",
  category: "Feed",
  isMonthly: true,
  launchSchema: LAUNCH_SCHEMA,
  create: createMonthly,
  allowedRecordUpdates: ["data"],
  prepareUpdate: ctx => prepareLegalUpdate(gbhetLegalWorkersMonthly, ctx),
  getFields: () => gbhetLegalWorkersMonthly.getFields?.() ?? [],
  steps: buildGbhetSteps(gbhetLegalWorkersMonthly),
};

export const gbhetLegalWorkersCorrectionsPlugin: WizardPlugin = {
  id: "gbhet_legal_workers_corrections",
  name: "GBHET Legal Workers Corrections",
  description: "Corrections feed for a completed monthly legal workers wizard",
  requiredComponent: "sitespecific.gbhet.legal",
  entityType: "employer",
  category: "Feed",
  isMonthly: true,
  launchSchema: LAUNCH_SCHEMA,
  create: createCorrections,
  allowedRecordUpdates: ["data"],
  prepareUpdate: ctx => prepareLegalUpdate(gbhetLegalWorkersCorrections, ctx),
  getFields: () => gbhetLegalWorkersCorrections.getFields?.() ?? [],
  steps: buildGbhetSteps(gbhetLegalWorkersCorrections),
};

registerWizardPlugin(gbhetLegalWorkersMonthlyPlugin);
registerWizardPlugin(gbhetLegalWorkersCorrectionsPlugin);
