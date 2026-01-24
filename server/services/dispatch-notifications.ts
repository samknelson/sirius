import { eventBus, EventType, type DispatchSavedPayload } from "./event-bus";
import { sendSms } from "./sms-sender";
import { sendEmail } from "./email-sender";
import { sendInapp } from "./inapp-sender";
import { storage } from "../storage";
import { logger } from "../logger";
import { isComponentEnabledSync, isCacheInitialized } from "./component-cache";
import { createUnifiedOptionsStorage } from "../storage/unified-options";
import { createDispatchJobStorage } from "../storage/dispatch-jobs";
import { createDispatchStorage } from "../storage/dispatches";
import type { JobTypeData, NotificationMedia } from "@shared/schema/dispatch/eligibility-config";
import type { Comm } from "@shared/schema";

const SERVICE_NAME = "dispatch-notifications";
const COMPONENT_ID = "dispatch";

interface WorkerContactInfo {
  workerId: string;
  contactId: string;
  contactName: string;
  phoneNumber: string | null;
  email: string | null;
  userId: string | null;
}

async function getWorkerContactInfo(workerId: string): Promise<WorkerContactInfo | null> {
  const worker = await storage.workers.getWorker(workerId);
  if (!worker) {
    logger.warn(`Worker not found for dispatch notification`, { service: SERVICE_NAME, workerId });
    return null;
  }

  const contact = await storage.contacts.getContact(worker.contactId);
  if (!contact) {
    logger.warn(`Contact not found for dispatch notification`, { 
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

  const contactName = contact.displayName || 
    [contact.given, contact.family].filter(Boolean).join(' ') || 
    'Worker';

  return {
    workerId,
    contactId: contact.id,
    contactName,
    phoneNumber: activePhone?.phoneNumber || null,
    email: contact.email || null,
    userId: user?.id || null,
  };
}

async function getJobNotificationConfig(jobId: string, dispatchId: string): Promise<{ 
  employerName: string; 
  notificationMedia: NotificationMedia[];
  dispatchUrl: string;
} | null> {
  const jobStorage = createDispatchJobStorage();
  const unifiedOptionsStorage = createUnifiedOptionsStorage();

  const job = await jobStorage.getWithRelations(jobId);
  if (!job) {
    logger.warn(`Dispatch job not found for notification`, { service: SERVICE_NAME, jobId });
    return null;
  }

  const employerName = job.employer?.name || 'Employer';

  let notificationMedia: NotificationMedia[] = [];
  if (job.jobTypeId) {
    const jobType = await unifiedOptionsStorage.get("dispatch-job-type", job.jobTypeId);
    if (jobType) {
      const jobTypeData = jobType.data as JobTypeData | null;
      notificationMedia = jobTypeData?.notificationMedia || [];
    }
  }

  const domain = process.env.REPLIT_DEV_DOMAIN || process.env.REPLIT_DOMAINS?.split(',')[0] || 'localhost:5000';
  const dispatchUrl = `https://${domain}/dispatch/${dispatchId}`;

  return {
    employerName,
    notificationMedia,
    dispatchUrl,
  };
}

function buildNotificationMessage(employerName: string, dispatchUrl: string): { 
  smsMessage: string;
  emailSubject: string;
  emailBody: string;
  inappTitle: string;
  inappBody: string;
} {
  const messageText = `Job offer from ${employerName}. Details here: ${dispatchUrl}`;
  
  return {
    smsMessage: messageText,
    emailSubject: `Job Offer from ${employerName}`,
    emailBody: messageText,
    inappTitle: `Job Offer`,
    inappBody: `Job offer from ${employerName}.`,
  };
}

async function sendDispatchNotifications(
  dispatchId: string,
  workerInfo: WorkerContactInfo,
  jobConfig: { employerName: string; notificationMedia: NotificationMedia[]; dispatchUrl: string }
): Promise<string[]> {
  const commIds: string[] = [];
  const messages = buildNotificationMessage(jobConfig.employerName, jobConfig.dispatchUrl);

  for (const medium of jobConfig.notificationMedia) {
    try {
      let result: { success: boolean; comm?: Comm; error?: string } | null = null;

      switch (medium) {
        case 'sms':
          if (workerInfo.phoneNumber) {
            result = await sendSms({
              contactId: workerInfo.contactId,
              toPhoneNumber: workerInfo.phoneNumber,
              message: messages.smsMessage,
            });
            if (result.comm) {
              commIds.push(result.comm.id);
            }
            logger.info(`SMS notification ${result.success ? 'sent' : 'failed'} for dispatch`, {
              service: SERVICE_NAME,
              dispatchId,
              workerId: workerInfo.workerId,
              success: result.success,
              error: result.error,
            });
          } else {
            logger.warn(`No phone number available for SMS notification`, {
              service: SERVICE_NAME,
              dispatchId,
              workerId: workerInfo.workerId,
            });
          }
          break;

        case 'email':
          if (workerInfo.email) {
            result = await sendEmail({
              contactId: workerInfo.contactId,
              toEmail: workerInfo.email,
              toName: workerInfo.contactName,
              subject: messages.emailSubject,
              bodyText: messages.emailBody,
            });
            if (result.comm) {
              commIds.push(result.comm.id);
            }
            logger.info(`Email notification ${result.success ? 'sent' : 'failed'} for dispatch`, {
              service: SERVICE_NAME,
              dispatchId,
              workerId: workerInfo.workerId,
              success: result.success,
              error: result.error,
            });
          } else {
            logger.warn(`No email available for email notification`, {
              service: SERVICE_NAME,
              dispatchId,
              workerId: workerInfo.workerId,
            });
          }
          break;

        case 'in-app':
          if (workerInfo.userId) {
            result = await sendInapp({
              contactId: workerInfo.contactId,
              userId: workerInfo.userId,
              title: messages.inappTitle,
              body: messages.inappBody,
              linkUrl: jobConfig.dispatchUrl,
              linkLabel: 'View Details',
            });
            if (result.comm) {
              commIds.push(result.comm.id);
            }
            logger.info(`In-app notification ${result.success ? 'sent' : 'failed'} for dispatch`, {
              service: SERVICE_NAME,
              dispatchId,
              workerId: workerInfo.workerId,
              success: result.success,
              error: result.error,
            });
          } else {
            logger.warn(`No user account available for in-app notification`, {
              service: SERVICE_NAME,
              dispatchId,
              workerId: workerInfo.workerId,
            });
          }
          break;

        default:
          logger.warn(`Unknown notification medium: ${medium}`, {
            service: SERVICE_NAME,
            dispatchId,
          });
      }
    } catch (error: any) {
      logger.error(`Failed to send ${medium} notification for dispatch`, {
        service: SERVICE_NAME,
        dispatchId,
        workerId: workerInfo.workerId,
        medium,
        error: error?.message || String(error),
      });
    }
  }

  return commIds;
}

async function handleDispatchSaved(payload: DispatchSavedPayload): Promise<void> {
  if (!isCacheInitialized()) {
    logger.debug(`Component cache not initialized, skipping dispatch notification`, {
      service: SERVICE_NAME,
    });
    return;
  }

  if (!isComponentEnabledSync(COMPONENT_ID)) {
    logger.debug(`${COMPONENT_ID} component not enabled, skipping dispatch notification`, {
      service: SERVICE_NAME,
    });
    return;
  }

  if (payload.status !== 'notified') {
    return;
  }

  if (payload.previousStatus === 'notified') {
    logger.debug(`Dispatch already in notified status, skipping notification`, {
      service: SERVICE_NAME,
      dispatchId: payload.dispatchId,
    });
    return;
  }

  logger.info(`Processing dispatch notification`, {
    service: SERVICE_NAME,
    dispatchId: payload.dispatchId,
    workerId: payload.workerId,
    jobId: payload.jobId,
    previousStatus: payload.previousStatus,
  });

  try {
    const workerInfo = await getWorkerContactInfo(payload.workerId);
    if (!workerInfo) {
      logger.warn(`Could not get worker contact info for dispatch notification`, {
        service: SERVICE_NAME,
        dispatchId: payload.dispatchId,
        workerId: payload.workerId,
      });
      return;
    }

    const jobConfig = await getJobNotificationConfig(payload.jobId, payload.dispatchId);
    if (!jobConfig) {
      logger.warn(`Could not get job config for dispatch notification`, {
        service: SERVICE_NAME,
        dispatchId: payload.dispatchId,
        jobId: payload.jobId,
      });
      return;
    }

    if (jobConfig.notificationMedia.length === 0) {
      logger.debug(`No notification media configured for job type, skipping notification`, {
        service: SERVICE_NAME,
        dispatchId: payload.dispatchId,
        jobId: payload.jobId,
      });
      return;
    }

    const commIds = await sendDispatchNotifications(payload.dispatchId, workerInfo, jobConfig);

    if (commIds.length > 0) {
      const dispatchStorage = createDispatchStorage();
      await dispatchStorage.update(payload.dispatchId, { commIds });
      
      logger.info(`Updated dispatch with comm IDs`, {
        service: SERVICE_NAME,
        dispatchId: payload.dispatchId,
        commIds,
      });
    }

  } catch (error: any) {
    logger.error(`Failed to process dispatch notification`, {
      service: SERVICE_NAME,
      dispatchId: payload.dispatchId,
      error: error?.message || String(error),
    });
  }
}

let handlerId: string | null = null;

export function initDispatchNotifications(): void {
  if (handlerId) {
    logger.warn(`Dispatch notifications already initialized`, { service: SERVICE_NAME });
    return;
  }

  handlerId = eventBus.on(EventType.DISPATCH_SAVED, handleDispatchSaved);
  
  logger.info(`Dispatch notifications service initialized`, { service: SERVICE_NAME });
}

export function stopDispatchNotifications(): void {
  if (handlerId) {
    eventBus.off(handlerId);
    handlerId = null;
    logger.info(`Dispatch notifications service stopped`, { service: SERVICE_NAME });
  }
}
