import puppeteer, { type Browser, type Page } from "puppeteer-core";
import { PDFDocument } from "pdf-lib";
import { registerWizardPlugin } from "../registry";
import type { WizardPlugin, WizardStepContext } from "../types";
import { objectStorageService } from "../../../services/objectStorage";
import { insertFileSchema } from "@shared/schema";
import { logger } from "../../../logger";
import { sendInapp } from "../../../services/comm/senders/inapp";
import { sendEmail } from "../../../services/comm/senders/email";

const SERVICE = "btu-cardcheck-scrape-import-plugin";
const CHROMIUM_PATH =
  "/nix/store/qa9cnw4v5xkxyip6mb9kxqfq1z4x2dx1-chromium-138.0.7204.100/bin/chromium";
const LOGIN_URL = "https://sirius-btu.activistcentral.net/user/login";

function getCardcheckPageUrl(nid: string): string {
  return `https://sirius-btu.activistcentral.net/node/${nid}/sirius_log_cardcheck`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveUserId(ctx: WizardStepContext): string {
  const userId = (ctx.req.user as any)?.dbUser?.id;
  if (!userId) throw new Error("User not resolved");
  return userId;
}

async function launchBrowser(): Promise<Browser> {
  return puppeteer.launch({
    headless: true,
    executablePath: CHROMIUM_PATH,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
    ],
  });
}

async function loginToSite(page: Page): Promise<void> {
  const username = process.env.BTU_SCRAPER_USERNAME;
  const password = process.env.BTU_SCRAPER_PASSWORD;
  if (!username || !password) {
    throw new Error(
      "BTU_SCRAPER_USERNAME and BTU_SCRAPER_PASSWORD environment variables are required",
    );
  }

  await page.goto(LOGIN_URL, { waitUntil: "networkidle2", timeout: 60000 });

  const hasLoginForm = await page.evaluate(
    () => !!document.querySelector("#edit-name"),
  );
  if (!hasLoginForm) {
    const pageTitle = await page.title();
    throw new Error(`Login form not found on page. Page title: ${pageTitle}`);
  }

  await page.type("#edit-name", username);
  await page.type("#edit-pass", password);
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle2", timeout: 60000 }),
    page.click("#edit-submit"),
  ]);

  const hasLoginError = await page.evaluate(() => {
    const errorMsg = document.querySelector(".messages.error, .error-message");
    return errorMsg ? errorMsg.textContent?.trim() : null;
  });
  if (hasLoginError) {
    throw new Error(`Login failed: ${hasLoginError}`);
  }
}

interface ScrapeResults {
  processed: number;
  total: number;
  created: number;
  skipped: number;
  errors: Array<{ cardcheckId: string; externalId: string; error: string }>;
  processedRows: Array<{
    cardcheckId: string;
    externalId: string;
    workerId: string;
    action: string;
    esigId?: string;
  }>;
}

/** Read-modify-write the wizard's live `processProgress` blob. */
async function writeProgress(
  ctx: WizardStepContext,
  progress: Record<string, unknown>,
): Promise<void> {
  const fresh = await ctx.storage.wizards.getById(ctx.wizardId);
  if (!fresh) return;
  const data: any = fresh.data || {};
  await ctx.storage.wizards.update(ctx.wizardId, {
    data: { ...data, processProgress: progress },
  });
}

/**
 * BTU card check scraper import, in a box. Configure (pick the card check
 * definition) → Process (log in to the external BTU site with puppeteer,
 * fetch each missing signature PDF by NID, create e-sig records and link
 * them) → Results. The long-running scrape is a `run` step: the fixed
 * dispatcher returns 202, runs it in the background, and the client polls
 * the wizard load route for progress. No wizard-specific route. The
 * external site login/PDF work is plain I/O; all DB access is via
 * `ctx.storage`.
 */
