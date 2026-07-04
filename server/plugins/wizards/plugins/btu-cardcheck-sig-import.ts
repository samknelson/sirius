import AdmZip from "adm-zip";
import { registerWizardPlugin } from "../registry";
import type { WizardPlugin, WizardStepContext } from "../types";
import { objectStorageService } from "../../../services/objectStorage";
import { createBtuWorkerImportStorage } from "../../../storage/sitespecific/btu/worker-import";
import { insertFileSchema } from "@shared/schema";

/**
 * Extract the leading name parts + BPS employee id from a signature PDF
 * filename of the form LASTNAME_FIRSTNAME_BPSID_SchoolName_Number.pdf.
 * The BPS id is only trusted when it is purely numeric.
 */
function extractFileInfo(filename: string): {
  lastName: string;
  firstName: string;
  bpsId: string | null;
} {
  const baseName = filename.replace(/\.pdf$/i, "");
  const parts = baseName.split("_");
  return {
    lastName: parts[0] || "",
    firstName: parts[1] || "",
    bpsId: parts.length >= 3 && /^\d+$/.test(parts[2]) ? parts[2] : null,
  };
}

function resolveUserId(ctx: WizardStepContext): string {
  const userId = (ctx.req.user as any)?.dbUser?.id;
  if (!userId) throw new Error("User not resolved");
  return userId;
}

interface PdfFile {
  filename: string;
  bpsId: string | null;
  lastName: string;
  firstName: string;
}

interface MatchedFile {
  filename: string;
  bpsId: string;
  workerId: string;
  workerName: string;
  hasExistingCardcheck: boolean;
  existingCardcheckHasEsig: boolean;
}

interface PreviewData {
  matched: MatchedFile[];
  unmatched: Array<{ filename: string; bpsId: string | null; reason: string }>;
  totalFiles: number;
  matchedCount: number;
  unmatchedCount: number;
}

/**
 * BTU card check signature import, in a box. Upload (a ZIP of signature
 * PDFs) → Configure (pick the card check definition) → Preview (match
 * PDFs to workers by BPS employee id) → Process (create e-sig records and
 * link/create card checks) → Results. Every step runs through the fixed
 * dispatcher routes — no wizard-specific route. The upload ZIP, the
 * preview matches, and the processing results all live on `wizard.data`.
 */
