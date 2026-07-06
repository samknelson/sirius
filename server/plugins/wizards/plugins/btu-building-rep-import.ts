import { registerWizardPlugin } from "../registry";
import type { WizardPlugin, WizardStepContext } from "../types";
import { createBtuWorkerImportStorage } from "../../../storage/sitespecific/btu/worker-import";

/**
 * BTU building rep import, in a box. Upload → Preview → Process → Results.
 *
 * This wizard has no feed-base column mapping: the CSV shape is fixed
 * (Name, ID/Badge #, Phone, Email) and every row is matched to a worker by
 * BPS employee id. The upload step parses + matches the file and writes a
 * `previewData` summary onto `wizard.data`; the process `run` step creates
 * the steward assignments. All work composes `storage.*` calls only, so the
 * wizard adds ZERO routes — it is driven entirely by the fixed dispatcher
 * upload / run / getData routes.
 */

interface CsvRow {
  name: string;
  badgeId: string;
  phone: string;
  email: string;
  rowIndex: number;
}

interface PreviewRow {
  rowIndex: number;
  name: string;
  badgeId: string;
  phone: string;
  email: string;
  matched: boolean;
  workerId?: string;
  workerName?: string;
  employerId?: string;
  employerName?: string;
  bargainingUnitId?: string;
  bargainingUnitName?: string;
  alreadyAssigned?: boolean;
  error?: string;
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

function parseCsvContent(content: string): CsvRow[] {
  const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) return [];
  const rows: CsvRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseCsvLine(lines[i]);
    if (values.length < 2) continue;
    rows.push({
      name: (values[0] || "").trim(),
      badgeId: (values[1] || "").trim(),
      phone: (values[2] || "").trim(),
      email: (values[3] || "").trim(),
      rowIndex: i,
    });
  }
  return rows;
}

