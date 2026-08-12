import type { Request } from "express";
import { registerWizardPlugin } from "../registry";
import type {
  WizardPlugin,
  WizardStepHandler,
  WizardStepContext,
  WizardCreateContext,
  WizardCreateResult,
} from "../types";
import type { JsonSchema } from "@shared/json-schema-form";
import {
  gbheLocal26Hourly,
  FILE_FORMATS,
  type WeekInfo,
} from "../engine/types/gbhe_local26_hourly";
import { createUnifiedOptionsStorage } from "../../../storage/unified-options";
import { checkAccessInline } from "../../../services/access-policy-evaluator";
import { storage } from "../../../storage/index";
import {
  buildUploadStep,
  buildMapStep,
  prepareFeedDataUpdate,
} from "./feed-steps";

/**
 * GBHE Local 26 Hourly upload wizard: ingests a month of employer-reported
 * data (weekly hours, monthly shift counts, weekly dues withheld, worker
 * contact/demographics), creating or updating workers as needed.
 *
 *   Upload → Parse/Map → Week Dates → Validate → Process → Review
 *
 * File formats are pluggable (Marriott S2 matrix + generic column-mapped;
 * Compass later). Entity-scoping (admin OR employer.mine) is enforced
 * generically by the dispatcher from `entityType: "employer"`.
 */

const optionsStorage = createUnifiedOptionsStorage();

/**
 * Employers the requesting user can access, for per-row Work Location Name
 * resolution. Admins/staff see every employer; employer-side users see only
 * the employers their `employer.mine` policy grants. Computed while the
 * request is alive and passed into the async engine run.
 */
async function accessibleEmployers(
  req: Request,
): Promise<Array<{ id: string; name: string }>> {
  const all = await storage.employers.getAllEmployers();
  const admin = await checkAccessInline(req, "admin");
  if (admin.granted) return all.map((e) => ({ id: e.id, name: e.name }));
  const out: Array<{ id: string; name: string }> = [];
  for (const e of all) {
    const scoped = await checkAccessInline(req, "employer.mine", e.id);
    if (scoped.granted) out.push({ id: e.id, name: e.name });
  }
  return out;
}

function launchFormat(wizard: { data: unknown }): string {
  return ((wizard.data as any)?.launchArguments?.format as string) || "marriott_s2";
}

/**
 * Parse/Map step. For the generic format this is the standard column-mapping
 * step; for matrix formats (Marriott S2) the layout is parsed automatically,
 * so the step just previews the parse result and completes on success.
 */
function buildLocal26MapStep(): WizardStepHandler {
  const genericMap = buildMapStep(
    gbheLocal26Hourly,
    "Map Columns",
    "Map file columns to Local 26 hourly fields",
  );
  return {
    id: "map",
    name: "Parse / Map",
    description: "Parse the file layout or map columns",
    kind: "custom",
    component: "Local26Map",
    getState: (wizard) => {
      const format = FILE_FORMATS[launchFormat(wizard)];
      if (format && !format.usesColumnMapping) {
        const data = (wizard.data as any) || {};
        return data.uploadedFileId ? "completed" : "pending";
      }
      return genericMap.getState!(wizard);
    },
    getData: async (ctx: WizardStepContext) => {
      const format = FILE_FORMATS[launchFormat(ctx.wizard)];
      if (format && !format.usesColumnMapping) {
        const data = (ctx.wizard.data as any) || {};
        if (!data.uploadedFileId) {
          return { format: format.id, parsed: null, parseError: null };
        }
        try {
          const parsed = await gbheLocal26Hourly.loadParsedFile(ctx.wizard);
          return {
            format: format.id,
            parsed: {
              rowCount: parsed.rows.length,
              weeks: parsed.weeks,
              payrollMonthLabel: parsed.payrollMonthLabel,
              fileRates: parsed.fileRates,
              sampleRows: parsed.rows.slice(0, 5).map((r) => ({
                workLocationName: r.workLocationName,
                fullName: r.fullName,
                employeeStatus: r.employeeStatus,
                personNumber: r.personNumber,
                shiftCount: r.shiftCount,
              })),
            },
            parseError: null,
          };
        } catch (err) {
          return {
            format: format.id,
            parsed: null,
            parseError: err instanceof Error ? err.message : String(err),
          };
        }
      }
      return { format: "generic", ...(await genericMap.getData!(ctx)) };
    },
    submit: async (ctx: WizardStepContext) => {
      const format = FILE_FORMATS[launchFormat(ctx.wizard)];
      if (format && !format.usesColumnMapping) return {};
      return genericMap.submit!(ctx);
    },
  };
}

