import { registerWizardPlugin } from "../registry";
import type { WizardPlugin, WizardStepContext } from "../types";
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

const SERVICE = "btu-cardcheck-scrape-import-plugin";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveUserId(ctx: WizardStepContext): string {
  const userId = (ctx.req.user as any)?.dbUser?.id;
  if (!userId) throw new Error("User not resolved");
  return userId;
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
 * definition) → Process (start an external BTU scrape session, fetch each
 * missing signature PDF by NID, create e-sig records and link them) →
 * Results. The long-running scrape is a `run` step: the fixed
 * dispatcher returns 202, runs it in the background, and the client polls
 * the wizard load route for progress. No wizard-specific route. The
 * external site login/PDF work is delegated to the BTU scrape service; all DB
 * access is via `ctx.storage`.
 */
export const btuCardcheckScrapeImportPlugin: WizardPlugin = {
  id: "btu_cardcheck_scrape_import",
  name: "BTU Card Check Scraper Import",
  description:
    "Fetch PDF signatures from the external BTU site for card checks that have a NID but are missing a signature",
  requiredComponent: "sitespecific.btu",
  requiredPolicy: "admin",
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

        let sessionId: string | null = null;
        try {
          sessionId = await startBtuCardcheckScrape();

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

              const combinedPdfBytes = await fetchBtuCardcheckPdf(
                sessionId,
                nid,
              );

              const fileName = `cardcheck_scrape_${nid}.pdf`;
              const uploadResult = await fileSystemService.upload({
                fileName,
                fileContent: Buffer.from(combinedPdfBytes),
                mimeType: "application/pdf",
                fileSystemId: "private",
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
                  fileSystemId: "private",
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
              // A maintenance refusal stops the run rather than becoming a
              // per-card error: nothing was fetched, and every remaining card
              // would be refused for the same reason.
              if (isMaintenanceModeError(err)) throw err;
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
          if (sessionId) {
            await closeBtuCardcheckScrape(sessionId).catch(() => {});
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
