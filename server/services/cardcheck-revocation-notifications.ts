import { sendEmail } from "./email-sender";
import { sendInapp } from "./inapp-sender";
import { storage } from "../storage";
import { logger } from "../logger";

const SERVICE_NAME = "cardcheck-revocation-notifications";

async function getWorkerContactInfo(workerId: string) {
  const worker = await storage.workers.getWorker(workerId);
  if (!worker) {
    logger.warn(`Worker not found for revocation notification`, { service: SERVICE_NAME, workerId });
    return null;
  }

  const contact = await storage.contacts.getContact(worker.contactId);
  if (!contact) {
    logger.warn(`Contact not found for revocation notification`, {
      service: SERVICE_NAME,
      workerId,
      contactId: worker.contactId,
    });
    return null;
  }

  const user = contact.email ? await storage.users.getUserByEmail(contact.email) : null;

  return {
    worker,
    contact,
    userId: user?.id || null,
  };
}

export async function sendCardcheckRevocationNotification(
  workerId: string,
  cardcheckId: string,
  definitionName: string
): Promise<void> {
  try {
    const contactInfo = await getWorkerContactInfo(workerId);
    if (!contactInfo) {
      logger.warn(`Could not get contact info for revocation notification`, {
        service: SERVICE_NAME,
        cardcheckId,
        workerId,
      });
      return;
    }

    const { contact, userId } = contactInfo;
    const workerName = contact.given || contact.displayName || "Worker";
    const title = "Card Check Revoked";
    const message = `Your "${definitionName}" card check has been revoked. If you have questions, please contact your administrator.`;

    const results = {
      email: null as boolean | null,
      inApp: null as boolean | null,
    };

    if (userId) {
      try {
        const inAppResult = await sendInapp({
          contactId: contact.id,
          userId,
          title,
          body: message,
          initiatedBy: "system",
        });
        results.inApp = inAppResult.success;
        if (!inAppResult.success) {
          logger.warn(`Failed to send in-app revocation notification`, {
            service: SERVICE_NAME,
            cardcheckId,
            workerId,
            error: inAppResult.error,
          });
        }
      } catch (error) {
        logger.error(`Error sending in-app revocation notification`, {
          service: SERVICE_NAME,
          cardcheckId,
          workerId,
          error: error instanceof Error ? error.message : String(error),
        });
        results.inApp = false;
      }
    } else {
      logger.debug(`Worker has no user account for in-app notification`, {
        service: SERVICE_NAME,
        cardcheckId,
        workerId,
      });
    }

    if (contact.email) {
      try {
        const emailResult = await sendEmail({
          contactId: contact.id,
          toEmail: contact.email,
          toName: workerName,
          subject: title,
          bodyHtml: `<p>Hello ${workerName},</p><p>Your "<strong>${definitionName}</strong>" card check has been revoked.</p><p>If you have questions about this change, please contact your administrator.</p>`,
          bodyText: `Hello ${workerName},\n\nYour "${definitionName}" card check has been revoked.\n\nIf you have questions about this change, please contact your administrator.`,
          userId: userId || undefined,
        });
        results.email = emailResult.success;
        if (!emailResult.success) {
          logger.warn(`Failed to send email revocation notification`, {
            service: SERVICE_NAME,
            cardcheckId,
            workerId,
            error: emailResult.error,
          });
        }
      } catch (error) {
        logger.error(`Error sending email revocation notification`, {
          service: SERVICE_NAME,
          cardcheckId,
          workerId,
          error: error instanceof Error ? error.message : String(error),
        });
        results.email = false;
      }
    } else {
      logger.debug(`Worker has no email address for email notification`, {
        service: SERVICE_NAME,
        cardcheckId,
        workerId,
      });
    }

    logger.info(`Card check revocation notification processed`, {
      service: SERVICE_NAME,
      cardcheckId,
      workerId,
      results,
    });
  } catch (error) {
    logger.error(`Failed to process card check revocation notification`, {
      service: SERVICE_NAME,
      cardcheckId,
      workerId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