/**
 * Week Dates step: per reporting week, the user either confirms a date
 * sourced from the file (pay-week ending / modal check date) or sets one
 * manually. Resolved dates persist as `wizard.data.weekDates`.
 */
function buildWeekDatesStep(): WizardStepHandler {
  return {
    id: "weekdates",
    name: "Week Dates",
    description: "Confirm or set the date for each reporting week",
    kind: "custom",
    component: "Local26WeekDates",
    getState: (wizard) => {
      const data = (wizard.data as any) || {};
      if (!data.uploadedFileId) return "pending";
      const wd = data.weekDates;
      if (wd && Object.keys(wd).length > 0) return "completed";
      return wizard.currentStep === "weekdates" ? "in_progress" : "pending";
    },
    getData: async (ctx: WizardStepContext) => {
      const data = (ctx.wizard.data as any) || {};
      let weeks: WeekInfo[] = [];
      let parseError: string | null = null;
      if (data.uploadedFileId) {
        try {
          const parsed = await gbheLocal26Hourly.loadParsedFile(ctx.wizard);
          weeks = parsed.weeks;
        } catch (err) {
          parseError = err instanceof Error ? err.message : String(err);
        }
      }
      return {
        weeks,
        parseError,
        weekDates: data.weekDates || {},
        weekDateSource: data.weekDateSource || {},
      };
    },
    submit: (ctx: WizardStepContext) => {
      const input = ctx.input as {
        weekDates?: Record<string, string>;
        weekDateSource?: Record<string, string>;
      };
      const weekDates = input.weekDates || {};
      for (const [week, date] of Object.entries(weekDates)) {
        if (!/^[1-9]\d*$/.test(week)) {
          throw new Error(`Invalid week number: ${week}`);
        }
        if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
          throw new Error(`Week ${week} date must be YYYY-MM-DD`);
        }
      }
      if (Object.keys(weekDates).length === 0) {
        throw new Error("At least one week date is required");
      }
      return {
        data: {
          weekDates,
          weekDateSource: input.weekDateSource || {},
          // Week dates changed → previous validation is stale.
          validationResults: null,
        },
      };
    },
  };
}

/**
 * Validate step: row checks, employment-status mapping, work-location
 * mapping, and warn-only rate comparison. Mappings save through the generic
 * submit route; the client re-validates to clear the unmapped lists.
 */