export const btuBuildingRepImportPlugin: WizardPlugin = {
  id: "btu_building_rep_import",
  name: "BTU Building Rep Import",
  description:
    "Import building representatives from a CSV file (Name, ID/Badge #, Phone, Email) and create shop steward assignments",
  requiredComponent: "sitespecific.btu",
  requiredPolicy: "admin",
  category: "Import",
  steps: [
    {
      id: "upload",
      name: "Upload",
      description: "Upload a CSV file with building rep data",
      kind: "upload",
      component: "BuildingRepUpload",
      getState: (wizard) => {
        const data = (wizard.data as any) || {};
        return data.previewData ? "completed" : "pending";
      },
      submit: async (ctx: WizardStepContext) => {
        const file = ctx.file;
        if (!file) throw new Error("No file uploaded");

        const content = file.buffer.toString("utf-8");
        const csvRows = parseCsvContent(content);
        if (csvRows.length === 0) {
          throw new Error("CSV file is empty or has no data rows");
        }

        const btuStorage = createBtuWorkerImportStorage();
        const previewRows: PreviewRow[] = [];

        for (const row of csvRows) {
          const preview: PreviewRow = {
            rowIndex: row.rowIndex,
            name: row.name,
            badgeId: row.badgeId,
            phone: row.phone,
            email: row.email,
            matched: false,
          };

          if (!row.badgeId) {
            preview.error = "No Badge/ID number";
            previewRows.push(preview);
            continue;
          }

          const worker = await btuStorage.findWorkerByBpsEmployeeId(row.badgeId);
          if (!worker) {
            preview.error = "No worker found with this BPS Employee ID";
            previewRows.push(preview);
            continue;
          }

          preview.matched = true;
          preview.workerId = worker.id;

          const contact = await ctx.storage.contacts.getContact(
            worker.contactId,
          );
          preview.workerName = contact?.displayName || row.name;

          const currentEmployment =
            await ctx.storage.workerHours.getWorkerHoursCurrent(worker.id);
          const activeEmployment = currentEmployment.find(
            (e: any) => e.employmentStatus?.employed,
          );

          if (!activeEmployment) {
            preview.error = "No active employment found";
            previewRows.push(preview);
            continue;
          }

          preview.employerId = activeEmployment.employerId;
          preview.employerName = activeEmployment.employer?.name || "Unknown";

          if (!worker.bargainingUnitId) {
            preview.error = "Worker has no bargaining unit assigned";
            previewRows.push(preview);
            continue;
          }

          preview.bargainingUnitId = worker.bargainingUnitId;
          const bu = await ctx.storage.bargainingUnits.getBargainingUnitById(
            worker.bargainingUnitId,
          );
          preview.bargainingUnitName = bu?.name || "Unknown";

          const existing =
            await ctx.storage.workerStewardAssignments.findExistingAssignment(
              worker.id,
              activeEmployment.employerId,
              worker.bargainingUnitId,
            );
          if (existing) {
            preview.alreadyAssigned = true;
          }

          previewRows.push(preview);
        }

        const matched = previewRows.filter((r) => r.matched && !r.error);
        const unmatched = previewRows.filter((r) => !r.matched || !!r.error);
        const alreadyAssigned = matched.filter((r) => r.alreadyAssigned);
        const toCreate = matched.filter((r) => !r.alreadyAssigned);

        const previewData = {
          rows: previewRows,
          totalRows: csvRows.length,
          matchedCount: matched.length,
          unmatchedCount: unmatched.length,
          alreadyAssignedCount: alreadyAssigned.length,
          toCreateCount: toCreate.length,
        };

        return {
          data: {
            previewData,
            csvFileName: file.originalname,
            processResults: null,
          },
          status: "in_progress",
        };
      },
    },
    {
      id: "preview",
      name: "Preview",
      description: "Review matched and unmatched workers",
      kind: "custom",
      component: "BuildingRepPreview",
      getState: (wizard) => {
        const data = (wizard.data as any) || {};
        const preview = data.previewData;
        if (
          preview &&
          ((preview.toCreateCount ?? 0) > 0 ||
            (preview.alreadyAssignedCount ?? 0) > 0)
        ) {
          return "completed";
        }
        return wizard.currentStep === "preview" ? "in_progress" : "pending";
      },
      getData: (ctx: WizardStepContext) => {
        const data = (ctx.wizard.data as any) || {};
        return { previewData: data.previewData ?? null };
      },
    },
    {
      id: "process",
      name: "Process",
      description: "Create steward assignments for matched workers",
      kind: "run",
      component: "RunView",
      getState: (wizard) => {
        const data = (wizard.data as any) || {};
        const status = data.progress?.process?.status;
        if (status === "completed" || data.processResults) return "completed";
        if (status === "failed") return "failed";
        if (status === "in_progress") return "in_progress";
        return "pending";
      },
      run: async (ctx: WizardStepContext) => {
        const previewData = (ctx.wizard.data as any)?.previewData;
        if (!previewData?.rows) {
          throw new Error(
            "No preview data found. Please upload and preview first.",
          );
        }

        const rows: PreviewRow[] = previewData.rows;
        const toProcess = rows.filter(
          (r) =>
            r.matched &&
            !r.error &&
            !r.alreadyAssigned &&
            r.workerId &&
            r.employerId &&
            r.bargainingUnitId,
        );

        const results = {
          total: rows.length,
          processed: 0,
          created: 0,
          skipped: 0,
          alreadyAssigned: previewData.alreadyAssignedCount || 0,
          errors: [] as Array<{ name: string; badgeId: string; error: string }>,
          createdAssignments: [] as Array<{
            name: string;
            badgeId: string;
            workerId: string;
            employerName: string;
            bargainingUnitName: string;
            assignmentId: string;
          }>,
          alreadyAssignedRows: [] as Array<{
            name: string;
            badgeId: string;
            workerId: string;
            employerName: string;
            bargainingUnitName: string;
          }>,
          skippedDuringProcess: [] as Array<{
            name: string;
            badgeId: string;
            workerId: string;
            employerName: string;
            reason: string;
          }>,
        };

        let done = 0;
        for (const row of toProcess) {
          try {
            const existingCheck =
              await ctx.storage.workerStewardAssignments.findExistingAssignment(
                row.workerId!,
                row.employerId!,
                row.bargainingUnitId!,
              );

            if (existingCheck) {
              results.skipped++;
              results.skippedDuringProcess.push({
                name: row.workerName || row.name,
                badgeId: row.badgeId,
                workerId: row.workerId!,
                employerName: row.employerName || "Unknown",
                reason: "Already assigned (duplicate found during processing)",
              });
              results.processed++;
            } else {
              const assignment =
                await ctx.storage.workerStewardAssignments.createAssignment({
                  workerId: row.workerId!,
                  employerId: row.employerId!,
                  bargainingUnitId: row.bargainingUnitId!,
                });

              results.created++;
              results.createdAssignments.push({
                name: row.workerName || row.name,
                badgeId: row.badgeId,
                workerId: row.workerId!,
                employerName: row.employerName || "Unknown",
                bargainingUnitName: row.bargainingUnitName || "Unknown",
                assignmentId: assignment.id,
              });
              results.processed++;
            }
          } catch (error: any) {
            results.errors.push({
              name: row.name,
              badgeId: row.badgeId,
              error: error?.message || "Unknown error",
            });
            results.processed++;
          }
          done++;
          const pct =
            toProcess.length > 0
              ? Math.min(99, Math.round((done / toProcess.length) * 100))
              : 99;
          void ctx.reportProgress(pct);
        }

        const alreadyAssignedRows = rows.filter(
          (r) => r.matched && !r.error && r.alreadyAssigned,
        );
        for (const row of alreadyAssignedRows) {
          results.alreadyAssignedRows.push({
            name: row.workerName || row.name,
            badgeId: row.badgeId,
            workerId: row.workerId!,
            employerName: row.employerName || "Unknown",
            bargainingUnitName: row.bargainingUnitName || "Unknown",
          });
        }
        results.alreadyAssigned = alreadyAssignedRows.length;

        const unmatchedRows = rows.filter((r) => !r.matched || !!r.error);
        for (const row of unmatchedRows) {
          results.errors.push({
            name: row.name,
            badgeId: row.badgeId,
            error: row.error || "Not matched",
          });
        }

        return {
          data: { processResults: results },
          status: "completed",
        };
      },
      getData: (ctx: WizardStepContext) => {
        const data = (ctx.wizard.data as any) || {};
        return {
          processResults: data.processResults ?? null,
          previewData: data.previewData ?? null,
        };
      },
    },
    {
      id: "results",
      name: "Results",
      description: "Review import results",
      kind: "custom",
      component: "BuildingRepResults",
      getState: (wizard) => {
        const data = (wizard.data as any) || {};
        return data.processResults ? "completed" : "pending";
      },
      getData: (ctx: WizardStepContext) => {
        const data = (ctx.wizard.data as any) || {};
        return { processResults: data.processResults ?? null };
      },
    },
  ],
};

registerWizardPlugin(btuBuildingRepImportPlugin);
