import type { Request, Response } from 'express';
import { TwilioStatusHandler } from './twilio';
import { SendGridStatusHandler } from './sendgrid';
import {
  LobStatusHandler,
  isLobMailingConfirmedEvent,
  resolveLobCallbackStatus,
} from './lob';
import type { CommStatusHandler, CommStatusUpdate } from './index';
import { createCommStorage, createCommSmsStorage, createCommEmailStorage, createCommPostalStorage } from '../../../storage/comm';
import { storageLogger } from '../../../logger';
import { runInTransaction } from '../../../storage/transaction-context';

const commStorage = createCommStorage();
const commSmsStorage = createCommSmsStorage();
const commEmailStorage = createCommEmailStorage();
const commPostalStorage = createCommPostalStorage();

const twilioHandler = new TwilioStatusHandler();
const sendgridHandler = new SendGridStatusHandler();
const lobHandler = new LobStatusHandler();

const handlersByMediumProvider: Record<string, CommStatusHandler> = {
  'sms:twilio': twilioHandler,
  'email:sendgrid': sendgridHandler,
  'postal:lob': lobHandler,
};

function getHandler(medium: string, providerId: string): CommStatusHandler | undefined {
  const key = `${medium}:${providerId}`;
  return handlersByMediumProvider[key];
}

function inferProviderFromComm(comm: { medium: string; data: unknown }): string {
  const data = comm.data as Record<string, unknown> | null;
  
  if (data?.messageId && typeof data.messageId === 'string') {
    if (data.messageId.startsWith('SM') || data.messageId.startsWith('MM')) {
      return 'twilio';
    }
  }
  
  if (data?.letterId && typeof data.letterId === 'string') {
    if (data.letterId.startsWith('ltr_')) {
      return 'lob';
    }
  }
  
  if (comm.medium === 'sms') {
    return 'twilio';
  }
  
  if (comm.medium === 'email') {
    return 'sendgrid';
  }
  
  if (comm.medium === 'postal') {
    return 'lob';
  }
  
  return 'unknown';
}