function buildLocal26ValidateStep(): WizardStepHandler {
  return {
    id: "validate",
    name: "Validate",
    description: "Validate rows and map unrecognized statuses and locations",
    kind: "run",
    component: "Local26Validate",
    getState: (wizard) => {
      const data = (wizard.data as any) || {};
      const vr = data.validationResults;
      if (!vr) return wizard.currentStep === "validate" ? "in_progress" : "pending";
      const clean =
        (vr.invalidRows ?? 0) === 0 &&
        !(vr.unmappedStatuses && vr.unmappedStatuses.length > 0) &&
        !(vr.unmappedLocations && vr.unmappedLocations.length > 0);
      if (clean) return "completed";
      return wizard.currentStep === "validate" ? "in_progress" : "pending";
    },
    run: async (ctx: WizardStepContext) => {
      const employers = await accessibleEmployers(ctx.req);
      await gbheLocal26Hourly.validateLocal26(ctx.wizardId, employers, (pct) => {
        void ctx.reportProgress(pct);
      });
    },
    getData: async (ctx: WizardStepContext) => {
      const data = (ctx.wizard.data as any) || {};
      const employerId = ctx.wizard.entityId;
      const [statusMappings, locationMappings, employers] = await Promise.all([
        employerId
          ? ctx.storage.wizardEmploymentStatusMappings.getByEmployer(employerId)
          : Promise.resolve([]),
        employerId
          ? ctx.storage.wizardWorkLocationMappings.getByEmployer(employerId)
          : Promise.resolve([]),
        accessibleEmployers(ctx.req),
      ]);
      return {
        validationResults: data.validationResults ?? null,
        existingStatusMappings: statusMappings,
        existingLocationMappings: locationMappings,
        accessibleEmployers: employers,
      };
    },
    submit: async (ctx: WizardStepContext) => {
      const employerId = ctx.wizard.entityId;
      if (!employerId) throw new Error("This wizard is not linked to an employer");
      const input = ctx.input as {
        mappings?: Array<{ sourceStatus: string; targetStatusId: string }>;
        locationMappings?: Array<{ sourceLocation: string; targetEmployerId: string }>;
      };
      const statusMappings = input.mappings;
      const locationMappings = input.locationMappings;
      if (
        (!Array.isArray(statusMappings) || statusMappings.length === 0) &&
        (!Array.isArray(locationMappings) || locationMappings.length === 0)
      ) {
        throw new Error("A non-empty mappings or locationMappings array is required");
      }
      if (Array.isArray(statusMappings) && statusMappings.length > 0) {
        const validStatuses = await optionsStorage.list("employment-status");
        const validStatusIds = new Set(validStatuses.map((s: any) => s.id));
        for (const m of statusMappings) {
          if (!m || !m.sourceStatus || !m.targetStatusId) {
            throw new Error("Each mapping must have a sourceStatus and a targetStatusId");
          }
          if (!validStatusIds.has(m.targetStatusId)) {
            throw new Error(`Invalid target status ID: ${m.targetStatusId}`);
          }
        }
        await ctx.storage.wizardEmploymentStatusMappings.upsertBatch(
          employerId,
          statusMappings,
        );
      }
      if (Array.isArray(locationMappings) && locationMappings.length > 0) {
        // Target employers must be ones THIS user can access — the mapping
        // persists per employer and is applied on every future run.
        const employers = await accessibleEmployers(ctx.req);
        const allowed = new Set(employers.map((e) => e.id));
        for (const m of locationMappings) {
          if (!m || !m.sourceLocation || !m.targetEmployerId) {
            throw new Error("Each location mapping must have a sourceLocation and a targetEmployerId");
          }
          if (!allowed.has(m.targetEmployerId)) {
            throw new Error("You do not have access to one of the target employers");
          }
        }
        await ctx.storage.wizardWorkLocationMappings.upsertBatch(
          employerId,
          locationMappings,
        );
      }
      return {};
    },
  };
}

