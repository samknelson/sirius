import { z } from "zod";

export type AlertMedium = "sms" | "email" | "inapp";

export interface StaffAlertRecipient {
  userId: string;
  media: AlertMedium[];
}

export interface StaffAlertConfig {
  recipients: StaffAlertRecipient[];
}

export const staffAlertRecipientSchema = z.object({
  userId: z.string(),
  media: z.array(z.enum(["sms", "email", "inapp"])),
});

export const staffAlertConfigSchema = z.object({
  recipients: z.array(staffAlertRecipientSchema),
});

export type InsertStaffAlertRecipient = z.infer<typeof staffAlertRecipientSchema>;
export type InsertStaffAlertConfig = z.infer<typeof staffAlertConfigSchema>;
