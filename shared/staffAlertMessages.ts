import { z } from "zod";

export const smsMessageSchema = z.object({
  text: z.string().min(1, "SMS text is required").max(1600, "SMS text must be 1600 characters or less"),
});

export const emailMessageSchema = z.object({
  subject: z.string().min(1, "Email subject is required").max(200, "Email subject must be 200 characters or less"),
  bodyText: z.string().min(1, "Email body text is required"),
  bodyHtml: z.string().optional(),
});

export const inappMessageSchema = z.object({
  title: z.string().min(1, "In-app title is required").max(100, "In-app title must be 100 characters or less"),
  body: z.string().min(1, "In-app body is required").max(500, "In-app body must be 500 characters or less"),
  linkUrl: z.string().max(2048).optional(),
  linkLabel: z.string().max(50).optional(),
});

export const staffAlertMessagePayloadSchema = z.object({
  sms: smsMessageSchema.optional(),
  email: emailMessageSchema.optional(),
  inapp: inappMessageSchema.optional(),
});

export type SmsMessage = z.infer<typeof smsMessageSchema>;
export type EmailMessage = z.infer<typeof emailMessageSchema>;
export type InappMessage = z.infer<typeof inappMessageSchema>;
export type StaffAlertMessagePayload = z.infer<typeof staffAlertMessagePayloadSchema>;

export interface StaffAlertSendOptions {
  triggeredByUserId?: string;
  metadata?: Record<string, unknown>;
}

export type AlertDeliveryStatus = 'success' | 'failed' | 'skipped';

export interface AlertDeliveryResult {
  userId: string;
  medium: 'sms' | 'email' | 'inapp';
  status: AlertDeliveryStatus;
  error?: string;
  errorCode?: string;
}

export interface StaffAlertSendResult {
  context: string;
  totalRecipients: number;
  deliveryResults: AlertDeliveryResult[];
  summary: {
    sms: { attempted: number; succeeded: number; failed: number; skipped: number };
    email: { attempted: number; succeeded: number; failed: number; skipped: number };
    inapp: { attempted: number; succeeded: number; failed: number; skipped: number };
  };
}
