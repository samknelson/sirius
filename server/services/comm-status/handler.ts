import type { Request, Response } from 'express';
import { TwilioStatusHandler } from './twilio';
import { SendGridStatusHandler } from './sendgrid';
import { LobStatusHandler } from './lob';
import type { CommStatusHandler, CommStatusUpdate } from './index';
import { createCommStorage, createCommSmsStorage, createCommEmailStorage, createCommPostalStorage } from '../../storage/comm';
import { storageLogger } from '../../logger';

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
    const comm = await commStorage.getCommWithDetails(commId);
    
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
    
    const previousStatus = comm.status;
    
    const existingData = comm.data as Record<string, unknown> || {};
    await commStorage.updateComm(commId, {
      status: statusUpdate.status,
      data: {
        ...existingData,
        lastProviderStatus: statusUpdate.providerStatus,
        lastStatusUpdate: statusUpdate.timestamp.toISOString(),
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
      const postalData = comm.postalDetails.data as Record<string, unknown> || {};
      const rawPayload = (statusUpdate.rawPayload || {}) as Record<string, unknown>;
      const eventBody = (rawPayload.body || {}) as Record<string, unknown>;
      
      const updatedPostalData: Record<string, unknown> = {
        ...postalData,
        providerStatus: statusUpdate.providerStatus,
        lastWebhookAt: statusUpdate.timestamp.toISOString(),
        lastWebhookPayload: rawPayload,
      };
      
      if (providerMessageId) updatedPostalData.letterId = providerMessageId;
      if (statusUpdate.errorCode) updatedPostalData.errorCode = statusUpdate.errorCode;
      if (statusUpdate.errorMessage) updatedPostalData.errorMessage = statusUpdate.errorMessage;
      if (eventBody.tracking_events) updatedPostalData.trackingEvents = eventBody.tracking_events;
      if (eventBody.expected_delivery_date) updatedPostalData.expectedDeliveryDate = eventBody.expected_delivery_date;
      if (eventBody.carrier) updatedPostalData.carrier = eventBody.carrier;
      if (eventBody.tracking_number) updatedPostalData.trackingNumber = eventBody.tracking_number;
      
      await commPostalStorage.updateCommPostal(comm.postalDetails.id, {
        data: updatedPostalData,
      });
    }

    storageLogger.info(`Comm status updated: ${commId}`, {
      module: 'comm-status',
      operation: 'statusCallback',
      entity_id: commId,
      host_entity_id: comm.contactId,
      description: `Status changed from "${previousStatus}" to "${statusUpdate.status}" (${providerId}: ${statusUpdate.providerStatus})`,
      meta: {
        medium: comm.medium,
        providerId,
        previousStatus,
        newStatus: statusUpdate.status,
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
