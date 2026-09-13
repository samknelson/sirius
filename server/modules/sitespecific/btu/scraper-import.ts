import type { Express, Request, Response, NextFunction } from "express";
import { storage } from "../../../storage";
import { fileSystemService } from "../../../services/files";
import { insertFileSchema } from "@shared/schema";
import { logger } from "../../../logger";
import { sendInapp } from "../../../services/comm/senders/inapp";
import { sendEmail } from "../../../services/comm/senders/email";
import { isMaintenanceModeError } from "../../../services/maintenance-flag";
import {
  closeBtuCardcheckScrape,
  fetchBtuCardcheckPdf,
  startBtuCardcheckScrape,
} from "../../../services/btu-cardcheck-scrape";

type AuthMiddleware = (req: Request, res: Response, next: NextFunction) => void | Promise<any>;
type PermissionMiddleware = (permissionKey: string) => (req: Request, res: Response, next: NextFunction) => void | Promise<any>;

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function registerBtuScraperImportRoutes(
  app: Express,
  requireAuth: AuthMiddleware,
  requirePermission: PermissionMiddleware
) {
  app.get("/api/btu-scraper-import/pending-count",
    requireAuth,
    requirePermission("admin"),
    async (req: Request, res: Response) => {
      try {
        const cardcheckDefinitionId = req.query.cardcheckDefinitionId as string | undefined;
        const pending = await storage.cardchecks.getCardchecksWithExternalIdMissingEsig(cardcheckDefinitionId);
        res.json({
          count: pending.length,
          cardchecks: pending.map(cc => ({
            id: cc.id,
            workerId: cc.workerId,
            externalId: cc.externalId,
            status: cc.status,
            cardcheckDefinitionId: cc.cardcheckDefinitionId,
          })),
        });
      } catch (error) {
        logger.error('Error fetching pending scraper count', { error });
        res.status(500).json({ message: 'Failed to fetch pending card checks' });
      }
    }
  );

  app.post("/api/btu-scraper-import/process",
    requireAuth,
    requirePermission("admin"),
    async (req: Request, res: Response) => {
      const { wizardId } = req.body;
      try {
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
        if ((wizard as any).type !== 'btu_cardcheck_scrape_import') {
          return res.status(400).json({ message: "Invalid wizard type" });
        }

        const wizardData = wizard.data as any;
        const cardcheckDefinitionId = wizardData?.cardcheckDefinitionId;

        if (!cardcheckDefinitionId) {
          return res.status(400).json({ message: "No card check definition selected. Complete the configure step first." });
        }

        if (wizardData?.processProgress?.status === 'processing') {
          return res.status(409).json({ message: "This wizard is already being processed" });
        }

        const pendingCardchecks = await storage.cardchecks.getCardchecksWithExternalIdMissingEsig(cardcheckDefinitionId);

        if (pendingCardchecks.length === 0) {
          const emptyResults = {
            processed: 0,
            total: 0,
            created: 0,
            skipped: 0,
            errors: [],
            processedRows: [],
          };
          await storage.wizards.update(wizardId, {
            data: {
              ...wizardData,
              processResults: emptyResults,
              processProgress: null,
            },
            status: 'completed',
            currentStep: 'results',
          });
          return res.json({
            message: 'No card checks need signature PDFs. All card checks with NIDs already have signatures.',
            processed: 0,
            total: 0,
          });
        }

        await storage.wizards.update(wizardId, {
          status: 'processing' as any,
          data: {
            ...wizardData,
            processProgress: {
              status: 'processing',
              current: 0,
              total: pendingCardchecks.length,
              created: 0,
              errors: 0,
              currentActivity: 'Starting...',
            },
          },
        });

        res.json({
          message: "Processing started in background",
          status: "processing",
          total: pendingCardchecks.length,
        });

        setImmediate(async () => {
          let sessionId: string | null = null;
          try {
            const startedSessionId = await startBtuCardcheckScrape();
            sessionId = startedSessionId;

            const results = {
              processed: 0,
              total: pendingCardchecks.length,
              created: 0,
              skipped: 0,
              errors: [] as Array<{ cardcheckId: string; externalId: string; error: string }>,
              processedRows: [] as Array<{
                cardcheckId: string;
                externalId: string;
                workerId: string;
                action: string;
                esigId?: string;
              }>,
            };

            for (let i = 0; i < pendingCardchecks.length; i++) {
              const cardcheck = pendingCardchecks[i];
              const nid = cardcheck.externalId!;

              if (i % 3 === 0) {
                try {
                  const currentWizard = await storage.wizards.getById(wizardId);
                  if (currentWizard) {
                    await storage.wizards.update(wizardId, {
                      data: {
                        ...(currentWizard.data as any),
                        processProgress: {
                          status: 'processing',
                          current: i + 1,
                          total: pendingCardchecks.length,
                          created: results.created,
                          skipped: results.skipped,
                          errors: results.errors.length,
                          currentActivity: `Fetching PDF for NID ${nid} (${i + 1} of ${pendingCardchecks.length})...`,
                        },
                      },
                    });
                  }
                } catch (progressErr) {
                  logger.warn('Failed to update scraper progress', { error: progressErr });
                }
              }

              try {
                const freshCardcheck = await storage.cardchecks.getCardcheckById(cardcheck.id);
                if (!freshCardcheck || freshCardcheck.esigId) {
                  results.skipped++;
                  results.processed++;
                  continue;
                }

                const combinedPdfBytes = await fetchBtuCardcheckPdf(startedSessionId, nid);

                const fileName = `cardcheck_scrape_${nid}.pdf`;

                const uploadResult = await fileSystemService.upload({
                  fileName,
                  fileContent: Buffer.from(combinedPdfBytes),
                  mimeType: 'application/pdf',
                  fileSystemId: 'private',
                });

                const pdfFileData = insertFileSchema.parse({
                  fileName,
                  storagePath: uploadResult.storagePath,
                  mimeType: 'application/pdf',
                  size: uploadResult.size,
                  uploadedBy: userId,
                  entityType: 'esig',
                  entityId: null,
                  fileSystemId: 'private',
                  metadata: {
                    nid,
                    cardcheckId: cardcheck.id,
                    wizardId,
                    importType: 'btu_cardcheck_scrape_import',
                  },
                });
                const pdfFileRecord = await storage.files.create(pdfFileData);

                const signedDate = cardcheck.signedDate || new Date();

                const esig = await storage.esigs.createEsig({
                  userId,
                  status: 'signed',
                  signedDate,
                  type: 'upload',
                  docRender: '',
                  docHash: '',
                  esig: {
                    type: 'upload',
                    value: pdfFileRecord.id,
                    fileName,
                    nid,
                    source: 'scraper',
                  },
                  docType: 'cardcheck',
                  docFileId: pdfFileRecord.id,
                });

                if (pdfFileRecord.id) {
                  await storage.files.update(pdfFileRecord.id, {
                    entityId: esig.id,
                  });
                }

                await storage.cardchecks.updateCardcheck(cardcheck.id, {
                  esigId: esig.id,
                });

                results.created++;
                results.processedRows.push({
                  cardcheckId: cardcheck.id,
                  externalId: nid,
                  workerId: cardcheck.workerId,
                  action: 'linked',
                  esigId: esig.id,
                });
              } catch (err) {
                // A maintenance refusal stops the run rather than becoming a
                // per-card error: nothing was fetched, and every remaining
                // card would be refused for the same reason.
                if (isMaintenanceModeError(err)) throw err;
                const errorMessage = err instanceof Error ? err.message : 'Unknown error';
                logger.error(`Scraper error for NID ${nid}`, { error: err, cardcheckId: cardcheck.id });
                results.errors.push({
                  cardcheckId: cardcheck.id,
                  externalId: nid,
                  error: errorMessage,
                });
              }

              results.processed++;
              await delay(500);
            }

            const hasErrors = results.errors.length > 0;
            const latestWizard = await storage.wizards.getById(wizardId);
            const latestWizardData = (latestWizard?.data as any) || {};
            const latestProgress = latestWizardData.progress || {};
            await storage.wizards.update(wizardId, {
              data: {
                ...latestWizardData,
                processResults: results,
                processProgress: null,
                progress: {
                  ...latestProgress,
                  process: {
                    status: 'completed',
                    completedAt: new Date().toISOString(),
                  },
                },
              },
              status: hasErrors ? 'completed_with_errors' : 'completed',
              currentStep: 'results',
            });

            logger.info('Scraper import completed', {
              wizardId,
              total: results.total,
              created: results.created,
              skipped: results.skipped,
              errors: results.errors.length,
            });

            try {
              const user = await storage.users.getUser(userId);
              if (user?.email) {
                const contact = await storage.contacts.getContactByEmail(user.email);
                if (contact) {
                  const title = `Card Check Scraper Import ${hasErrors ? 'Completed with Errors' : 'Complete'}`;
                  const body = `Processed ${results.total} card checks: ${results.created} PDFs fetched, ${results.skipped} skipped, ${results.errors.length} errors.`;
                  const linkUrl = `/wizards/${wizardId}`;
                  await sendInapp({
                    contactId: contact.id,
                    userId: user.id,
                    title,
                    body,
                    linkUrl,
                    linkLabel: 'View Results',
                    initiatedBy: 'system',
                  });
                  await sendEmail({
                    contactId: contact.id,
                    toEmail: user.email,
                    toName: `${user.firstName || ''} ${user.lastName || ''}`.trim() || undefined,
                    subject: title,
                    bodyText: body,
                  });
                }
              }
            } catch (notifErr) {
              logger.warn('Failed to send scraper completion notification', { error: notifErr });
            }
          } catch (error) {
            logger.error('Scraper background processing error', { error, wizardId });
            try {
              const errWizard = await storage.wizards.getById(wizardId);
              if (errWizard) {
                const errData = (errWizard.data as any) || {};
                const errProgress = errData.progress || {};
                await storage.wizards.update(wizardId, {
                  data: {
                    ...errData,
                    processProgress: null,
                    processError: error instanceof Error ? error.message : 'Unknown error',
                    progress: {
                      ...errProgress,
                      process: {
                        status: 'error',
                        error: error instanceof Error ? error.message : 'Processing failed',
                        completedAt: new Date().toISOString(),
                      },
                    },
                    processResults: errData.processResults || {
                      processed: 0,
                      total: 0,
                      created: 0,
                      skipped: 0,
                      errors: [{ cardcheckId: '', externalId: '', error: error instanceof Error ? error.message : 'Unknown error' }],
                      processedRows: [],
                    },
                  },
                  status: 'error' as any,
                  currentStep: 'results',
                });
              }
            } catch (clearErr) {
              logger.warn('Failed to update wizard error state', { error: clearErr });
            }
          } finally {
            if (sessionId) {
              await closeBtuCardcheckScrape(sessionId).catch(() => {});
            }
          }
        });
      } catch (error) {
        logger.error('Scraper process endpoint error', { error });
        const message = error instanceof Error ? error.message : 'Failed to start processing';
        res.status(500).json({ message });
      }
    }
  );
}
