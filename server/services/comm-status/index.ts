import type { Request } from 'express';
import type { Comm } from '@shared/schema';

export interface CommStatusUpdate {
  status: 'queued' | 'sending' | 'sent' | 'delivered' | 'failed' | 'undelivered' | 'unknown';
  providerStatus: string;
  errorCode?: string;
  errorMessage?: string;
  timestamp: Date;
  rawPayload: Record<string, unknown>;
}

export interface CommStatusHandler {
  readonly providerId: string;
  readonly medium: 'sms' | 'email' | 'postal';
  
  validateRequest(req: Request): Promise<{ valid: boolean; error?: string }>;
  
  parseStatusUpdate(req: Request): CommStatusUpdate;
  
  getProviderMessageId(req: Request): string | undefined;
}

export { TwilioStatusHandler } from './twilio';

const handlers: Map<string, CommStatusHandler> = new Map();

export function registerStatusHandler(handler: CommStatusHandler): void {
  const key = `${handler.medium}:${handler.providerId}`;
  handlers.set(key, handler);
}

export function getStatusHandler(medium: string, providerId: string): CommStatusHandler | undefined {
  const key = `${medium}:${providerId}`;
  return handlers.get(key);
}

export function getAllHandlers(): CommStatusHandler[] {
  return Array.from(handlers.values());
}
