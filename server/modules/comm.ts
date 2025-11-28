import type { Express, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { createCommStorage, createCommSmsOptinStorage } from "../storage";
import { sendSms, handleTwilioStatusCallback } from "../services/sms-sender";

type AuthMiddleware = (req: Request, res: Response, next: NextFunction) => void | Promise<any>;
type PermissionMiddleware = (permissionKey: string) => (req: Request, res: Response, next: NextFunction) => void | Promise<any>;
type PolicyMiddleware = (policy: any) => (req: Request, res: Response, next: NextFunction) => void | Promise<any>;

const commStorage = createCommStorage();
const smsOptinStorage = createCommSmsOptinStorage();

const sendSmsSchema = z.object({
  phoneNumber: z.string().min(1, "Phone number is required"),
  message: z.string().min(1, "Message is required").max(1600, "Message too long (max 1600 characters)"),
});

export function registerCommRoutes(
  app: Express, 
  requireAuth: AuthMiddleware, 
  requirePermission: PermissionMiddleware,
  requireAccess?: PolicyMiddleware
) {
  
  app.get("/api/contacts/:contactId/comm", requireAuth, requirePermission("workers.view"), async (req, res) => {
    try {
      const { contactId } = req.params;
      const records = await commStorage.getCommsByContactWithSms(contactId);
      res.json(records);
    } catch (error) {
      console.error("Failed to fetch comm records:", error);
      res.status(500).json({ message: "Failed to fetch communication records" });
    }
  });

  app.get("/api/comm/:id", requireAuth, requirePermission("workers.view"), async (req, res) => {
    try {
      const { id } = req.params;
      const record = await commStorage.getCommWithSms(id);
      
      if (!record) {
        return res.status(404).json({ message: "Communication record not found" });
      }
      
      res.json(record);
    } catch (error) {
      console.error("Failed to fetch comm record:", error);
      res.status(500).json({ message: "Failed to fetch communication record" });
    }
  });

  app.post("/api/contacts/:contactId/sms", requireAuth, requirePermission("workers.manage"), async (req, res) => {
    try {
      const { contactId } = req.params;
      
      const parsed = sendSmsSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ 
          message: "Invalid request body", 
          errors: parsed.error.flatten() 
        });
      }

      const { phoneNumber, message } = parsed.data;
      const user = (req as any).user;

      const result = await sendSms({
        contactId,
        toPhoneNumber: phoneNumber,
        message,
        userId: user?.id,
      });

      if (!result.success) {
        const statusCode = result.errorCode === 'NOT_OPTED_IN' || result.errorCode === 'NOT_ALLOWLISTED' 
          ? 403 
          : result.errorCode === 'VALIDATION_ERROR' 
            ? 400 
            : 500;
        
        return res.status(statusCode).json({
          message: result.error,
          errorCode: result.errorCode,
          comm: result.comm,
          commSms: result.commSms,
        });
      }

      res.status(201).json({
        message: "SMS sent successfully",
        comm: result.comm,
        commSms: result.commSms,
        twilioMessageSid: result.twilioMessageSid,
      });

    } catch (error) {
      console.error("Failed to send SMS:", error);
      res.status(500).json({ message: "Failed to send SMS" });
    }
  });

  app.get("/api/phone-numbers/:phoneNumber/sms-optin", requireAuth, requirePermission("workers.view"), async (req, res) => {
    try {
      const { phoneNumber } = req.params;
      const optin = await smsOptinStorage.getSmsOptinByPhoneNumber(phoneNumber);
      
      if (!optin) {
        return res.json({ 
          exists: false, 
          optin: false, 
          allowlist: false,
          record: null 
        });
      }
      
      res.json({ 
        exists: true, 
        optin: optin.optin, 
        allowlist: optin.allowlist,
        record: optin 
      });
    } catch (error) {
      console.error("Failed to fetch SMS opt-in status:", error);
      res.status(500).json({ message: "Failed to fetch SMS opt-in status" });
    }
  });

  app.post("/api/webhooks/twilio/sms-status", async (req, res) => {
    try {
      const { 
        MessageSid, 
        MessageStatus, 
        ErrorCode, 
        ErrorMessage,
        To,
        From 
      } = req.body;

      if (!MessageSid || !MessageStatus) {
        console.warn("Invalid Twilio webhook payload - missing MessageSid or MessageStatus");
        return res.status(400).send("Missing required fields");
      }

      console.log(`Twilio SMS status callback: ${MessageSid} -> ${MessageStatus}`, {
        errorCode: ErrorCode,
        errorMessage: ErrorMessage,
        to: To,
        from: From,
      });

      const result = await handleTwilioStatusCallback({
        MessageSid,
        MessageStatus,
        ErrorCode,
        ErrorMessage,
        To,
        From,
      });

      if (!result.success) {
        console.warn(`Failed to process Twilio callback for ${MessageSid}: ${result.error}`);
      }

      res.status(200).send("OK");

    } catch (error) {
      console.error("Error processing Twilio webhook:", error);
      res.status(500).send("Internal server error");
    }
  });
}
