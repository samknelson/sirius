import type { Express, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db } from "../db";
import { winstonLogs } from "@shared/schema";
import { eq, and, gte, lte, desc, or } from "drizzle-orm";
import { createCommStorage, createCommSmsOptinStorage, createCommEmailOptinStorage, createCommPostalOptinStorage } from "../storage";
import { sendSms } from "../services/sms-sender";
import { sendEmail } from "../services/email-sender";
import { handleStatusCallback } from "../services/comm-status/handler";
import { serviceRegistry } from "../services/service-registry";
import type { PostalTransport, PostalAddress } from "../services/providers/postal";

type AuthMiddleware = (req: Request, res: Response, next: NextFunction) => void | Promise<any>;
type PermissionMiddleware = (permissionKey: string) => (req: Request, res: Response, next: NextFunction) => void | Promise<any>;
type PolicyMiddleware = (policy: any) => (req: Request, res: Response, next: NextFunction) => void | Promise<any>;

const commStorage = createCommStorage();
const smsOptinStorage = createCommSmsOptinStorage();
const emailOptinStorage = createCommEmailOptinStorage();
const postalOptinStorage = createCommPostalOptinStorage();

const sendSmsSchema = z.object({
  phoneNumber: z.string().min(1, "Phone number is required"),
  message: z.string().min(1, "Message is required").max(1600, "Message too long (max 1600 characters)"),
});

