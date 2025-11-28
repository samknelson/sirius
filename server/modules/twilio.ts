import type { Express, Request, Response } from "express";
import { clearTwilioCredentialsCache } from "../lib/twilio-client";
import { requireAccess } from "../accessControl";
import { policies } from "../policies";
import { z } from "zod";
import {
  getTwilioAccountInfo,
  testTwilioConnection,
  listTwilioPhoneNumbers,
  setDefaultPhoneNumber,
  getTwilioConfig,
  getDefaultTwilioPhoneNumber,
} from "../services/twilio-config";

export function registerTwilioRoutes(app: Express) {
  app.get(
    "/api/config/twilio",
    requireAccess(policies.admin),
    async (req: Request, res: Response) => {
      try {
        const info = await getTwilioAccountInfo();
        res.json(info);
      } catch (error: any) {
        res.status(500).json({ 
          message: "Failed to get Twilio configuration",
          error: error?.message 
        });
      }
    }
  );

  app.post(
    "/api/config/twilio/test",
    requireAccess(policies.admin),
    async (req: Request, res: Response) => {
      try {
        clearTwilioCredentialsCache();
        const result = await testTwilioConnection();
        res.json(result);
      } catch (error: any) {
        res.json({
          success: false,
          error: error?.message || "Failed to connect to Twilio",
        });
      }
    }
  );

  app.get(
    "/api/config/twilio/phone-numbers",
    requireAccess(policies.admin),
    async (req: Request, res: Response) => {
      try {
        const phoneNumbers = await listTwilioPhoneNumbers();
        res.json(phoneNumbers);
      } catch (error: any) {
        res.status(500).json({ 
          message: "Failed to fetch phone numbers from Twilio",
          error: error?.message 
        });
      }
    }
  );

  app.put(
    "/api/config/twilio/default-phone",
    requireAccess(policies.admin),
    async (req: Request, res: Response) => {
      try {
        const schema = z.object({
          phoneNumber: z.string().min(1),
        });
        
        const { phoneNumber } = schema.parse(req.body);
        await setDefaultPhoneNumber(phoneNumber);
        
        res.json({ success: true, defaultPhoneNumber: phoneNumber });
      } catch (error: any) {
        if (error instanceof z.ZodError) {
          return res.status(400).json({ message: "Invalid request", errors: error.errors });
        }
        res.status(500).json({ 
          message: "Failed to update default phone number",
          error: error?.message 
        });
      }
    }
  );

  app.get(
    "/api/config/twilio/default-phone",
    requireAccess(policies.admin),
    async (req: Request, res: Response) => {
      try {
        const config = await getTwilioConfig();
        const defaultNumber = await getDefaultTwilioPhoneNumber().catch(() => undefined);
        
        res.json({ 
          defaultPhoneNumber: config.defaultPhoneNumber || defaultNumber,
          source: config.defaultPhoneNumber ? 'database' : 'environment'
        });
      } catch (error: any) {
        res.status(500).json({ 
          message: "Failed to get default phone number",
          error: error?.message 
        });
      }
    }
  );
}