export const btuCardcheckScrapeImportPlugin: WizardPlugin = {
  id: "btu_cardcheck_scrape_import",
  name: "BTU Card Check Scraper Import",
  description:
    "Fetch PDF signatures from the external BTU site for card checks that have a NID but are missing a signature",
  requiredComponent: "sitespecific.btu",
  category: "Import",
  steps: [
    {
      id: "configure",
      name: "Configure",
      description: "Select the card check definition",
      kind: "custom",
      component: "ScrapeConfigure",
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
      id: "process",
      name: "Process",
      description: "Fetch PDFs and create e-signatures",
      kind: "run",
      component: "ScrapeProcess",
      getState: (wizard) => {
        const data = (wizard.data as any) || {};
        if (data.processResults) return "completed";
        return wizard.currentStep === "process" ? "in_progress" : "pending";
      },
      getData: async (ctx: WizardStepContext) => {
        const defId = (ctx.wizard.data as any)?.cardcheckDefinitionId;
        if (!defId) return { pendingCount: 0, cardcheckDefinitionId: null };
        const pending =
          await ctx.storage.cardchecks.getCardchecksWithExternalIdMissingEsig(
            defId,
          );
        return { pendingCount: pending.length, cardcheckDefinitionId: defId };
      },
      run: async (ctx: WizardStepContext) => {
        const data = (ctx.wizard.data as any) || {};
        const cardcheckDefinitionId = data.cardcheckDefinitionId;
        if (!cardcheckDefinitionId) {
          throw new Error(
            "No card check definition selected. Complete the configure step first.",
          );
        }
        const userId = resolveUserId(ctx);

        const pendingCardchecks =
          await ctx.storage.cardchecks.getCardchecksWithExternalIdMissingEsig(
            cardcheckDefinitionId,
          );

        if (pendingCardchecks.length === 0) {
          return {
            data: {
              processResults: {
                processed: 0,
                total: 0,
                created: 0,
                skipped: 0,
                errors: [],
                processedRows: [],
              } as ScrapeResults,
              processProgress: null,
            },
            status: "completed",
          };
        }

        await writeProgress(ctx, {
          status: "processing",
          current: 0,
          total: pendingCardchecks.length,
          created: 0,
          skipped: 0,
          errors: 0,
          currentActivity: "Starting...",
        });

        const results: ScrapeResults = {
          processed: 0,
          total: pendingCardchecks.length,
          created: 0,
          skipped: 0,
          errors: [],
          processedRows: [],
        };

        let browser: Browser | null = null;
        try {
          browser = await launchBrowser();
          const page = await browser.newPage();
          await loginToSite(page);

          for (let i = 0; i < pendingCardchecks.length; i++) {
            const cardcheck = pendingCardchecks[i];
            const nid = cardcheck.externalId!;

            if (i % 3 === 0) {
              await writeProgress(ctx, {
                status: "processing",
                current: i + 1,
                total: pendingCardchecks.length,
                created: results.created,
                skipped: results.skipped,
                errors: results.errors.length,
                currentActivity: `Fetching PDF for NID ${nid} (${i + 1} of ${pendingCardchecks.length})...`,
              }).catch(() => {});
            }
            await ctx
              .reportProgress(
                Math.round((i / pendingCardchecks.length) * 100),
              )
              .catch(() => {});

            try {
              const freshCardcheck =
                await ctx.storage.cardchecks.getCardcheckById(cardcheck.id);
              if (!freshCardcheck || freshCardcheck.esigId) {
                results.skipped++;
                results.processed++;
                results.processedRows.push({
                  cardcheckId: cardcheck.id,
                  externalId: nid,
                  workerId: cardcheck.workerId,
                  action: "skipped",
                });
                continue;
              }

              const cardcheckPageUrl = getCardcheckPageUrl(nid);
              await page.goto(cardcheckPageUrl, {
                waitUntil: "networkidle2",
                timeout: 60000,
              });
              await delay(500);

              const pageTitle = await page.title();
              if (pageTitle.toLowerCase().includes("access denied")) {
                throw new Error(`Access denied for NID ${nid}`);
              }
              if (
                pageTitle.toLowerCase().includes("not found") ||
                pageTitle.toLowerCase().includes("page not found")
              ) {
                throw new Error(`Page not found for NID ${nid}`);
              }

              const pagePdfBuffer = await page.pdf({
                format: "Letter",
                printBackground: true,
              });

              const attachedPdfUrls: string[] = await page.evaluate(() => {
                const links = Array.from(
                  document.querySelectorAll("a[href]"),
                );
                return links
                  .map((a) => (a as HTMLAnchorElement).href)
                  .filter((href) => href.toLowerCase().endsWith(".pdf"));
              });

              const cookies = await page.cookies();
              const cookieString = cookies
                .map((c) => `${c.name}=${c.value}`)
                .join("; ");

              let combinedPdfBytes: Uint8Array;
              try {
                const combinedDoc = await PDFDocument.create();
                const pageDoc = await PDFDocument.load(pagePdfBuffer);
                const pagePages = await combinedDoc.copyPages(
                  pageDoc,
                  pageDoc.getPageIndices(),
                );
                for (const p of pagePages) combinedDoc.addPage(p);

                for (const pdfUrl of attachedPdfUrls) {
                  try {
                    const pdfFetchResponse = await fetch(pdfUrl, {
                      headers: { Cookie: cookieString },
                      redirect: "follow",
                    });
                    if (!pdfFetchResponse.ok) continue;
                    const pdfArrayBuffer = await pdfFetchResponse.arrayBuffer();
                    const pdfBuffer = Buffer.from(pdfArrayBuffer);
                    if (pdfBuffer.length < 100) continue;
                    const attachedDoc = await PDFDocument.load(pdfBuffer, {
                      ignoreEncryption: true,
                    });
                    const attachedPages = await combinedDoc.copyPages(
                      attachedDoc,
                      attachedDoc.getPageIndices(),
                    );
                    for (const ap of attachedPages) combinedDoc.addPage(ap);
                  } catch (attachErr) {
                    logger.warn("Failed to download/parse attached PDF", {
                      service: SERVICE,
                      pdfUrl,
                      error: attachErr,
                    });
                  }
                }
                combinedPdfBytes = await combinedDoc.save();
              } catch (combineErr) {
                logger.warn("Failed to combine PDFs, using page PDF only", {
                  service: SERVICE,
                  error: combineErr,
                });
                combinedPdfBytes = new Uint8Array(pagePdfBuffer);
              }

              const fileName = `cardcheck_scrape_${nid}.pdf`;
              const uploadResult = await objectStorageService.uploadFile({
                fileName,
                fileContent: Buffer.from(combinedPdfBytes),
                mimeType: "application/pdf",
                accessLevel: "private",
              });

              const pdfFileRecord = await ctx.storage.files.create(
                insertFileSchema.parse({
                  fileName,
                  storagePath: uploadResult.storagePath,
                  mimeType: "application/pdf",
                  size: uploadResult.size,
                  uploadedBy: userId,
                  entityType: "esig",
                  entityId: null,
                  accessLevel: "private",
                  metadata: {
                    nid,
                    cardcheckId: cardcheck.id,
                    wizardId: ctx.wizardId,
                    importType: "btu_cardcheck_scrape_import",
                  },
                }),
              );

              const signedDate = cardcheck.signedDate || new Date();
              const esig = await ctx.storage.esigs.createEsig({
                userId,
                status: "signed",
                signedDate,
                type: "upload",
                docRender: "",
                docHash: "",
                esig: {
                  type: "upload",
                  value: pdfFileRecord.id,
                  fileName,
                  nid,
                  source: "scraper",
                },
                docType: "cardcheck",
                docFileId: pdfFileRecord.id,
              });

              if (pdfFileRecord.id) {
                await ctx.storage.files.update(pdfFileRecord.id, {
                  entityId: esig.id,
                });
              }

              await ctx.storage.cardchecks.updateCardcheck(cardcheck.id, {
                esigId: esig.id,
              });

              results.created++;
              results.processedRows.push({
                cardcheckId: cardcheck.id,
                externalId: nid,
                workerId: cardcheck.workerId,
                action: "linked",
                esigId: esig.id,
              });
            } catch (err) {
              const errorMessage =
                err instanceof Error ? err.message : "Unknown error";
              logger.error(`Scraper error for NID ${nid}`, {
                service: SERVICE,
                error: err,
                cardcheckId: cardcheck.id,
              });
              results.errors.push({
                cardcheckId: cardcheck.id,
                externalId: nid,
                error: errorMessage,
              });
            }

            results.processed++;
            await delay(500);
          }
        } finally {
          if (browser) {
            await browser.close().catch(() => {});
          }
        }

        const hasErrors = results.errors.length > 0;

        try {
          const user = await ctx.storage.users.getUser(userId);
          if (user?.email) {
            const contact = await ctx.storage.contacts.getContactByEmail(
              user.email,
            );
            if (contact) {
              const title = `Card Check Scraper Import ${hasErrors ? "Completed with Errors" : "Complete"}`;
              const body = `Processed ${results.total} card checks: ${results.created} PDFs fetched, ${results.skipped} skipped, ${results.errors.length} errors.`;
              const linkUrl = `/wizards/${ctx.wizardId}`;
              await sendInapp({
                contactId: contact.id,
                userId: user.id,
                title,
                body,
                linkUrl,
                linkLabel: "View Results",
                initiatedBy: "system",
              });
              await sendEmail({
                contactId: contact.id,
                toEmail: user.email,
                toName:
                  `${user.firstName || ""} ${user.lastName || ""}`.trim() ||
                  undefined,
                subject: title,
                bodyText: body,
              });
            }
          }
        } catch (notifErr) {
          logger.warn("Failed to send scraper completion notification", {
            service: SERVICE,
            error: notifErr,
          });
        }

        return {
          data: { processResults: results, processProgress: null },
          status: hasErrors ? "completed_with_errors" : "completed",
        };
      },
    },
    {
      id: "results",
      name: "Results",
      description: "Review import results",
      kind: "custom",
      component: "ScrapeResults",
      getState: (wizard) => {
        const data = (wizard.data as any) || {};
        if (data.processResults) return "completed";
        return wizard.currentStep === "results" ? "in_progress" : "pending";
      },
    },
  ],
};

registerWizardPlugin(btuCardcheckScrapeImportPlugin);
