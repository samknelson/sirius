import type { Express, Request, Response } from "express";
import { requireAccess } from "../accessControl";
import { z } from "zod";
import { serviceRegistry } from "../services/service-registry";
import type { SmsTransport } from "../services/providers/sms";

export function registerTwilioRoutes(app: Express) {
  app.get(
    "/api/config/sms",
    requireAccess('admin'),
    async (req: Request, res: Response) => {
      try {
        const config = await serviceRegistry.getCategoryConfig('sms');
        const providers = await serviceRegistry.getProviderInfo('sms');
        
        const smsTransport = await serviceRegistry.resolve<SmsTransport>('sms');
        const providerConfig = await smsTransport.getConfiguration();
        const connectionTest = await smsTransport.testConnection();
        
        res.json({
          defaultProvider: config.defaultProvider,
          providers,
          currentProvider: {
            id: smsTransport.id,
            displayName: smsTransport.displayName,
            supportedFeatures: smsTransport.supportedFeatures,
            supportsSms: smsTransport.supportsSms(),
            config: providerConfig,
            connection: connectionTest,
          },
        });
      } catch (error: any) {
        res.status(500).json({ 
          message: "Failed to get SMS configuration",
          error: error?.message 
        });
      }
    }
  );

  app.post(
    "/api/config/sms/test",
    requireAccess('admin'),
    async (req: Request, res: Response) => {
      try {
        serviceRegistry.invalidateCache('sms');
        const smsTransport = await serviceRegistry.resolve<SmsTransport>('sms');
        const result = await smsTransport.testConnection();
        res.json(result);
      } catch (error: any) {
        res.json({
          success: false,
          error: error?.message || "Failed to connect to SMS provider",
        });
      }
    }
  );

  app.put(
    "/api/config/sms/provider",
    requireAccess('admin'),
    async (req: Request, res: Response) => {
      try {
        const schema = z.object({
          providerId: z.string().min(1),
        });
        
        const { providerId } = schema.parse(req.body);
        await serviceRegistry.setDefaultProvider('sms', providerId);
        
        res.json({ success: true, defaultProvider: providerId });
      } catch (error: any) {
        if (error instanceof z.ZodError) {
          return res.status(400).json({ message: "Invalid request", errors: error.errors });
        }
        res.status(500).json({ 
          message: "Failed to update SMS provider",
          error: error?.message 
        });
      }
    }
  );

  app.get(
    "/api/config/sms/phone-numbers",
    requireAccess('admin'),
    async (req: Request, res: Response) => {
      try {
        const smsTransport = await serviceRegistry.resolve<SmsTransport>('sms');
        
        if (!smsTransport.getAvailablePhoneNumbers) {
          return res.json([]);
        }
        
        const phoneNumbers = await smsTransport.getAvailablePhoneNumbers();
        res.json(phoneNumbers);
      } catch (error: any) {
        res.status(500).json({ 
          message: "Failed to fetch phone numbers",
          error: error?.message 
        });
      }
    }
  );

  app.put(
    "/api/config/sms/default-phone",
    requireAccess('admin'),
    async (req: Request, res: Response) => {
      try {
        const schema = z.object({
          phoneNumber: z.string().min(1),
        });
        
        const { phoneNumber } = schema.parse(req.body);
        
        const config = await serviceRegistry.getCategoryConfig('sms');
        const providerId = config.defaultProvider || 'twilio';
        
        const settings = await serviceRegistry.getProviderSettings('sms', providerId);
        await serviceRegistry.saveProviderSettings('sms', providerId, {
          ...settings,
          defaultFromNumber: phoneNumber,
        });
        
        serviceRegistry.invalidateCache('sms');
        
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
    "/api/config/sms/default-phone",
    requireAccess('admin'),
    async (req: Request, res: Response) => {
      try {
        const smsTransport = await serviceRegistry.resolve<SmsTransport>('sms');
        const defaultNumber = await smsTransport.getDefaultFromNumber();
        
        res.json({ 
          defaultPhoneNumber: defaultNumber,
        });
      } catch (error: any) {
        res.status(500).json({ 
          message: "Failed to get default phone number",
          error: error?.message 
        });
      }
    }
  );

  app.get(
    "/api/config/twilio",
    requireAccess('admin'),
    async (req: Request, res: Response) => {
      try {
        const smsTransport = await serviceRegistry.resolve<SmsTransport>('sms');
        
        if (smsTransport.id !== 'twilio') {
          return res.json({
            connected: false,
            error: 'Twilio is not the active SMS provider',
            currentProvider: smsTransport.id,
          });
        }
        
        const providerConfig = await smsTransport.getConfiguration();
        const defaultFromNumber = await smsTransport.getDefaultFromNumber();
        
        res.json({
          connected: providerConfig.connected || false,
          accountSid: providerConfig.accountSid,
          accountName: providerConfig.accountName,
          configuredPhoneNumber: providerConfig.configuredPhoneNumber,
          defaultPhoneNumber: defaultFromNumber,
          error: providerConfig.error,
        });
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
    requireAccess('admin'),
    async (req: Request, res: Response) => {
      try {
        serviceRegistry.invalidateCache('sms');
        const smsTransport = await serviceRegistry.resolve<SmsTransport>('sms');
        
        if (smsTransport.id !== 'twilio') {
          return res.json({
            success: false,
            error: 'Twilio is not the active SMS provider',
          });
        }
        
        const result = await smsTransport.testConnection();
        
        res.json({
          success: result.success,
          accountSid: result.details?.accountSid,
          accountName: result.details?.accountName,
          status: result.details?.status,
          error: result.error,
        });
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
    requireAccess('admin'),
    async (req: Request, res: Response) => {
      try {
        const smsTransport = await serviceRegistry.resolve<SmsTransport>('sms');
        
        if (smsTransport.id !== 'twilio' || !smsTransport.getAvailablePhoneNumbers) {
          return res.json([]);
        }
        
        const phoneNumbers = await smsTransport.getAvailablePhoneNumbers();
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
    requireAccess('admin'),
    async (req: Request, res: Response) => {
      try {
        const schema = z.object({
          phoneNumber: z.string().min(1),
        });
        
        const { phoneNumber } = schema.parse(req.body);
        
        const settings = await serviceRegistry.getProviderSettings('sms', 'twilio');
        await serviceRegistry.saveProviderSettings('sms', 'twilio', {
          ...settings,
          defaultFromNumber: phoneNumber,
        });
        
        serviceRegistry.invalidateCache('sms');
        
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
    requireAccess('admin'),
    async (req: Request, res: Response) => {
      try {
        const smsTransport = await serviceRegistry.resolve<SmsTransport>('sms');
        const defaultNumber = await smsTransport.getDefaultFromNumber();
        
        res.json({ 
          defaultPhoneNumber: defaultNumber,
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
