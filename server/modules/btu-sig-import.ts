import type { Express, Request, Response, NextFunction } from "express";
import { storage } from "../storage";
import { objectStorageService } from "../services/objectStorage";
import { createBtuWorkerImportStorage } from "../storage/btu-worker-import";
import { insertFileSchema } from "@shared/schema";
import multer from "multer";
import AdmZip from "adm-zip";
import { logger } from "../logger";

type AuthMiddleware = (req: Request, res: Response, next: NextFunction) => void | Promise<any>;
type PermissionMiddleware = (permissionKey: string) => (req: Request, res: Response, next: NextFunction) => void | Promise<any>;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 100 * 1024 * 1024,
  },
});

function extractBpsIdFromFilename(filename: string): string | null {
  const baseName = filename.replace(/\.pdf$/i, '');
  const parts = baseName.split('_');
  if (parts.length < 3) return null;
  const bpsId = parts[2];
  if (/^\d+$/.test(bpsId)) {
    return bpsId;
  }
  return null;
}

function extractFileInfo(filename: string): { lastName: string; firstName: string; bpsId: string | null } {
  const baseName = filename.replace(/\.pdf$/i, '');
  const parts = baseName.split('_');
  return {
    lastName: parts[0] || '',
    firstName: parts[1] || '',
    bpsId: parts.length >= 3 && /^\d+$/.test(parts[2]) ? parts[2] : null,
  };
}