function buildLocal26ProcessStep(): WizardStepHandler {
  return {
    id: "process",
    name: "Process",
    description: "Write hours, shifts, dues and worker data",
    kind: "run",
    component: "RunView",
    getState: (wizard) => {
      const data = (wizard.data as any) || {};
      if (data.processResults) return "completed";
      const progress = data.progress?.process?.status;
      if (progress === "in_progress") return "in_progress";
      return wizard.currentStep === "process" ? "in_progress" : "pending";
    },
    run: async (ctx: WizardStepContext) => {
      const data = (ctx.wizard.data as any) || {};
      const vr = data.validationResults;
      if (!vr) throw new Error("Validate the data before processing");
      if ((vr.invalidRows ?? 0) > 0) {
        throw new Error("Fix validation errors before processing");
      }
      if (
        (vr.unmappedStatuses && vr.unmappedStatuses.length > 0) ||
        (vr.unmappedLocations && vr.unmappedLocations.length > 0)
      ) {
        throw new Error("Map all statuses and work locations before processing");
      }
      const employers = await accessibleEmployers(ctx.req);
      await gbheLocal26Hourly.processLocal26(ctx.wizardId, employers, (pct) => {
        void ctx.reportProgress(pct);
      });
    },
    getData: async (ctx: WizardStepContext) => {
      const data = (ctx.wizard.data as any) || {};
      return { processResults: data.processResults ?? null };
    },
  };
}

function buildLocal26ResultsStep(): WizardStepHandler {
  return {
    id: "review",
    name: "Review",
    description: "Review upload results",
    kind: "custom",
    component: "Local26Results",
    getState: (wizard) => {
      const data = (wizard.data as any) || {};
      return data.processResults ? "completed" : "pending";
    },
    getData: async (ctx: WizardStepContext) => {
      const data = (ctx.wizard.data as any) || {};
      return {
        processResults: data.processResults ?? null,
        validationResults: data.validationResults ?? null,
      };
    },
  };
}

async function createLocal26(
  ctx: WizardCreateContext,
): Promise<WizardCreateResult> {
  const entityId = ctx.input.entityId;
  if (!entityId) {
    return { error: "An employer is required for Local 26 hourly wizards", status: 400 };
  }
  const la = ((ctx.input.data as any)?.launchArguments as any) || {};
  const year = Number(la.year);
  const month = Number(la.month);
  if (!Number.isInteger(year) || year < 1900 || year > 2100) {
    return { error: "Year must be a valid integer between 1900 and 2100", status: 400 };
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    return { error: "Month must be an integer between 1 and 12", status: 400 };
  }
  const format = String(la.format || "");
  if (!FILE_FORMATS[format]) {
    return { error: "A valid file format is required", status: 400 };
  }
  // Deliberately NO duplicate-period block: one statement month may span
  // several per-location files, each its own wizard run (writes are
  // idempotent per worker/week).
  const wizard = await ctx.storage.wizards.createMonthlyWizard({
    wizard: ctx.input as any,
    employerId: entityId,
    year,
    month,
  });
  return { wizard };
}

const LAUNCH_SCHEMA: JsonSchema = {
  type: "object",
  required: ["year", "month", "format"],
  properties: {
    year: { type: "integer", title: "Year", minimum: 1900, maximum: 2100 },
    month: {
      type: "integer",
      title: "Statement Month",
      enum: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
      enumNames: [
        "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December",
      ],
    },
    format: {
      type: "string",
      title: "File Format",
      enum: ["marriott_s2", "generic"],
      enumNames: ["Marriott S2", "Generic (column-mapped)"],
    },
  },
};

export const gbheLocal26HourlyPlugin: WizardPlugin = {
  id: "gbhe_local26_hourly",
  name: "GBHE Local 26 Hourly",
  description:
    "Monthly employer upload of weekly hours, shift counts, dues withheld and worker demographics for Local 26",
  requiredComponent: "sitespecific.gbhet",
  entityType: "employer",
  category: "Feed",
  isMonthly: true,
  launchSchema: LAUNCH_SCHEMA,
  create: createLocal26,
  prepareUpdate: prepareFeedDataUpdate,
  getFields: () => gbheLocal26Hourly.getFields(),
  steps: [
    buildUploadStep(gbheLocal26Hourly, "Upload the monthly report file"),
    buildLocal26MapStep(),
    buildWeekDatesStep(),
    buildLocal26ValidateStep(),
    buildLocal26ProcessStep(),
    buildLocal26ResultsStep(),
  ],
};

registerWizardPlugin(gbheLocal26HourlyPlugin);
