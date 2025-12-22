import { createCommStorage, createCommInappStorage } from '../storage/comm';
import { notifyAlertCountChange } from '../modules/comm';
import type { Comm, CommInapp } from '@shared/schema';
import { storageLogger } from '../logger';

export interface SendInappRequest {
  contactId: string;
  userId: string;
  title: string;
  body: string;
  linkUrl?: string;
  linkLabel?: string;
  initiatedBy?: string;
}

export interface SendInappResult {
  success: boolean;
  comm?: Comm;
  commInapp?: CommInapp;
  error?: string;
  errorCode?: 'VALIDATION_ERROR' | 'STORAGE_ERROR' | 'UNKNOWN_ERROR';
}

export interface MarkAsReadResult {
  success: boolean;
  commInapp?: CommInapp;
  error?: string;
  errorCode?: 'NOT_FOUND' | 'ALREADY_READ' | 'STORAGE_ERROR' | 'UNKNOWN_ERROR';
}

const commStorage = createCommStorage();
const commInappStorage = createCommInappStorage();

export async function sendInapp(request: SendInappRequest): Promise<SendInappResult> {
  const { contactId, userId, title, body, linkUrl, linkLabel, initiatedBy } = request;

  try {
    if (!contactId) {
      return {
        success: false,
        error: 'Contact ID is required',
        errorCode: 'VALIDATION_ERROR',
      };
    }

    if (!userId) {
      return {
        success: false,
        error: 'User ID is required for in-app messages',
        errorCode: 'VALIDATION_ERROR',
      };
    }

    if (!title || title.trim().length === 0) {
      return {
        success: false,
        error: 'Title is required',
        errorCode: 'VALIDATION_ERROR',
      };
    }

    if (!body || body.trim().length === 0) {
      return {
        success: false,
        error: 'Body is required',
        errorCode: 'VALIDATION_ERROR',
      };
    }

    if (title.length > 100) {
      return {
        success: false,
        error: 'Title must be 100 characters or less',
        errorCode: 'VALIDATION_ERROR',
      };
    }

    if (body.length > 500) {
      return {
        success: false,
        error: 'Body must be 500 characters or less',
        errorCode: 'VALIDATION_ERROR',
      };
    }

    const comm = await commStorage.createComm({
      medium: 'inapp',
      contactId,
      status: 'sent',
      sent: new Date(),
      data: { initiatedBy: initiatedBy || 'system' },
    });

    let commInappRecord: CommInapp;
    try {
      commInappRecord = await commInappStorage.createCommInapp({
        commId: comm.id,
        userId,
        title: title.trim(),
        body: body.trim(),
        linkUrl: linkUrl || null,
        linkLabel: linkLabel || null,
        status: 'pending',
      });
    } catch (inappError: any) {
      await commStorage.updateComm(comm.id, {
        status: 'failed',
        data: {
          ...comm.data as object,
          errorCode: 'STORAGE_ERROR',
          errorMessage: inappError?.message || 'Failed to create in-app message record',
        },
      });

      return {
        success: false,
        comm: { ...comm, status: 'failed' },
        error: inappError?.message || 'Failed to create in-app message record',
        errorCode: 'STORAGE_ERROR',
      };
    }

    setImmediate(() => notifyAlertCountChange(userId));

    return {
      success: true,
      comm,
      commInapp: commInappRecord,
    };

  } catch (error: any) {
    console.error('In-app message sending error:', error);
    return {
      success: false,
      error: error?.message || 'Unknown error occurred while sending in-app message',
      errorCode: 'UNKNOWN_ERROR',
    };
  }
}

export async function markInappAsRead(alertId: string, userId: string): Promise<MarkAsReadResult> {
  try {
    const existing = await commInappStorage.getCommInapp(alertId);
    
    if (!existing) {
      return {
        success: false,
        error: 'Alert not found',
        errorCode: 'NOT_FOUND',
      };
    }

    if (existing.userId !== userId) {
      return {
        success: false,
        error: 'Access denied',
        errorCode: 'NOT_FOUND',
      };
    }

    if (existing.status !== 'pending') {
      return {
        success: true,
        commInapp: existing,
      };
    }

    const updatedInapp = await commInappStorage.updateCommInapp(alertId, { status: 'read' });
    
    if (!updatedInapp) {
      return {
        success: false,
        error: 'Failed to update alert status',
        errorCode: 'STORAGE_ERROR',
      };
    }

    await commStorage.updateComm(existing.commId, { status: 'read' });

    storageLogger.info(`In-app alert marked as read: ${alertId}`, {
      module: 'comm-inapp',
      operation: 'markAsRead',
      entity_id: alertId,
      host_entity_id: existing.userId,
      description: `Alert "${existing.title}" status changed from "pending" to "read"`,
      meta: {
        medium: 'in-app',
        commId: existing.commId,
        title: existing.title,
      },
    });

    setImmediate(() => notifyAlertCountChange(userId));

    return {
      success: true,
      commInapp: updatedInapp,
    };

  } catch (error: any) {
    console.error('Failed to mark in-app alert as read:', error);
    return {
      success: false,
      error: error?.message || 'Unknown error occurred',
      errorCode: 'UNKNOWN_ERROR',
    };
  }
}

export async function markAllInappAsRead(userId: string): Promise<{ success: boolean; count: number; error?: string }> {
  try {
    const unreadAlerts = await commInappStorage.getCommInappsByUser(userId, 'pending');
    
    let successCount = 0;
    for (const alert of unreadAlerts) {
      const result = await markInappAsRead(alert.id, userId);
      if (result.success) {
        successCount++;
      }
    }

    return {
      success: true,
      count: successCount,
    };

  } catch (error: any) {
    console.error('Failed to mark all in-app alerts as read:', error);
    return {
      success: false,
      count: 0,
      error: error?.message || 'Unknown error occurred',
    };
  }
}