const sendEmailSchema = z.object({
  email: z.string().email("Invalid email address"),
  name: z.string().optional(),
  subject: z.string().min(1, "Subject is required").max(500, "Subject too long"),
  bodyText: z.string().optional(),
  bodyHtml: z.string().optional(),
  replyTo: z.string().email().optional(),
}).refine(data => data.bodyText || data.bodyHtml, {
  message: "Either bodyText or bodyHtml is required",
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
      const records = await commStorage.getCommsByContactWithDetails(contactId);
      res.json(records);
    } catch (error) {
      console.error("Failed to fetch comm records:", error);
      res.status(500).json({ message: "Failed to fetch communication records" });
    }
  });

  app.get("/api/comm/:id", requireAuth, requirePermission("workers.view"), async (req, res) => {
    try {
      const { id } = req.params;
      const record = await commStorage.getCommWithDetails(id);
      
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
        messageId: result.messageId,
      });

    } catch (error) {
      console.error("Failed to send SMS:", error);
      res.status(500).json({ message: "Failed to send SMS" });
    }
  });

  app.post("/api/contacts/:contactId/email", requireAuth, requirePermission("workers.manage"), async (req, res) => {
    try {
      const { contactId } = req.params;
      
      const parsed = sendEmailSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ 
          message: "Invalid request body", 
          errors: parsed.error.flatten() 
        });
      }

      const { email, name, subject, bodyText, bodyHtml, replyTo } = parsed.data;
      const user = (req as any).user;

      const result = await sendEmail({
        contactId,
        toEmail: email,
        toName: name,
        subject,
        bodyText,
        bodyHtml,
        replyTo,
        userId: user?.id,
      });

      if (!result.success) {
        const statusCode = result.errorCode === 'VALIDATION_ERROR' 
          ? 400 
          : 500;
        
        return res.status(statusCode).json({
          message: result.error,
          errorCode: result.errorCode,
          comm: result.comm,
          commEmail: result.commEmail,
        });
      }

      res.status(201).json({
        message: "Email sent successfully",
        comm: result.comm,
        commEmail: result.commEmail,
        messageId: result.messageId,
      });

    } catch (error) {
      console.error("Failed to send email:", error);
      res.status(500).json({ message: "Failed to send email" });
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

  app.post("/api/comm/statuscallback/:commId", async (req, res) => {
    const { commId } = req.params;
    await handleStatusCallback(req, res, commId);
  });

  app.get("/api/comm/:id/logs", requireAuth, requirePermission("workers.view"), async (req, res) => {
    try {
      const { id } = req.params;
      const { module, operation, startDate, endDate } = req.query;

      const record = await commStorage.getCommWithDetails(id);
      if (!record) {
        return res.status(404).json({ message: "Communication record not found" });
      }

      const conditions = [
        or(
          eq(winstonLogs.entityId, id),
          eq(winstonLogs.hostEntityId, id)
        )
      ];
      
      if (module && typeof module === 'string') {
        conditions.push(eq(winstonLogs.module, module));
      }
      if (operation && typeof operation === 'string') {
        conditions.push(eq(winstonLogs.operation, operation));
      }
      if (startDate && typeof startDate === 'string') {
        conditions.push(gte(winstonLogs.timestamp, new Date(startDate)));
      }
      if (endDate && typeof endDate === 'string') {
        conditions.push(lte(winstonLogs.timestamp, new Date(endDate)));
      }

      const logs = await db
        .select()
        .from(winstonLogs)
        .where(and(...conditions))
        .orderBy(desc(winstonLogs.timestamp));

      res.json(logs);
    } catch (error) {
      console.error("Failed to fetch comm logs:", error);
      res.status(500).json({ message: "Failed to fetch communication logs" });
    }
  });

  const updateEmailOptinSchema = z.object({
    optin: z.boolean().optional(),
    allowlist: z.boolean().optional(),
  }).refine(data => data.optin !== undefined || data.allowlist !== undefined, {
    message: "At least one of optin or allowlist must be provided",
  });

  app.get("/api/email-optin/:email", requireAuth, requirePermission("workers.view"), async (req, res) => {
    try {
      const { email } = req.params;
      const optin = await emailOptinStorage.getEmailOptinByEmail(email);
      
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
      console.error("Failed to fetch email opt-in status:", error);
      res.status(500).json({ message: "Failed to fetch email opt-in status" });
    }
  });

  app.put("/api/email-optin/:email", requireAuth, requirePermission("workers.manage"), async (req, res) => {
    try {
      const { email } = req.params;
      
      const parsed = updateEmailOptinSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid request body", errors: parsed.error.flatten() });
      }
      
      const { optin, allowlist } = parsed.data;
      const user = (req as any).user;
      
      const clientIp = req.headers['x-forwarded-for'] as string || req.socket.remoteAddress || 'unknown';
      const ip = clientIp.split(',')[0].trim();
      
      const existingOptin = await emailOptinStorage.getEmailOptinByEmail(email);
      
      if (existingOptin) {
        const updateData: any = {};
        
        if (optin !== undefined) {
          updateData.optin = optin;
          if (optin) {
            updateData.optinUser = user?.id || null;
            updateData.optinDate = new Date();
            updateData.optinIp = ip;
          }
        }
        
        if (allowlist !== undefined) {
          updateData.allowlist = allowlist;
        }
        
        const updated = await emailOptinStorage.updateEmailOptinByEmail(email, updateData);
        
        if (!updated) {
          return res.status(404).json({ message: "Failed to update email opt-in" });
        }
        
        res.json({ 
          exists: true, 
          optin: updated.optin, 
          allowlist: updated.allowlist,
          record: updated 
        });
      } else {
        const newOptin = await emailOptinStorage.createEmailOptin({
          email: email.trim().toLowerCase(),
          optin: optin ?? false,
          optinUser: optin ? (user?.id || null) : null,
          optinDate: optin ? new Date() : null,
          optinIp: optin ? ip : null,
          allowlist: allowlist ?? false,
        });
        
        res.status(201).json({ 
          exists: true, 
          optin: newOptin.optin, 
          allowlist: newOptin.allowlist,
          record: newOptin 
        });
      }
    } catch (error) {
      console.error("Failed to update email opt-in:", error);
      res.status(500).json({ message: "Failed to update email opt-in status" });
    }
  });

  const addressVerificationSchema = z.object({
    name: z.string().optional(),
    company: z.string().optional(),
    addressLine1: z.string().min(1, "Address line 1 is required"),
    addressLine2: z.string().optional(),
    city: z.string().min(1, "City is required"),
    state: z.string().min(1, "State is required"),
    zip: z.string().min(1, "ZIP code is required"),
    country: z.string().default('US'),
  });

  const updatePostalOptinSchema = z.object({
    optin: z.boolean().optional(),
    allowlist: z.boolean().optional(),
  }).refine(data => data.optin !== undefined || data.allowlist !== undefined, {
    message: "At least one of optin or allowlist must be provided",
  });

  app.post("/api/postal/verify-address", requireAuth, requirePermission("workers.manage"), async (req, res) => {
    try {
      const parsed = addressVerificationSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ 
          message: "Invalid address data", 
          errors: parsed.error.flatten() 
        });
      }

      let postalProvider: PostalTransport;
      try {
        postalProvider = await serviceRegistry.resolve<PostalTransport>('postal');
      } catch (error) {
        return res.status(503).json({ 
          message: "Postal service is not configured",
          errorCode: "SERVICE_UNAVAILABLE"
        });
      }

      const address: PostalAddress = parsed.data;
      const result = await postalProvider.verifyAddress(address);

      if (!result.valid) {
        return res.status(400).json({
          valid: false,
          deliverable: result.deliverable,
          error: result.error,
        });
      }

      res.json({
        valid: result.valid,
        deliverable: result.deliverable,
        canonicalAddress: result.canonicalAddress,
        normalizedAddress: result.normalizedAddress,
        deliverabilityAnalysis: result.deliverabilityAnalysis,
      });

    } catch (error) {
      console.error("Failed to verify address:", error);
      res.status(500).json({ message: "Failed to verify address" });
    }
  });

  app.get("/api/postal-optin/:canonicalAddress", requireAuth, requirePermission("workers.view"), async (req, res) => {
    try {
      const { canonicalAddress } = req.params;
      const decodedAddress = decodeURIComponent(canonicalAddress);
      const optin = await postalOptinStorage.getPostalOptinByCanonicalAddress(decodedAddress);
      
      if (!optin) {
        return res.json({ 
          exists: false, 
          optin: false, 
          allowlist: false,
          deliverable: null,
          record: null 
        });
      }
      
      res.json({ 
        exists: true, 
        optin: optin.optin, 
        allowlist: optin.allowlist,
        deliverable: optin.deliverable,
        record: optin 
      });
    } catch (error) {
      console.error("Failed to fetch postal opt-in status:", error);
      res.status(500).json({ message: "Failed to fetch postal opt-in status" });
    }
  });

  app.put("/api/postal-optin/:canonicalAddress", requireAuth, requirePermission("workers.manage"), async (req, res) => {
    try {
      const { canonicalAddress } = req.params;
      const decodedAddress = decodeURIComponent(canonicalAddress);
      
      const parsed = updatePostalOptinSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid request body", errors: parsed.error.flatten() });
      }
      
      const { optin, allowlist } = parsed.data;
      const user = (req as any).user;
      
      const clientIp = req.headers['x-forwarded-for'] as string || req.socket.remoteAddress || 'unknown';
      const ip = clientIp.split(',')[0].trim();
      
      const existingOptin = await postalOptinStorage.getPostalOptinByCanonicalAddress(decodedAddress);
      
      if (existingOptin) {
        const updateData: any = {};
        
        if (optin !== undefined) {
          updateData.optin = optin;
          if (optin) {
            updateData.optinUser = user?.id || null;
            updateData.optinDate = new Date();
            updateData.optinIp = ip;
          }
        }
        
        if (allowlist !== undefined) {
          updateData.allowlist = allowlist;
        }
        
        const updated = await postalOptinStorage.updatePostalOptinByCanonicalAddress(decodedAddress, updateData);
        
        if (!updated) {
          return res.status(404).json({ message: "Failed to update postal opt-in" });
        }
        
        res.json({ 
          exists: true, 
          optin: updated.optin, 
          allowlist: updated.allowlist,
          deliverable: updated.deliverable,
          record: updated 
        });
      } else {
        return res.status(404).json({ 
          message: "Postal address not found. Please verify the address first using /api/postal/verify-address" 
        });
      }
    } catch (error) {
      console.error("Failed to update postal opt-in:", error);
      res.status(500).json({ message: "Failed to update postal opt-in status" });
    }
  });

  app.post("/api/postal/verify-and-register", requireAuth, requirePermission("workers.manage"), async (req, res) => {
    try {
      const parsed = addressVerificationSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ 
          message: "Invalid address data", 
          errors: parsed.error.flatten() 
        });
      }

      let postalProvider: PostalTransport;
      try {
        postalProvider = await serviceRegistry.resolve<PostalTransport>('postal');
      } catch (error) {
        return res.status(503).json({ 
          message: "Postal service is not configured",
          errorCode: "SERVICE_UNAVAILABLE"
        });
      }

      const address: PostalAddress = parsed.data;
      const result = await postalProvider.verifyAddress(address);

      if (!result.valid || !result.canonicalAddress) {
        return res.status(400).json({
          valid: false,
          deliverable: result.deliverable,
          error: result.error || "Address could not be verified",
        });
      }

      const existingOptin = await postalOptinStorage.getPostalOptinByCanonicalAddress(result.canonicalAddress);
      
      if (existingOptin) {
        const updated = await postalOptinStorage.updatePostalOptinByCanonicalAddress(result.canonicalAddress, {
          deliverable: result.deliverable,
          deliverabilityAnalysis: result.deliverabilityAnalysis as Record<string, unknown>,
          validatedAt: new Date(),
          validationResponse: result as unknown as Record<string, unknown>,
        });
        
        res.json({
          valid: true,
          deliverable: result.deliverable,
          canonicalAddress: result.canonicalAddress,
          normalizedAddress: result.normalizedAddress,
          deliverabilityAnalysis: result.deliverabilityAnalysis,
          optinRecord: updated,
          created: false,
        });
      } else {
        const normalized = result.normalizedAddress || address;
        const newOptin = await postalOptinStorage.createPostalOptin({
          canonicalAddress: result.canonicalAddress,
          addressLine1: normalized.addressLine1,
          addressLine2: normalized.addressLine2 || null,
          city: normalized.city,
          state: normalized.state,
          zip: normalized.zip,
          country: normalized.country || 'US',
          optin: false,
          allowlist: false,
          deliverable: result.deliverable,
          deliverabilityAnalysis: result.deliverabilityAnalysis as Record<string, unknown>,
          validatedAt: new Date(),
          validationResponse: result as unknown as Record<string, unknown>,
        });
        
        res.status(201).json({
          valid: true,
          deliverable: result.deliverable,
          canonicalAddress: result.canonicalAddress,
          normalizedAddress: result.normalizedAddress,
          deliverabilityAnalysis: result.deliverabilityAnalysis,
          optinRecord: newOptin,
          created: true,
        });
      }
    } catch (error) {
      console.error("Failed to verify and register address:", error);
      res.status(500).json({ message: "Failed to verify and register address" });
    }
  });

  app.get("/api/postal-optins", requireAuth, requirePermission("admin.access"), async (req, res) => {
    try {
      const optins = await postalOptinStorage.getAllPostalOptins();
      res.json(optins);
    } catch (error) {
      console.error("Failed to fetch postal opt-ins:", error);
      res.status(500).json({ message: "Failed to fetch postal opt-ins" });
    }
  });
}