export function registerBtuSigImportRoutes(
  app: Express,
  requireAuth: AuthMiddleware,
  requirePermission: PermissionMiddleware
) {
  app.post("/api/btu-sig-import/upload-zip",
    upload.single('file'),
    requireAuth,
    requirePermission("admin"),
    async (req, res) => {
      try {
        if (!req.file) {
          return res.status(400).json({ message: "No file provided" });
        }

        if (!req.user) {
          return res.status(401).json({ message: "Authentication required" });
        }

        const userId = (req.user as any).dbUser?.id;
        if (!userId) {
          return res.status(401).json({ message: "User not resolved" });
        }
        const wizardId = req.body.wizardId;

        if (!wizardId) {
          return res.status(400).json({ message: "wizardId is required" });
        }

        const wizard = await storage.wizards.getById(wizardId);
        if (!wizard) {
          return res.status(404).json({ message: "Wizard not found" });
        }
        if ((wizard as any).type !== 'btu_cardcheck_sig_import') {
          return res.status(400).json({ message: "Invalid wizard type" });
        }

        const uploadResult = await objectStorageService.uploadFile({
          fileName: req.file.originalname,
          fileContent: req.file.buffer,
          mimeType: 'application/zip',
          accessLevel: 'private',
        });

        const fileData = {
          fileName: req.file.originalname,
          storagePath: uploadResult.storagePath,
          mimeType: 'application/zip',
          size: uploadResult.size,
          uploadedBy: userId,
          entityType: 'wizard',
          entityId: wizardId,
          accessLevel: 'private',
          metadata: { wizardType: 'btu_cardcheck_sig_import' },
        };

        const validatedData = insertFileSchema.parse(fileData);
        const fileRecord = await storage.files.create(validatedData);

        const zip = new AdmZip(req.file.buffer);
        const entries = zip.getEntries();

        const pdfFiles: Array<{
          filename: string;
          bpsId: string | null;
          lastName: string;
          firstName: string;
        }> = [];

        for (const entry of entries) {
          if (entry.isDirectory) continue;
          const name = entry.entryName.split('/').pop() || entry.entryName;
          if (!name.toLowerCase().endsWith('.pdf')) continue;
          if (name.startsWith('.') || name.startsWith('__MACOSX')) continue;

          const info = extractFileInfo(name);
          pdfFiles.push({
            filename: name,
            bpsId: info.bpsId,
            lastName: info.lastName,
            firstName: info.firstName,
          });
        }

        await storage.wizards.update(wizardId, {
          data: {
            uploadedFileId: fileRecord.id,
            zipStoragePath: uploadResult.storagePath,
            pdfFiles,
            totalFiles: pdfFiles.length,
            filesWithBpsId: pdfFiles.filter(f => f.bpsId !== null).length,
          },
        });

        res.status(200).json({
          fileId: fileRecord.id,
          pdfFiles,
          totalFiles: pdfFiles.length,
          filesWithBpsId: pdfFiles.filter(f => f.bpsId !== null).length,
        });
      } catch (error) {
        logger.error('ZIP upload error', { error });
        res.status(500).json({ message: "Failed to upload ZIP file" });
      }
    }
  );

  app.post("/api/btu-sig-import/preview",
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
        if ((wizard as any).type !== 'btu_cardcheck_sig_import') {
          return res.status(400).json({ message: "Invalid wizard type" });
        }

        const wizardData = wizard.data as any;
        const pdfFiles = wizardData?.pdfFiles || [];
        const cardcheckDefinitionId = wizardData?.cardcheckDefinitionId;

        if (!cardcheckDefinitionId) {
          return res.status(400).json({ message: "Card check definition not selected" });
        }

        const btuStorage = createBtuWorkerImportStorage();

        const matched: Array<{
          filename: string;
          bpsId: string;
          workerId: string;
          workerName: string;
          hasExistingCardcheck: boolean;
          existingCardcheckHasEsig: boolean;
        }> = [];

        const unmatched: Array<{
          filename: string;
          bpsId: string | null;
          reason: string;
        }> = [];

        for (const file of pdfFiles) {
          if (!file.bpsId) {
            unmatched.push({
              filename: file.filename,
              bpsId: null,
              reason: 'Could not extract BPS ID from filename',
            });
            continue;
          }

          const worker = await btuStorage.findWorkerByBpsEmployeeId(file.bpsId);
          if (!worker) {
            unmatched.push({
              filename: file.filename,
              bpsId: file.bpsId,
              reason: 'No worker found with this BPS Employee ID',
            });
            continue;
          }

          const workerContact = await storage.contacts.getContact(worker.contactId);
          const workerName = workerContact
            ? `${workerContact.family || ''}, ${workerContact.given || ''}`.trim().replace(/^,\s*|,\s*$/g, '') || workerContact.displayName || `Worker #${worker.siriusId}`
            : `Worker #${worker.siriusId}`;

          const existingCardchecks = await storage.cardchecks.getCardchecksByWorkerId(worker.id);
          const matchingCardcheck = existingCardchecks.find(
            cc => cc.cardcheckDefinitionId === cardcheckDefinitionId
          );

          matched.push({
            filename: file.filename,
            bpsId: file.bpsId,
            workerId: worker.id,
            workerName,
            hasExistingCardcheck: !!matchingCardcheck,
            existingCardcheckHasEsig: !!matchingCardcheck?.esigId,
          });
        }

        const previewData = {
          matched,
          unmatched,
          totalFiles: pdfFiles.length,
          matchedCount: matched.length,
          unmatchedCount: unmatched.length,
        };

        await storage.wizards.update(wizardId, {
          data: {
            ...wizardData,
            previewData,
          },
        });

        res.json(previewData);
      } catch (error) {
        logger.error('Preview error', { error });
        res.status(500).json({ message: "Failed to generate preview" });
      }
    }
  );

  app.post("/api/btu-sig-import/process",
    requireAuth,
    requirePermission("admin"),
    async (req, res) => {
      try {
        const { wizardId } = req.body;
        if (!wizardId) {
          return res.status(400).json({ message: "wizardId is required" });
        }

        if (!req.user) {
          return res.status(401).json({ message: "Authentication required" });
        }

        const userId = (req.user as any).dbUser?.id;
        if (!userId) {
          return res.status(401).json({ message: "User not resolved" });
        }

        const wizard = await storage.wizards.getById(wizardId);
        if (!wizard) {
          return res.status(404).json({ message: "Wizard not found" });
        }
        if ((wizard as any).type !== 'btu_cardcheck_sig_import') {
          return res.status(400).json({ message: "Invalid wizard type" });
        }

        const wizardData = wizard.data as any;
        const zipStoragePath = wizardData?.zipStoragePath;
        const cardcheckDefinitionId = wizardData?.cardcheckDefinitionId;
        const previewData = wizardData?.previewData;

        if (!zipStoragePath || !cardcheckDefinitionId || !previewData) {
          return res.status(400).json({ message: "Missing required data. Complete upload, configure, and preview steps first." });
        }

        const matchedFiles = previewData.matched || [];
        if (matchedFiles.length === 0) {
          return res.status(400).json({ message: "No matched files to process" });
        }

        const zipBuffer = await objectStorageService.downloadFile(zipStoragePath);
        const zip = new AdmZip(zipBuffer);

        const results = {
          processed: 0,
          total: matchedFiles.length,
          created: 0,
          linked: 0,
          skipped: 0,
          errors: [] as Array<{ filename: string; bpsId: string; error: string }>,
          processedFiles: [] as Array<{
            filename: string;
            bpsId: string;
            workerId: string;
            workerName: string;
            action: string;
            esigId?: string;
            cardcheckId?: string;
          }>,
        };

        const btuStorage = createBtuWorkerImportStorage();

        for (const matchedFile of matchedFiles) {
          try {
            let pdfEntry: AdmZip.IZipEntry | undefined;
            for (const entry of zip.getEntries()) {
              const entryName = entry.entryName.split('/').pop() || entry.entryName;
              if (entryName === matchedFile.filename) {
                pdfEntry = entry;
                break;
              }
            }

            if (!pdfEntry) {
              results.errors.push({
                filename: matchedFile.filename,
                bpsId: matchedFile.bpsId,
                error: 'PDF file not found in ZIP archive',
              });
              results.processed++;
              continue;
            }

            const pdfBuffer = pdfEntry.getData();

            const pdfUploadResult = await objectStorageService.uploadFile({
              fileName: matchedFile.filename,
              fileContent: pdfBuffer,
              mimeType: 'application/pdf',
              accessLevel: 'private',
            });

            const pdfFileData = insertFileSchema.parse({
              fileName: matchedFile.filename,
              storagePath: pdfUploadResult.storagePath,
              mimeType: 'application/pdf',
              size: pdfUploadResult.size,
              uploadedBy: userId,
              entityType: 'esig',
              entityId: null,
              accessLevel: 'private',
              metadata: {
                bpsId: matchedFile.bpsId,
                wizardId,
                importType: 'btu_cardcheck_sig_import',
              },
            });
            const pdfFileRecord = await storage.files.create(pdfFileData);

            const esig = await storage.esigs.createEsig({
              userId,
              status: 'signed',
              signedDate: new Date(),
              type: 'upload',
              docRender: '',
              docHash: '',
              esig: { type: 'upload', value: pdfFileRecord.id, fileName: matchedFile.filename, bpsId: matchedFile.bpsId },
              docType: 'cardcheck',
              docFileId: pdfFileRecord.id,
            });

            if (pdfFileRecord.id) {
              await storage.files.update(pdfFileRecord.id, {
                entityId: esig.id,
              });
            }

            const worker = await btuStorage.findWorkerByBpsEmployeeId(matchedFile.bpsId);
            if (!worker) {
              results.errors.push({
                filename: matchedFile.filename,
                bpsId: matchedFile.bpsId,
                error: 'Worker no longer found during processing',
              });
              results.processed++;
              continue;
            }

            const existingCardchecks = await storage.cardchecks.getCardchecksByWorkerId(worker.id);
            const matchingCardcheck = existingCardchecks.find(
              cc => cc.cardcheckDefinitionId === cardcheckDefinitionId
            );

            let cardcheckId: string;
            let action: string;

            if (matchingCardcheck && !matchingCardcheck.esigId) {
              await storage.cardchecks.updateCardcheck(matchingCardcheck.id, {
                esigId: esig.id,
                status: 'signed',
                signedDate: new Date(),
              });
              cardcheckId = matchingCardcheck.id;
              action = 'linked';
              results.linked++;
            } else if (matchingCardcheck && matchingCardcheck.esigId) {
              action = 'skipped_has_esig';
              cardcheckId = matchingCardcheck.id;
              results.skipped++;
            } else {
              const newCardcheck = await storage.cardchecks.createCardcheck({
                workerId: worker.id,
                cardcheckDefinitionId,
                status: 'signed',
                signedDate: new Date(),
                esigId: esig.id,
              });
              cardcheckId = newCardcheck.id;
              action = 'created';
              results.created++;
            }

            results.processedFiles.push({
              filename: matchedFile.filename,
              bpsId: matchedFile.bpsId,
              workerId: matchedFile.workerId,
              workerName: matchedFile.workerName,
              action,
              esigId: esig.id,
              cardcheckId,
            });
          } catch (err) {
            const errorMessage = err instanceof Error ? err.message : 'Unknown error';
            results.errors.push({
              filename: matchedFile.filename,
              bpsId: matchedFile.bpsId,
              error: errorMessage,
            });
          }

          results.processed++;
        }

        const hasErrors = results.errors.length > 0;
        await storage.wizards.update(wizardId, {
          data: {
            ...wizardData,
            processResults: results,
          },
          status: hasErrors ? 'completed_with_errors' : 'completed',
        });

        res.json(results);
      } catch (error) {
        logger.error('Process error', { error });
        res.status(500).json({ message: "Failed to process import" });
      }
    }
  );
}
