import type { Express, Request, Response, NextFunction } from "express";
import { storage } from "../storage";
import { objectStorageService } from "../services/objectStorage";
import { insertFileSchema } from "@shared/schema";
import { logger } from "../logger";
import { sendInapp } from "../services/inapp-sender";
import { sendEmail } from "../services/email-sender";
import puppeteer, { type Browser, type Page } from "puppeteer-core";
import { PDFDocument } from "pdf-lib";

type AuthMiddleware = (req: Request, res: Response, next: NextFunction) => void | Promise<any>;
type PermissionMiddleware = (permissionKey: string) => (req: Request, res: Response, next: NextFunction) => void | Promise<any>;

const CHROMIUM_PATH = '/nix/store/qa9cnw4v5xkxyip6mb9kxqfq1z4x2dx1-chromium-138.0.7204.100/bin/chromium';
const LOGIN_URL = 'https://sirius-btu.activistcentral.net/user/login';

function getCardcheckPageUrl(nid: string): string {
  return `https://sirius-btu.activistcentral.net/node/${nid}/sirius_log_cardcheck`;
}

async function launchBrowser() {
  return puppeteer.launch({
    headless: true,
    executablePath: CHROMIUM_PATH,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
}

async function loginToSite(page: Page) {
  const username = process.env.BTU_SCRAPER_USERNAME;
  const password = process.env.BTU_SCRAPER_PASSWORD;

  if (!username || !password) {
    throw new Error('BTU_SCRAPER_USERNAME and BTU_SCRAPER_PASSWORD environment variables are required');
  }

  await page.goto(LOGIN_URL, { waitUntil: 'networkidle2', timeout: 60000 });

  const hasLoginForm = await page.evaluate(() => !!document.querySelector('#edit-name'));
  if (!hasLoginForm) {
    const pageTitle = await page.title();
    logger.info('Login page loaded but no form found', { pageTitle, url: page.url() });
    throw new Error(`Login form not found on page. Page title: ${pageTitle}`);
  }

  await page.type('#edit-name', username);
  await page.type('#edit-pass', password);
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 }),
    page.click('#edit-submit'),
  ]);

  const postLoginUrl = page.url();
  const postLoginTitle = await page.title();
  logger.info('Post-login state', { url: postLoginUrl, title: postLoginTitle });

  const hasLoginError = await page.evaluate(() => {
    const errorMsg = document.querySelector('.messages.error, .error-message');
    return errorMsg ? errorMsg.textContent?.trim() : null;
  });

  if (hasLoginError) {
    throw new Error(`Login failed: ${hasLoginError}`);
  }
}

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
        const pending = await storage.cardchecks.getCardchecksWithSourceNidMissingEsig(cardcheckDefinitionId);
        res.json({
          count: pending.length,
          cardchecks: pending.map(cc => ({
            id: cc.id,
            workerId: cc.workerId,
            sourceNid: cc.sourceNid,
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

        const pendingCardchecks = await storage.cardchecks.getCardchecksWithSourceNidMissingEsig(cardcheckDefinitionId);

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
          let browser: Browser | null = null;
          try {
            browser = await launchBrowser();
            const page = await browser.newPage();
            await loginToSite(page);

            const results = {
              processed: 0,
              total: pendingCardchecks.length,
              created: 0,
              skipped: 0,
              errors: [] as Array<{ cardcheckId: string; sourceNid: string; error: string }>,
              processedRows: [] as Array<{
                cardcheckId: string;
                sourceNid: string;
                workerId: string;
                action: string;
                esigId?: string;
              }>,
            };

            for (let i = 0; i < pendingCardchecks.length; i++) {
              const cardcheck = pendingCardchecks[i];
              const nid = cardcheck.sourceNid!;

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

                const cardcheckPageUrl = getCardcheckPageUrl(nid);
                await page.goto(cardcheckPageUrl, { waitUntil: 'networkidle2', timeout: 60000 });
                await delay(500);

                const pageTitle = await page.title();
                if (pageTitle.toLowerCase().includes('access denied')) {
                  throw new Error(`Access denied for NID ${nid}`);
                }
                if (pageTitle.toLowerCase().includes('not found') || pageTitle.toLowerCase().includes('page not found')) {
                  throw new Error(`Page not found for NID ${nid}`);
                }

                const pagePdfBuffer = await page.pdf({ format: 'Letter', printBackground: true });

                const attachedPdfUrls: string[] = await page.evaluate(() => {
                  const links = Array.from(document.querySelectorAll('a[href]'));
                  return links
                    .map(a => (a as HTMLAnchorElement).href)
                    .filter(href => href.toLowerCase().endsWith('.pdf'));
                });

                let combinedPdfBytes: Uint8Array;

                try {
                  const combinedDoc = await PDFDocument.create();

                  const pageDoc = await PDFDocument.load(pagePdfBuffer);
                  const pagePages = await combinedDoc.copyPages(pageDoc, pageDoc.getPageIndices());
                  for (const p of pagePages) {
                    combinedDoc.addPage(p);
                  }

                  for (const pdfUrl of attachedPdfUrls) {
                    try {
                      const pdfResponse = await page.goto(pdfUrl, { waitUntil: 'networkidle2', timeout: 30000 });
                      if (pdfResponse) {
                        const pdfBuffer = await pdfResponse.buffer();
                        const attachedDoc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });
                        const attachedPages = await combinedDoc.copyPages(attachedDoc, attachedDoc.getPageIndices());
                        for (const ap of attachedPages) {
                          combinedDoc.addPage(ap);
                        }
                      }
                    } catch (attachErr) {
                      logger.warn(`Failed to download/parse attached PDF: ${pdfUrl}`, { error: attachErr });
                    }
                  }

                  combinedPdfBytes = await combinedDoc.save();
                } catch (combineErr) {
                  logger.warn('Failed to combine PDFs, using page PDF only', { error: combineErr });
                  combinedPdfBytes = new Uint8Array(pagePdfBuffer);
                }

                const fileName = `cardcheck_scrape_${nid}.pdf`;

                const uploadResult = await objectStorageService.uploadFile({
                  fileName,
                  fileContent: Buffer.from(combinedPdfBytes),
                  mimeType: 'application/pdf',
                  accessLevel: 'private',
                });

                const pdfFileData = insertFileSchema.parse({
                  fileName,
                  storagePath: uploadResult.storagePath,
                  mimeType: 'application/pdf',
                  size: uploadResult.size,
                  uploadedBy: userId,
                  entityType: 'esig',
                  entityId: null,
                  accessLevel: 'private',
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
                  sourceNid: nid,
                  workerId: cardcheck.workerId,
                  action: 'linked',
                  esigId: esig.id,
                });
              } catch (err) {
                const errorMessage = err instanceof Error ? err.message : 'Unknown error';
                logger.error(`Scraper error for NID ${nid}`, { error: err, cardcheckId: cardcheck.id });
                results.errors.push({
                  cardcheckId: cardcheck.id,
                  sourceNid: nid,
                  error: errorMessage,
                });
              }

              results.processed++;
              await delay(500);
            }

            const hasErrors = results.errors.length > 0;
            const latestWizard = await storage.wizards.getById(wizardId);
            const latestWizardData = (latestWizard?.data as any) || {};
            await storage.wizards.update(wizardId, {
              data: {
                ...latestWizardData,
                processResults: results,
                processProgress: null,
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
                await storage.wizards.update(wizardId, {
                  data: {
                    ...errData,
                    processProgress: null,
                    processError: error instanceof Error ? error.message : 'Unknown error',
                    processResults: errData.processResults || {
                      processed: 0,
                      total: 0,
                      created: 0,
                      skipped: 0,
                      errors: [{ cardcheckId: '', sourceNid: '', error: error instanceof Error ? error.message : 'Unknown error' }],
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
            if (browser) {
              await browser.close().catch(() => {});
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
