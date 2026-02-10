import type { Express, Request, Response, NextFunction } from "express";
import { storage } from "../storage";
import { objectStorageService } from "../services/objectStorage";
import { createBtuWorkerImportStorage } from "../storage/btu-worker-import";
import { insertFileSchema } from "@shared/schema";
import { logger } from "../logger";
import puppeteer from "puppeteer-core";
import { PDFDocument } from "pdf-lib";

type AuthMiddleware = (req: Request, res: Response, next: NextFunction) => void | Promise<any>;
type PermissionMiddleware = (permissionKey: string) => (req: Request, res: Response, next: NextFunction) => void | Promise<any>;

const CHROMIUM_PATH = '/nix/store/qa9cnw4v5xkxyip6mb9kxqfq1z4x2dx1-chromium-138.0.7204.100/bin/chromium';
const LOGIN_URL = 'https://sirius-btu.activistcentral.net/user/login';
const REPORT_URL = 'https://sirius-btu.activistcentral.net/admin/cardcheck/reports/signed?field_date_value_1[value][date]=&field_date_value[value][date]=-500+days';

interface ScrapedRow {
  handler: string;
  nid: string;
  title: string;
  bpsId: string;
  bargainingUnit: string;
  postDate: string;
  name: string;
}

async function launchBrowser() {
  return puppeteer.launch({
    headless: true,
    executablePath: CHROMIUM_PATH,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
}

async function loginToSite(page: puppeteer.Page) {
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

async function scrapeReportPage(page: puppeteer.Page): Promise<ScrapedRow[]> {
  const debugInfo = await page.evaluate(() => {
    const tables = document.querySelectorAll('table');
    const tableInfo = Array.from(tables).map((t, i) => ({
      index: i,
      id: t.id,
      className: t.className,
      rowCount: t.querySelectorAll('tr').length,
    }));
    return {
      tableCount: tables.length,
      tables: tableInfo,
      url: window.location.href,
      title: document.title,
    };
  });
  logger.info('Page debug info', { debugInfo });

  return page.evaluate(() => {
    const rows: Array<{
      handler: string;
      nid: string;
      title: string;
      bpsId: string;
      bargainingUnit: string;
      postDate: string;
      name: string;
    }> = [];

    const tables = document.querySelectorAll('table');
    let table: Element | null = null;

    for (const t of Array.from(tables)) {
      const trs = t.querySelectorAll('tbody tr, tr');
      if (trs.length > 1) {
        table = t;
        break;
      }
    }

    if (!table) return rows;

    const trs = table.querySelectorAll('tbody tr');
    const fallbackTrs = trs.length > 0 ? trs : table.querySelectorAll('tr');

    fallbackTrs.forEach((tr, index) => {
      const tds = tr.querySelectorAll('td');
      if (tds.length >= 7) {
        rows.push({
          handler: (tds[0].textContent || '').trim(),
          nid: (tds[1].textContent || '').trim(),
          title: (tds[2].textContent || '').trim(),
          bpsId: (tds[3].textContent || '').trim(),
          bargainingUnit: (tds[4].textContent || '').trim(),
          postDate: (tds[5].textContent || '').trim(),
          name: (tds[6].textContent || '').trim(),
        });
      }
    });

    return rows;
  });
}

async function getNextPageUrl(page: puppeteer.Page): Promise<string | null> {
  return page.evaluate(() => {
    const nextLink = document.querySelector('li.pager-next a, .pager-next a, a[title="Go to next page"]');
    if (nextLink) {
      return (nextLink as HTMLAnchorElement).href;
    }
    return null;
  });
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function registerBtuScraperImportRoutes(
  app: Express,
  requireAuth: AuthMiddleware,
  requirePermission: PermissionMiddleware
) {
  app.post("/api/btu-scraper-import/scrape",
    requireAuth,
    requirePermission("admin"),
    async (req: Request, res: Response) => {
      let browser: puppeteer.Browser | null = null;
      try {
        const { wizardId, singleBpsId } = req.body;
        if (!wizardId) {
          return res.status(400).json({ message: "wizardId is required" });
        }

        const wizard = await storage.wizards.getById(wizardId);
        if (!wizard) {
          return res.status(404).json({ message: "Wizard not found" });
        }
        if ((wizard as any).type !== 'btu_cardcheck_scrape_import') {
          return res.status(400).json({ message: "Invalid wizard type" });
        }

        browser = await launchBrowser();
        const page = await browser.newPage();

        await loginToSite(page);

        await page.goto(REPORT_URL, { waitUntil: 'networkidle2', timeout: 60000 });

        const reportPageTitle = await page.title();
        if (reportPageTitle.toLowerCase().includes('access denied')) {
          throw new Error('Access Denied: The scraper account does not have permission to view the card check report. Please verify the BTU_SCRAPER_USERNAME credentials have the correct Drupal role/permissions.');
        }
        if (reportPageTitle.toLowerCase().includes('log in') || reportPageTitle.toLowerCase().includes('user login')) {
          throw new Error('Session expired: The scraper was redirected to the login page when accessing the report. The login may not have completed successfully.');
        }

        logger.info('Report page loaded', { title: reportPageTitle, url: page.url() });

        const allRows: ScrapedRow[] = [];
        let pageNum = 0;
        const searchBpsId = singleBpsId ? singleBpsId.trim() : null;

        while (true) {
          const pageRows = await scrapeReportPage(page);
          allRows.push(...pageRows);
          logger.info(`Scraped page ${pageNum}, found ${pageRows.length} rows (total: ${allRows.length})`);

          if (searchBpsId) {
            const found = allRows.some(r => r.bpsId.trim() === searchBpsId);
            if (found) {
              logger.info(`Found target BPS ID ${searchBpsId}, stopping pagination`);
              break;
            }
          }

          const nextUrl = await getNextPageUrl(page);
          if (!nextUrl) break;

          await page.goto(nextUrl, { waitUntil: 'networkidle2', timeout: 60000 });
          pageNum++;
        }

        const seen = new Set<string>();
        const deduplicated: ScrapedRow[] = [];
        for (const row of allRows) {
          if (!seen.has(row.nid)) {
            seen.add(row.nid);
            deduplicated.push(row);
          }
        }

        let withBpsId = deduplicated.filter(r => r.bpsId && r.bpsId.trim() !== '');

        if (searchBpsId) {
          withBpsId = withBpsId.filter(r => r.bpsId.trim() === searchBpsId);
        }

        const wizardData = wizard.data as any;
        await storage.wizards.update(wizardId, {
          data: {
            ...wizardData,
            scrapedData: withBpsId,
            scrapeStats: {
              totalScraped: allRows.length,
              afterDedup: deduplicated.length,
              withBpsId: withBpsId.length,
              pagesScraped: pageNum + 1,
            },
          },
        });

        res.json({
          rows: withBpsId,
          totalScraped: allRows.length,
          afterDedup: deduplicated.length,
          withBpsId: withBpsId.length,
          pagesScraped: pageNum + 1,
        });
      } catch (error) {
        logger.error('Scrape error', { error });
        const message = error instanceof Error ? error.message : 'Failed to scrape external site';
        res.status(500).json({ message });
      } finally {
        if (browser) {
          await browser.close().catch(() => {});
        }
      }
    }
  );

  app.post("/api/btu-scraper-import/preview",
    requireAuth,
    requirePermission("admin"),
    async (req: Request, res: Response) => {
      try {
        const { wizardId } = req.body;
        if (!wizardId) {
          return res.status(400).json({ message: "wizardId is required" });
        }

        const wizard = await storage.wizards.getById(wizardId);
        if (!wizard) {
          return res.status(404).json({ message: "Wizard not found" });
        }
        if ((wizard as any).type !== 'btu_cardcheck_scrape_import') {
          return res.status(400).json({ message: "Invalid wizard type" });
        }

        const wizardData = wizard.data as any;
        const scrapedData: ScrapedRow[] = wizardData?.scrapedData || [];
        const cardcheckDefinitionId = wizardData?.cardcheckDefinitionId;

        if (!cardcheckDefinitionId) {
          return res.status(400).json({ message: "Card check definition not selected" });
        }

        if (scrapedData.length === 0) {
          return res.status(400).json({ message: "No scraped data. Run the scrape step first." });
        }

        const btuStorage = createBtuWorkerImportStorage();

        const matched: Array<{
          nid: string;
          bpsId: string;
          workerId: string;
          workerName: string;
          postDate: string;
          name: string;
          hasExistingCardcheck: boolean;
          existingHasUploadEsig: boolean;
        }> = [];

        const unmatched: Array<{
          nid: string;
          bpsId: string;
          name: string;
          reason: string;
        }> = [];

        const skipped: Array<{
          nid: string;
          bpsId: string;
          workerId: string;
          workerName: string;
          reason: string;
        }> = [];

        for (const row of scrapedData) {
          const worker = await btuStorage.findWorkerByBpsEmployeeId(row.bpsId);
          if (!worker) {
            unmatched.push({
              nid: row.nid,
              bpsId: row.bpsId,
              name: row.name,
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

          let existingHasUploadEsig = false;
          if (matchingCardcheck?.esigId) {
            const esig = await storage.esigs.getEsigById(matchingCardcheck.esigId);
            if (esig && esig.type === 'upload') {
              existingHasUploadEsig = true;
            }
          }

          if (existingHasUploadEsig) {
            skipped.push({
              nid: row.nid,
              bpsId: row.bpsId,
              workerId: worker.id,
              workerName,
              reason: 'Already has a card check with an uploaded e-signature',
            });
            continue;
          }

          matched.push({
            nid: row.nid,
            bpsId: row.bpsId,
            workerId: worker.id,
            workerName,
            postDate: row.postDate,
            name: row.name,
            hasExistingCardcheck: !!matchingCardcheck,
            existingHasUploadEsig: false,
          });
        }

        const previewData = {
          matched,
          unmatched,
          skipped,
          totalRows: scrapedData.length,
          matchedCount: matched.length,
          unmatchedCount: unmatched.length,
          skippedCount: skipped.length,
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

  app.post("/api/btu-scraper-import/process",
    requireAuth,
    requirePermission("admin"),
    async (req: Request, res: Response) => {
      let browser: puppeteer.Browser | null = null;
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
        if ((wizard as any).type !== 'btu_cardcheck_scrape_import') {
          return res.status(400).json({ message: "Invalid wizard type" });
        }

        const wizardData = wizard.data as any;
        const cardcheckDefinitionId = wizardData?.cardcheckDefinitionId;
        const previewData = wizardData?.previewData;

        if (!cardcheckDefinitionId || !previewData) {
          return res.status(400).json({ message: "Missing required data. Complete configure, scrape, and preview steps first." });
        }

        const matchedRows = previewData.matched || [];
        if (matchedRows.length === 0) {
          return res.status(400).json({ message: "No matched rows to process" });
        }

        browser = await launchBrowser();
        const page = await browser.newPage();

        await loginToSite(page);

        const btuStorage = createBtuWorkerImportStorage();

        const results = {
          processed: 0,
          total: matchedRows.length,
          created: 0,
          linked: 0,
          skipped: 0,
          errors: [] as Array<{ nid: string; bpsId: string; error: string }>,
          processedRows: [] as Array<{
            nid: string;
            bpsId: string;
            workerId: string;
            workerName: string;
            action: string;
            esigId?: string;
            cardcheckId?: string;
          }>,
        };

        for (const matchedRow of matchedRows) {
          try {
            const cardcheckPageUrl = `https://sirius-btu.activistcentral.net/node/${matchedRow.nid}/sirius_log_cardcheck`;

            await page.goto(cardcheckPageUrl, { waitUntil: 'networkidle2', timeout: 60000 });
            await delay(500);

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

            const fileName = `cardcheck_scrape_${matchedRow.bpsId}_${matchedRow.nid}.pdf`;

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
                bpsId: matchedRow.bpsId,
                nid: matchedRow.nid,
                wizardId,
                importType: 'btu_cardcheck_scrape_import',
              },
            });
            const pdfFileRecord = await storage.files.create(pdfFileData);

            let signedDate: Date = new Date();
            if (matchedRow.postDate) {
              const parsed = new Date(matchedRow.postDate);
              if (!isNaN(parsed.getTime())) {
                signedDate = parsed;
              }
            }

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
                bpsId: matchedRow.bpsId,
                nid: matchedRow.nid,
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

            const worker = await btuStorage.findWorkerByBpsEmployeeId(matchedRow.bpsId);
            if (!worker) {
              results.errors.push({
                nid: matchedRow.nid,
                bpsId: matchedRow.bpsId,
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
                signedDate,
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
                signedDate,
                esigId: esig.id,
              });
              cardcheckId = newCardcheck.id;
              action = 'created';
              results.created++;
            }

            results.processedRows.push({
              nid: matchedRow.nid,
              bpsId: matchedRow.bpsId,
              workerId: matchedRow.workerId,
              workerName: matchedRow.workerName,
              action,
              esigId: esig.id,
              cardcheckId,
            });
          } catch (err) {
            const errorMessage = err instanceof Error ? err.message : 'Unknown error';
            results.errors.push({
              nid: matchedRow.nid,
              bpsId: matchedRow.bpsId,
              error: errorMessage,
            });
          }

          results.processed++;

          if (results.processed % 5 === 0) {
            await storage.wizards.update(wizardId, {
              data: {
                ...wizardData,
                processProgress: {
                  processed: results.processed,
                  total: results.total,
                },
              },
            });
          }

          await delay(500);
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
        const message = error instanceof Error ? error.message : 'Failed to process import';
        res.status(500).json({ message });
      } finally {
        if (browser) {
          await browser.close().catch(() => {});
        }
      }
    }
  );
}
