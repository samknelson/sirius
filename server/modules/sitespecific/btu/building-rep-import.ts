import type { Express, Request, Response, NextFunction } from "express";
import { storage } from "../../../storage";
import { createBtuWorkerImportStorage } from "../../../storage/sitespecific/btu/worker-import";
import { logger } from "../../../logger";
import multer from "multer";

type AuthMiddleware = (req: Request, res: Response, next: NextFunction) => void | Promise<any>;
type PermissionMiddleware = (permissionKey: string) => (req: Request, res: Response, next: NextFunction) => void | Promise<any>;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024,
  },
});

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

function parseCsvContent(content: string): CsvRow[] {
  const lines = content.split(/\r?\n/).filter(line => line.trim().length > 0);
  if (lines.length < 2) return [];

  const rows: CsvRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseCsvLine(lines[i]);
    if (values.length < 2) continue;

    rows.push({
      name: (values[0] || '').trim(),
      badgeId: (values[1] || '').trim(),
      phone: (values[2] || '').trim(),
      email: (values[3] || '').trim(),
      rowIndex: i,
    });
  }

  return rows;
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
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
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

export function registerBtuBuildingRepImportRoutes(
  app: Express,
  requireAuth: AuthMiddleware,
  requirePermission: PermissionMiddleware
) {
  app.post("/api/btu-building-rep-import/upload-preview",
    upload.single('file'),
    requireAuth,
    requirePermission("admin"),
    async (req, res) => {
      try {
        if (!req.file) {
          return res.status(400).json({ message: "No file provided" });
        }

        const wizardId = req.body.wizardId;
        if (!wizardId) {
          return res.status(400).json({ message: "wizardId is required" });
        }

        const content = req.file.buffer.toString('utf-8');
        const csvRows = parseCsvContent(content);

        if (csvRows.length === 0) {
          return res.status(400).json({ message: "CSV file is empty or has no data rows" });
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
            preview.error = 'No Badge/ID number';
            previewRows.push(preview);
            continue;
          }

          const worker = await btuStorage.findWorkerByBpsEmployeeId(row.badgeId);
          if (!worker) {
            preview.error = 'No worker found with this BPS Employee ID';
            previewRows.push(preview);
            continue;
          }

          preview.matched = true;
          preview.workerId = worker.id;

          const contact = await storage.contacts.getContact(worker.contactId);
          preview.workerName = contact?.displayName || row.name;

          const currentEmployment = await storage.workerHours.getWorkerHoursCurrent(worker.id);
          const activeEmployment = currentEmployment.find(
            (e: any) => e.employmentStatus?.employed
          );

          if (!activeEmployment) {
            preview.error = 'No active employment found';
            previewRows.push(preview);
            continue;
          }

          preview.employerId = activeEmployment.employerId;
          preview.employerName = activeEmployment.employer?.name || 'Unknown';

          if (!worker.bargainingUnitId) {
            preview.error = 'Worker has no bargaining unit assigned';
            previewRows.push(preview);
            continue;
          }

          preview.bargainingUnitId = worker.bargainingUnitId;
          const bu = await storage.bargainingUnits.getBargainingUnitById(worker.bargainingUnitId);
          preview.bargainingUnitName = bu?.name || 'Unknown';

          const existing = await storage.workerStewardAssignments.findExistingAssignment(
            worker.id, activeEmployment.employerId, worker.bargainingUnitId
          );
          if (existing) {
            preview.alreadyAssigned = true;
          }

          previewRows.push(preview);
        }

        const matched = previewRows.filter(r => r.matched && !r.error);
        const unmatched = previewRows.filter(r => !r.matched || !!r.error);
        const alreadyAssigned = matched.filter(r => r.alreadyAssigned);
        const toCreate = matched.filter(r => !r.alreadyAssigned);

        const previewData = {
          rows: previewRows,
          totalRows: csvRows.length,
          matchedCount: matched.length,
          unmatchedCount: unmatched.length,
          alreadyAssignedCount: alreadyAssigned.length,
          toCreateCount: toCreate.length,
        };

        await storage.wizards.update(wizardId, {
          data: {
            previewData,
            csvFileName: req.file.originalname,
          },
          currentStep: 'preview',
          status: 'in_progress',
        });

        res.json(previewData);
      } catch (error: any) {
        logger.error("Building rep import preview failed", { error: error.message });
        res.status(500).json({ message: error.message || "Preview failed" });
      }
    }
  );

  app.post("/api/btu-building-rep-import/process",
    requireAuth,
    requirePermission("admin"),
    async (req, res) => {
      try {
        const { wizardId } = req.body;
        if (!wizardId) {
          return res.status(400).json({ message: "wizardId is required" });
        }

        const wizard = await storage.wizards.getById(wizardId);
        if (!wizard) {
          return res.status(404).json({ message: "Wizard not found" });
        }

        const previewData = (wizard.data as any)?.previewData;
        if (!previewData?.rows) {
          return res.status(400).json({ message: "No preview data found. Please upload and preview first." });
        }

        const rows: PreviewRow[] = previewData.rows;
        const toProcess = rows.filter(
          r => r.matched && !r.error && !r.alreadyAssigned &&
               r.workerId && r.employerId && r.bargainingUnitId
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

        for (const row of toProcess) {
          try {
            const existingCheck = await storage.workerStewardAssignments.findExistingAssignment(
              row.workerId!, row.employerId!, row.bargainingUnitId!
            );

            if (existingCheck) {
              results.skipped++;
              results.skippedDuringProcess.push({
                name: row.workerName || row.name,
                badgeId: row.badgeId,
                workerId: row.workerId!,
                employerName: row.employerName || 'Unknown',
                reason: 'Already assigned (duplicate found during processing)',
              });
              results.processed++;
              continue;
            }

            const assignment = await storage.workerStewardAssignments.createAssignment({
              workerId: row.workerId!,
              employerId: row.employerId!,
              bargainingUnitId: row.bargainingUnitId!,
            });

            results.created++;
            results.createdAssignments.push({
              name: row.workerName || row.name,
              badgeId: row.badgeId,
              workerId: row.workerId!,
              employerName: row.employerName || 'Unknown',
              bargainingUnitName: row.bargainingUnitName || 'Unknown',
              assignmentId: assignment.id,
            });
            results.processed++;
          } catch (error: any) {
            results.errors.push({
              name: row.name,
              badgeId: row.badgeId,
              error: error.message || 'Unknown error',
            });
            results.processed++;
          }
        }

        const alreadyAssignedRows = rows.filter(r => r.matched && !r.error && r.alreadyAssigned);
        for (const row of alreadyAssignedRows) {
          results.alreadyAssignedRows.push({
            name: row.workerName || row.name,
            badgeId: row.badgeId,
            workerId: row.workerId!,
            employerName: row.employerName || 'Unknown',
            bargainingUnitName: row.bargainingUnitName || 'Unknown',
          });
        }
        results.alreadyAssigned = alreadyAssignedRows.length;

        const unmatchedRows = rows.filter(r => !r.matched || !!r.error);
        for (const row of unmatchedRows) {
          results.errors.push({
            name: row.name,
            badgeId: row.badgeId,
            error: row.error || 'Not matched',
          });
        }

        const finalStatus = results.errors.length > 0 ? 'completed' : 'completed';

        await storage.wizards.update(wizardId, {
          data: {
            ...(wizard.data as any),
            processResults: results,
          },
          currentStep: 'results',
          status: finalStatus,
        });

        res.json(results);
      } catch (error: any) {
        logger.error("Building rep import processing failed", { error: error.message });
        res.status(500).json({ message: error.message || "Processing failed" });
      }
    }
  );
}