export async function handleStatusCallback(
  req: Request,
  res: Response,
  commId: string
): Promise<void> {
  try {
    let comm = await commStorage.getCommWithDetails(commId);
    
    if (!comm) {
      console.warn(`Status callback received for unknown comm: ${commId}`);
      res.status(404).send('Comm record not found');
      return;
    }

    const providerId = inferProviderFromComm(comm);
    const handler = getHandler(comm.medium, providerId);
    
    if (!handler) {
      console.warn(`No handler found for ${comm.medium}:${providerId}`);
      res.status(200).send('OK');
      return;
    }

    const validationResult = await handler.validateRequest(req);
    if (!validationResult.valid) {
      console.warn(`Invalid ${providerId} callback for comm ${commId}: ${validationResult.error}`);
      
      storageLogger.warn(`Status callback validation failed for comm ${commId}`, {
        module: 'comm-status',
        operation: 'validateCallback',
        entity_id: commId,
        host_entity_id: comm.contactId,
        description: `${providerId} callback validation failed: ${validationResult.error}`,
        meta: {
          medium: comm.medium,
          providerId,
          error: validationResult.error,
        },
      });
      
      res.status(403).send('Forbidden');
      return;
    }

    const statusUpdate = handler.parseStatusUpdate(req);
    const providerMessageId = handler.getProviderMessageId(req);
    let previousStatus = comm.status;
    let appliedStatus = comm.status;

    await runInTransaction(async () => {
      await commStorage.lockComm(commId);
      const lockedComm = await commStorage.getCommWithDetails(commId);
      if (!lockedComm) throw new Error(`Comm record disappeared while applying callback: ${commId}`);
      comm = lockedComm;
      previousStatus = comm.status;
      if (providerId === 'lob') {
        const persistedLetterId =
          comm.postalDetails?.lobLetterId
          || (comm.postalDetails?.data as Record<string, unknown> | null)?.letterId
          || (comm.data as Record<string, unknown> | null)?.letterId;
        if (
          typeof persistedLetterId !== 'string'
          || !providerMessageId
          || providerMessageId !== persistedLetterId
        ) {
          throw new Error('LOB_LETTER_ID_MISMATCH');
        }
      }

      const existingData = comm.data as Record<string, unknown> || {};
      appliedStatus = providerId === 'lob'
        ? resolveLobCallbackStatus(
            previousStatus,
            statusUpdate.status,
            typeof existingData.lastAppliedStatusUpdate === 'string'
              ? existingData.lastAppliedStatusUpdate
              : undefined,
            statusUpdate.timestamp,
          )
        : statusUpdate.status;
      const previousAppliedAt = typeof existingData.lastAppliedStatusUpdate === 'string'
        ? new Date(existingData.lastAppliedStatusUpdate).getTime()
        : Number.NEGATIVE_INFINITY;
      const acceptedLifecycleUpdate = providerId !== 'lob'
        || appliedStatus !== previousStatus
        || (appliedStatus === statusUpdate.status
          && statusUpdate.timestamp.getTime() >= previousAppliedAt);
      const firstMailedAt = providerId === 'lob'
        && !comm.sent
        && ['sent', 'delivered', 'undelivered'].includes(statusUpdate.status)
        ? statusUpdate.timestamp
        : undefined;

      await commStorage.updateComm(commId, {
        status: appliedStatus,
        ...(firstMailedAt && { sent: firstMailedAt }),
        data: {
          ...existingData,
          lastProviderStatus: statusUpdate.providerStatus,
          lastStatusUpdate: statusUpdate.timestamp.toISOString(),
          ...(acceptedLifecycleUpdate && {
            lastAppliedStatusUpdate: statusUpdate.timestamp.toISOString(),
          }),
          ...(statusUpdate.errorCode && { lastErrorCode: statusUpdate.errorCode }),
          ...(statusUpdate.errorMessage && { lastErrorMessage: statusUpdate.errorMessage }),
        },
      });

      if (comm.smsDetails) {
        const smsData = comm.smsDetails.data as Record<string, unknown> || {};
        await commSmsStorage.updateCommSms(comm.smsDetails.id, {
          data: {
            ...smsData,
            providerStatus: statusUpdate.providerStatus,
            lastWebhookAt: statusUpdate.timestamp.toISOString(),
            ...(providerMessageId && { messageId: providerMessageId }),
            ...(statusUpdate.errorCode && { errorCode: statusUpdate.errorCode }),
            ...(statusUpdate.errorMessage && { errorMessage: statusUpdate.errorMessage }),
          },
        });
      }

      if (comm.emailDetails) {
        const emailData = comm.emailDetails.data as Record<string, unknown> || {};
        await commEmailStorage.updateCommEmail(comm.emailDetails.id, {
          data: {
            ...emailData,
            providerStatus: statusUpdate.providerStatus,
            lastWebhookAt: statusUpdate.timestamp.toISOString(),
            ...(providerMessageId && { messageId: providerMessageId }),
            ...(statusUpdate.errorCode && { errorCode: statusUpdate.errorCode }),
            ...(statusUpdate.errorMessage && { errorMessage: statusUpdate.errorMessage }),
          },
        });
      }

      if (comm.postalDetails) {
        const rawPayload = (statusUpdate.rawPayload || {}) as Record<string, unknown>;
        const eventBody = (rawPayload.body || {}) as Record<string, unknown>;
        const postalDataPatch: Record<string, unknown> = {
          providerStatus: statusUpdate.providerStatus,
          lastWebhookAt: statusUpdate.timestamp.toISOString(),
          lastWebhookPayload: rawPayload,
        };

        if (providerMessageId) postalDataPatch.letterId = providerMessageId;
        if (statusUpdate.errorCode) postalDataPatch.errorCode = statusUpdate.errorCode;
        if (statusUpdate.errorMessage) postalDataPatch.errorMessage = statusUpdate.errorMessage;
        if (eventBody.tracking_events) postalDataPatch.trackingEvents = eventBody.tracking_events;
        if (eventBody.expected_delivery_date) postalDataPatch.expectedDeliveryDate = eventBody.expected_delivery_date;
        if (eventBody.carrier) postalDataPatch.carrier = eventBody.carrier;
        if (eventBody.tracking_number) postalDataPatch.trackingNumber = eventBody.tracking_number;
        const mailingConfirmed =
          providerId === 'lob' && isLobMailingConfirmedEvent(statusUpdate.providerStatus);
        if (mailingConfirmed) {
          postalDataPatch.mailingConfirmedAt = statusUpdate.timestamp.toISOString();
          postalDataPatch.mailingConfirmedEvent = statusUpdate.providerStatus;
        }
        await commPostalStorage.mergeCommPostalData(
          comm.postalDetails.id,
          postalDataPatch,
          mailingConfirmed,
        );
      }
    });

    if (providerId === 'lob' && isLobMailingConfirmedEvent(statusUpdate.providerStatus)) {
      const { storage } = await import('../../../storage');
      if (await storage.baoCases.tableExists()) {
        await storage.baoCases.reconcileAppealNoticeComm(commId);
        await storage.baoCases.promoteAppealAfterConfirmedMailing(commId);
      }
    }

    storageLogger.info(`Comm status updated: ${commId}`, {
      module: 'comm-status',
      operation: 'statusCallback',
      entity_id: commId,
      host_entity_id: comm.contactId,
      description: appliedStatus === previousStatus
        ? `Status remained "${previousStatus}" (${providerId}: ${statusUpdate.providerStatus})`
        : `Status changed from "${previousStatus}" to "${appliedStatus}" (${providerId}: ${statusUpdate.providerStatus})`,
      meta: {
        medium: comm.medium,
        providerId,
        previousStatus,
        newStatus: appliedStatus,
        providerStatus: statusUpdate.providerStatus,
        providerMessageId,
        ...(statusUpdate.errorCode && { errorCode: statusUpdate.errorCode }),
        ...(statusUpdate.errorMessage && { errorMessage: statusUpdate.errorMessage }),
        rawPayload: statusUpdate.rawPayload,
      },
    });

    res.status(200).send('OK');

  } catch (error: any) {
    console.error(`Error handling status callback for comm ${commId}:`, error);
    
    storageLogger.error(`Status callback error for comm ${commId}`, {
      module: 'comm-status',
      operation: 'statusCallback',
      entity_id: commId,
      description: `Error processing status callback: ${error?.message || 'Unknown error'}`,
      meta: {
        error: error?.message,
        stack: error?.stack,
      },
    });
    
    res.status(500).send('Internal error');
  }
}

export async function handleLobStatusCallback(req: Request, res: Response): Promise<void> {
  try {
    const validationResult = await lobHandler.validateRequest(req);
    if (!validationResult.valid) {
      res.status(403).send('Forbidden');
      return;
    }

    const letterId = lobHandler.getProviderMessageId(req);
    if (!letterId) {
      res.status(400).send('Lob letter ID is required');
      return;
    }

    const resolved = await commPostalStorage.getCommPostalByLobLetterId(letterId);
    if (!resolved) {
      res.status(200).send('OK');
      return;
    }
    await handleStatusCallback(req, res, resolved.comm.id);
  } catch (error) {
    storageLogger.error('Lob static status callback failed', {
      module: 'comm-status',
      operation: 'resolveLobCallback',
      description: error instanceof Error ? error.message : String(error),
    });
    if (!res.headersSent) res.status(500).send('Internal Server Error');
  }
}
