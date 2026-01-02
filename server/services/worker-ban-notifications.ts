import { eventBus, EventType, type WorkerBanSavedPayload } from "./event-bus";
import { getWorkerBanNotificationConfig } from "../modules/worker-ban-config";
import { sendSms } from "./sms-sender";
import { sendEmail } from "./email-sender";
import { sendInapp } from "./inapp-sender";
import { storage } from "../storage";
import { logger } from "../logger";
import { isComponentEnabledSync, isCacheInitialized } from "./component-cache";

const SERVICE_NAME = "worker-ban-notifications";
const COMPONENT_ID = "worker.ban";

async function getWorkerContactInfo(workerId: string) {
  const worker = await storage.workers.getWorker(workerId);
  if (!worker) {
    logger.warn(`Worker not found for ban notification`, { service: SERVICE_NAME, workerId });
    return null;
  }

  const contact = await storage.contacts.getContact(worker.contactId);
  if (!contact) {
    logger.warn(`Contact not found for worker ban notification`, { 
      service: SERVICE_NAME, 
      workerId,
      contactId: worker.contactId 
    });
    return null;
  }

  const phoneNumbers = await storage.contacts.phoneNumbers.getPhoneNumbersByContact(contact.id);
  const primaryPhone = phoneNumbers.find(p => p.isPrimary && p.isActive);
  const activePhone = primaryPhone || phoneNumbers.find(p => p.isActive);

  const user = contact.email ? await storage.users.getUserByEmail(contact.email) : null;

  return {
    worker,
    contact,
    phoneNumber: activePhone?.phoneNumber || null,
    userId: user?.id || null,
  };
}

function formatBanType(type: string | null): string {
  if (!type) return "general";
  return type.replace(/_/g, " ").toLowerCase();
}

