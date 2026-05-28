import type { ServiceProvider, ConnectionTestResult } from '../base';

export interface EmailValidationResult {
  valid: boolean;
  formatted?: string;
  error?: string;
}

export interface EmailSendResult {
  success: boolean;
  messageId?: string;
  status?: string;
  error?: string;
  details?: Record<string, unknown>;
}

export interface EmailRecipient {
  email: string;
  name?: string;
}

export interface EmailAttachment {
  filename: string;
  content: string;
  type: string;
  disposition?: 'attachment' | 'inline';
  contentId?: string;
}

export interface SendEmailParams {
  to: EmailRecipient | EmailRecipient[];
  from?: EmailRecipient;
  replyTo?: EmailRecipient;
  subject: string;
  text?: string;
  html?: string;
  cc?: EmailRecipient[];
  bcc?: EmailRecipient[];
  attachments?: EmailAttachment[];
  statusCallbackUrl?: string;
}

export interface EmailTransport extends ServiceProvider {
  readonly category: 'email';
  
  validateEmail(email: string): Promise<EmailValidationResult>;
  
  sendEmail(params: SendEmailParams): Promise<EmailSendResult>;
  
  supportsEmail(): boolean;
  
  getDefaultFromAddress(): Promise<EmailRecipient | undefined>;
  setDefaultFromAddress?(email: EmailRecipient): Promise<void>;
}

export interface EmailProviderSettings {
  defaultFromEmail?: string;
  defaultFromName?: string;
  [key: string]: unknown;
}