export const btuCardcheckSigImportPlugin: WizardPlugin = {
  id: "btu_cardcheck_sig_import",
  name: "BTU Card Check Signature Import",
  description:
    "Import signed card check signature images from a ZIP file, matching workers by BPS Employee ID",
  requiredComponent: "sitespecific.btu",
  category: "Import",
  steps: [
    {
      id: "upload",
      name: "Upload",
      description: "Upload a ZIP file containing signature PDFs",
      kind: "upload",
      component: "SigUpload",
      getState: (wizard) => {
        const data = (wizard.data as any) || {};
        if (data.uploadedFileId) return "completed";
        return wizard.currentStep === "upload" ? "in_progress" : "pending";
      },
      submit: async (ctx: WizardStepContext) => {
        const file = ctx.file;
        if (!file) throw new Error("No file provided");
        if (!file.originalname.toLowerCase().endsWith(".zip")) {
          throw new Error("Please upload a ZIP file");
        }
        const userId = resolveUserId(ctx);

        const uploadResult = await objectStorageService.uploadFile({
          fileName: file.originalname,
          fileContent: file.buffer,
          mimeType: "application/zip",
          accessLevel: "private",
        });

        const validatedData = insertFileSchema.parse({
          fileName: file.originalname,
          storagePath: uploadResult.storagePath,
          mimeType: "application/zip",
          size: uploadResult.size,
          uploadedBy: userId,
          entityType: "wizard",
          entityId: ctx.wizardId,
          accessLevel: "private",
          metadata: { wizardType: "btu_cardcheck_sig_import" },
        });
        const fileRecord = await ctx.storage.files.create(validatedData);

        const zip = new AdmZip(file.buffer);
        const pdfFiles: PdfFile[] = [];
        for (const entry of zip.getEntries()) {
          if (entry.isDirectory) continue;
          const name = entry.entryName.split("/").pop() || entry.entryName;
          if (!name.toLowerCase().endsWith(".pdf")) continue;
          if (name.startsWith(".") || name.startsWith("__MACOSX")) continue;
          const info = extractFileInfo(name);
          pdfFiles.push({
            filename: name,
            bpsId: info.bpsId,
            lastName: info.lastName,
            firstName: info.firstName,
          });
        }

        return {
          data: {
            uploadedFileId: fileRecord.id,
            zipStoragePath: uploadResult.storagePath,
            pdfFiles,
            totalFiles: pdfFiles.length,
            filesWithBpsId: pdfFiles.filter((f) => f.bpsId !== null).length,
            // Re-uploading invalidates any prior preview / processing.
            previewData: null,
            processResults: null,
          },
        };
      },
    },
    {
      id: "configure",
      name: "Configure",
      description: "Select the card check definition",
      kind: "custom",
      component: "SigConfigure",
      getState: (wizard) => {
        const data = (wizard.data as any) || {};
        if (data.cardcheckDefinitionId) return "completed";
        return wizard.currentStep === "configure" ? "in_progress" : "pending";
      },
      getData: (ctx: WizardStepContext) => {
        const data = (ctx.wizard.data as any) || {};
        return { cardcheckDefinitionId: data.cardcheckDefinitionId ?? null };
      },
      submit: (ctx: WizardStepContext) => {
        const input = ctx.input as { cardcheckDefinitionId?: string };
        if (!input.cardcheckDefinitionId) {
          throw new Error("Select a card check definition to continue.");
        }
        return {
          data: { cardcheckDefinitionId: input.cardcheckDefinitionId },
        };
      },
    },
    {
      id: "preview",
      name: "Preview",
      description: "Review matched and unmatched files",
      kind: "custom",
      component: "SigPreview",
      getState: (wizard) => {
        const data = (wizard.data as any) || {};
        if (data.previewData) return "completed";
        return wizard.currentStep === "preview" ? "in_progress" : "pending";
      },
      submit: async (ctx: WizardStepContext) => {
        const data = (ctx.wizard.data as any) || {};
        const pdfFiles: PdfFile[] = data.pdfFiles || [];
        const cardcheckDefinitionId = data.cardcheckDefinitionId;
        if (!cardcheckDefinitionId) {
          throw new Error("Card check definition not selected");
        }

        const btuStorage = createBtuWorkerImportStorage();
        const matched: MatchedFile[] = [];
        const unmatched: PreviewData["unmatched"] = [];

        for (const file of pdfFiles) {
          if (!file.bpsId) {
            unmatched.push({
              filename: file.filename,
              bpsId: null,
              reason: "Could not extract BPS ID from filename",
            });
            continue;
          }
          const worker = await btuStorage.findWorkerByBpsEmployeeId(file.bpsId);
          if (!worker) {
            unmatched.push({
              filename: file.filename,
              bpsId: file.bpsId,
              reason: "No worker found with this BPS Employee ID",
            });
            continue;
          }
          const workerContact = await ctx.storage.contacts.getContact(
            worker.contactId,
          );
          const workerName = workerContact
            ? `${workerContact.family || ""}, ${workerContact.given || ""}`
                .trim()
                .replace(/^,\s*|,\s*$/g, "") ||
              workerContact.displayName ||
              `Worker #${worker.siriusId}`
            : `Worker #${worker.siriusId}`;

          const existingCardchecks =
            await ctx.storage.cardchecks.getCardchecksByWorkerId(worker.id);
          const matchingCardcheck = existingCardchecks.find(
            (cc) => cc.cardcheckDefinitionId === cardcheckDefinitionId,
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

        const previewData: PreviewData = {
          matched,
          unmatched,
          totalFiles: pdfFiles.length,
          matchedCount: matched.length,
          unmatchedCount: unmatched.length,
        };
        return { data: { previewData } };
      },
    },
    {
      id: "process",
      name: "Process",
      description: "Import signatures and create records",
      kind: "run",
      component: "RunView",
      getState: (wizard) => {
        const data = (wizard.data as any) || {};
        if (data.processResults) return "completed";
        return wizard.currentStep === "process" ? "in_progress" : "pending";
      },
      run: async (ctx: WizardStepContext) => {
        const data = (ctx.wizard.data as any) || {};
        const zipStoragePath = data.zipStoragePath;
        const cardcheckDefinitionId = data.cardcheckDefinitionId;
        const previewData: PreviewData | undefined = data.previewData;
        if (!zipStoragePath || !cardcheckDefinitionId || !previewData) {
          throw new Error(
            "Missing required data. Complete upload, configure, and preview steps first.",
          );
        }
        const matchedFiles = previewData.matched || [];
        if (matchedFiles.length === 0) {
          throw new Error("No matched files to process");
        }
        const userId = resolveUserId(ctx);

        const zipBuffer = await objectStorageService.downloadFile(zipStoragePath);
        const zip = new AdmZip(zipBuffer);
        const btuStorage = createBtuWorkerImportStorage();

        const results = {
          processed: 0,
          total: matchedFiles.length,
          created: 0,
          linked: 0,
          skipped: 0,
          errors: [] as Array<{
            filename: string;
            bpsId: string;
            error: string;
          }>,
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

        for (const matchedFile of matchedFiles) {
          try {
            let pdfEntry: AdmZip.IZipEntry | undefined;
            for (const entry of zip.getEntries()) {
              const entryName =
                entry.entryName.split("/").pop() || entry.entryName;
              if (entryName === matchedFile.filename) {
                pdfEntry = entry;
                break;
              }
            }
            if (!pdfEntry) {
              results.errors.push({
                filename: matchedFile.filename,
                bpsId: matchedFile.bpsId,
                error: "PDF file not found in ZIP archive",
              });
              results.processed++;
              continue;
            }

            const pdfBuffer = pdfEntry.getData();
            const pdfUploadResult = await objectStorageService.uploadFile({
              fileName: matchedFile.filename,
              fileContent: pdfBuffer,
              mimeType: "application/pdf",
              accessLevel: "private",
            });

            const pdfFileRecord = await ctx.storage.files.create(
              insertFileSchema.parse({
                fileName: matchedFile.filename,
                storagePath: pdfUploadResult.storagePath,
                mimeType: "application/pdf",
                size: pdfUploadResult.size,
                uploadedBy: userId,
                entityType: "esig",
                entityId: null,
                accessLevel: "private",
                metadata: {
                  bpsId: matchedFile.bpsId,
                  wizardId: ctx.wizardId,
                  importType: "btu_cardcheck_sig_import",
                },
              }),
            );

            const esig = await ctx.storage.esigs.createEsig({
              userId,
              status: "signed",
              signedDate: new Date(),
              type: "upload",
              docRender: "",
              docHash: "",
              esig: {
                type: "upload",
                value: pdfFileRecord.id,
                fileName: matchedFile.filename,
                bpsId: matchedFile.bpsId,
              },
              docType: "cardcheck",
              docFileId: pdfFileRecord.id,
            });

            if (pdfFileRecord.id) {
              await ctx.storage.files.update(pdfFileRecord.id, {
                entityId: esig.id,
              });
            }

            const worker = await btuStorage.findWorkerByBpsEmployeeId(
              matchedFile.bpsId,
            );
            if (!worker) {
              results.errors.push({
                filename: matchedFile.filename,
                bpsId: matchedFile.bpsId,
                error: "Worker no longer found during processing",
              });
              results.processed++;
              continue;
            }

            const existingCardchecks =
              await ctx.storage.cardchecks.getCardchecksByWorkerId(worker.id);
            const matchingCardcheck = existingCardchecks.find(
              (cc) => cc.cardcheckDefinitionId === cardcheckDefinitionId,
            );

            let cardcheckId: string;
            let action: string;
            if (matchingCardcheck && !matchingCardcheck.esigId) {
              await ctx.storage.cardchecks.updateCardcheck(
                matchingCardcheck.id,
                {
                  esigId: esig.id,
                  status: "signed",
                  signedDate: new Date(),
                },
              );
              cardcheckId = matchingCardcheck.id;
              action = "linked";
              results.linked++;
            } else if (matchingCardcheck && matchingCardcheck.esigId) {
              action = "skipped_has_esig";
              cardcheckId = matchingCardcheck.id;
              results.skipped++;
            } else {
              const newCardcheck = await ctx.storage.cardchecks.createCardcheck({
                workerId: worker.id,
                cardcheckDefinitionId,
                status: "signed",
                signedDate: new Date(),
                esigId: esig.id,
              });
              cardcheckId = newCardcheck.id;
              action = "created";
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
            results.errors.push({
              filename: matchedFile.filename,
              bpsId: matchedFile.bpsId,
              error: err instanceof Error ? err.message : "Unknown error",
            });
          }

          results.processed++;
          await ctx.reportProgress(
            Math.round((results.processed / results.total) * 100),
          );
        }

        return {
          data: { processResults: results },
          status: results.errors.length > 0 ? "completed_with_errors" : "completed",
        };
      },
    },
    {
      id: "results",
      name: "Results",
      description: "Review import results",
      kind: "custom",
      component: "SigResults",
      getState: (wizard) => {
        const data = (wizard.data as any) || {};
        if (data.processResults) return "completed";
        return wizard.currentStep === "results" ? "in_progress" : "pending";
      },
    },
  ],
};

registerWizardPlugin(btuCardcheckSigImportPlugin);