function formatDate(date: Date): string {
  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

async function handleWorkerBanSaved(payload: WorkerBanSavedPayload): Promise<void> {
  if (!isCacheInitialized()) {
    logger.debug(`Component cache not initialized, skipping ban notification`, {
      service: SERVICE_NAME,
    });
    return;
  }

  if (!isComponentEnabledSync(COMPONENT_ID)) {
    logger.debug(`${COMPONENT_ID} component not enabled, skipping ban notification`, {
      service: SERVICE_NAME,
    });
    return;
  }

  if (payload.isDeleted) {
    logger.debug(`Ban deleted, skipping notification`, {
      service: SERVICE_NAME,
      banId: payload.banId,
      workerId: payload.workerId,
    });
    return;
  }

  if (!payload.active) {
    logger.debug(`Ban is not active, skipping notification`, {
      service: SERVICE_NAME,
      banId: payload.banId,
      workerId: payload.workerId,
    });
    return;
  }

  try {
    const config = await getWorkerBanNotificationConfig(storage);

    if (!config.email && !config.sms && !config.inApp) {
      logger.debug(`No notification channels enabled for worker bans`, {
        service: SERVICE_NAME,
        banId: payload.banId,
      });
      return;
    }

    const contactInfo = await getWorkerContactInfo(payload.workerId);
    if (!contactInfo) {
      logger.warn(`Could not get contact info for worker ban notification`, {
        service: SERVICE_NAME,
        banId: payload.banId,
        workerId: payload.workerId,
      });
      return;
    }

    const { contact, phoneNumber, userId } = contactInfo;
    const workerName = contact.given || contact.displayName || "Worker";
    const banType = formatBanType(payload.type);
    const startDate = formatDate(payload.startDate);
    const endDate = payload.endDate ? formatDate(payload.endDate) : null;

    const title = "Ban Notification";
    const message = endDate
      ? `A ${banType} ban has been applied to your account from ${startDate} to ${endDate}.`
      : `A ${banType} ban has been applied to your account starting ${startDate}.`;

    const results = {
      sms: null as boolean | null,
      email: null as boolean | null,
      inApp: null as boolean | null,
    };

    if (config.sms && phoneNumber) {
      try {
        const smsResult = await sendSms({
          contactId: contact.id,
          toPhoneNumber: phoneNumber,
          message: `${title}: ${message}`,
          userId: userId || undefined,
        });
        results.sms = smsResult.success;
        if (!smsResult.success) {
          logger.warn(`Failed to send SMS ban notification`, {
            service: SERVICE_NAME,
            banId: payload.banId,
            workerId: payload.workerId,
            error: smsResult.error,
          });
        }
      } catch (error) {
        logger.error(`Error sending SMS ban notification`, {
          service: SERVICE_NAME,
          banId: payload.banId,
          workerId: payload.workerId,
          error: error instanceof Error ? error.message : String(error),
        });
        results.sms = false;
      }
    } else if (config.sms && !phoneNumber) {
      logger.debug(`Worker has no active phone number for SMS notification`, {
        service: SERVICE_NAME,
        banId: payload.banId,
        workerId: payload.workerId,
      });
    }

    if (config.email && contact.email) {
      try {
        const emailResult = await sendEmail({
          contactId: contact.id,
          toEmail: contact.email,
          toName: workerName,
          subject: title,
          bodyHtml: `<p>Hello ${workerName},</p><p>${message}</p><p>If you have questions about this ban, please contact your administrator.</p>`,
          bodyText: `Hello ${workerName},\n\n${message}\n\nIf you have questions about this ban, please contact your administrator.`,
          userId: userId || undefined,
        });
        results.email = emailResult.success;
        if (!emailResult.success) {
          logger.warn(`Failed to send email ban notification`, {
            service: SERVICE_NAME,
            banId: payload.banId,
            workerId: payload.workerId,
            error: emailResult.error,
          });
        }
      } catch (error) {
        logger.error(`Error sending email ban notification`, {
          service: SERVICE_NAME,
          banId: payload.banId,
          workerId: payload.workerId,
          error: error instanceof Error ? error.message : String(error),
        });
        results.email = false;
      }
    } else if (config.email && !contact.email) {
      logger.debug(`Worker has no email address for email notification`, {
        service: SERVICE_NAME,
        banId: payload.banId,
        workerId: payload.workerId,
      });
    }

    if (config.inApp && userId) {
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
          logger.warn(`Failed to send in-app ban notification`, {
            service: SERVICE_NAME,
            banId: payload.banId,
            workerId: payload.workerId,
            error: inAppResult.error,
          });
        }
      } catch (error) {
        logger.error(`Error sending in-app ban notification`, {
          service: SERVICE_NAME,
          banId: payload.banId,
          workerId: payload.workerId,
          error: error instanceof Error ? error.message : String(error),
        });
        results.inApp = false;
      }
    } else if (config.inApp && !userId) {
      logger.debug(`Worker has no user account for in-app notification`, {
        service: SERVICE_NAME,
        banId: payload.banId,
        workerId: payload.workerId,
      });
    }

    logger.info(`Worker ban notification processed`, {
      service: SERVICE_NAME,
      banId: payload.banId,
      workerId: payload.workerId,
      results,
    });
  } catch (error) {
    logger.error(`Failed to process worker ban notification`, {
      service: SERVICE_NAME,
      banId: payload.banId,
      workerId: payload.workerId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

let handlerId: string | null = null;

export function initWorkerBanNotifications(): void {
  if (handlerId) {
    logger.warn(`Worker ban notifications already initialized`, { service: SERVICE_NAME });
    return;
  }

  handlerId = eventBus.on(EventType.WORKER_BAN_SAVED, handleWorkerBanSaved);
  
  logger.info(`Worker ban notifications initialized`, { service: SERVICE_NAME });
}

export function shutdownWorkerBanNotifications(): void {
  if (handlerId) {
    eventBus.off(handlerId);
    handlerId = null;
    logger.info(`Worker ban notifications shutdown`, { service: SERVICE_NAME });
  }
}
