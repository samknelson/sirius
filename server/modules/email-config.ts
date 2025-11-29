import type { Express, Request, Response } from "express";
import { requireAccess } from "../accessControl";
import { policies } from "../policies";
import { z } from "zod";
import { serviceRegistry } from "../services/service-registry";
import type { EmailTransport } from "../services/providers/email";

export function registerEmailConfigRoutes(app: Express) {
  app.get(
    "/api/config/email",
    requireAccess(policies.admin),
    async (req: Request, res: Response) => {
      try {
        const config = await serviceRegistry.getCategoryConfig('email');
        const providers = await serviceRegistry.getProviderInfo('email');
        
        const emailTransport = await serviceRegistry.resolve<EmailTransport>('email');
        const providerConfig = await emailTransport.getConfiguration();
        const connectionTest = await emailTransport.testConnection();
        
        res.json({
          defaultProvider: config.defaultProvider,
          providers,
          currentProvider: {
            id: emailTransport.id,
            displayName: emailTransport.displayName,
            supportedFeatures: emailTransport.supportedFeatures,
            supportsEmail: emailTransport.supportsEmail(),
            config: providerConfig,
            connection: connectionTest,
          },
        });
      } catch (error: any) {
        res.status(500).json({ 
          message: "Failed to get email configuration",
          error: error?.message 
        });
      }
    }
  );

  app.post(
    "/api/config/email/test",
    requireAccess(policies.admin),
    async (req: Request, res: Response) => {
      try {
        serviceRegistry.invalidateCache('email');
        const emailTransport = await serviceRegistry.resolve<EmailTransport>('email');
        const result = await emailTransport.testConnection();
        
        if (!result.success) {
          return res.status(500).json(result);
        }
        
        res.json(result);
      } catch (error: any) {
        res.status(500).json({
          success: false,
          error: error?.message || "Failed to connect to email provider",
        });
      }
    }
  );

  app.put(
    "/api/config/email/provider",
    requireAccess(policies.admin),
    async (req: Request, res: Response) => {
      try {
        const schema = z.object({
          providerId: z.string().min(1),
        });
        
        const { providerId } = schema.parse(req.body);
        await serviceRegistry.setDefaultProvider('email', providerId);
        
        res.json({ success: true, defaultProvider: providerId });
      } catch (error: any) {
        if (error instanceof z.ZodError) {
          return res.status(400).json({ message: "Invalid request", errors: error.errors });
        }
        res.status(500).json({ 
          message: "Failed to update email provider",
          error: error?.message 
        });
      }
    }
  );

  app.get(
    "/api/config/email/default-from",
    requireAccess(policies.admin),
    async (req: Request, res: Response) => {
      try {
        const emailTransport = await serviceRegistry.resolve<EmailTransport>('email');
        const defaultFrom = await emailTransport.getDefaultFromAddress();
        
        res.json({ 
          defaultFromEmail: defaultFrom?.email,
          defaultFromName: defaultFrom?.name,
        });
      } catch (error: any) {
        res.status(500).json({ 
          message: "Failed to get default from address",
          error: error?.message 
        });
      }
    }
  );

  app.put(
    "/api/config/email/default-from",
    requireAccess(policies.admin),
    async (req: Request, res: Response) => {
      try {
        const schema = z.object({
          email: z.string().email(),
          name: z.string().optional(),
        });
        
        const { email, name } = schema.parse(req.body);
        
        const config = await serviceRegistry.getCategoryConfig('email');
        const providerId = config.defaultProvider || 'sendgrid';
        
        const settings = await serviceRegistry.getProviderSettings('email', providerId);
        await serviceRegistry.saveProviderSettings('email', providerId, {
          ...settings,
          defaultFromEmail: email,
          defaultFromName: name,
        });
        
        serviceRegistry.invalidateCache('email');
        
        res.json({ success: true, defaultFromEmail: email, defaultFromName: name });
      } catch (error: any) {
        if (error instanceof z.ZodError) {
          return res.status(400).json({ message: "Invalid request", errors: error.errors });
        }
        res.status(500).json({ 
          message: "Failed to update default from address",
          error: error?.message 
        });
      }
    }
  );

  app.get(
    "/api/config/sendgrid",
    requireAccess(policies.admin),
    async (req: Request, res: Response) => {
      try {
        const emailTransport = await serviceRegistry.resolve<EmailTransport>('email');
        
        if (emailTransport.id !== 'sendgrid') {
          return res.json({
            connected: false,
            error: 'SendGrid is not the active email provider',
            currentProvider: emailTransport.id,
          });
        }
        
        const providerConfig = await emailTransport.getConfiguration();
        const defaultFrom = await emailTransport.getDefaultFromAddress();
        
        res.json({
          connected: providerConfig.connected || false,
          apiKeyConfigured: providerConfig.apiKeyConfigured || false,
          defaultFromEmail: defaultFrom?.email,
          defaultFromName: defaultFrom?.name,
          error: providerConfig.error,
        });
      } catch (error: any) {
        res.status(500).json({ 
          message: "Failed to get SendGrid configuration",
          error: error?.message 
        });
      }
    }
  );

  app.post(
    "/api/config/sendgrid/test",
    requireAccess(policies.admin),
    async (req: Request, res: Response) => {
      try {
        serviceRegistry.invalidateCache('email');
        const emailTransport = await serviceRegistry.resolve<EmailTransport>('email');
        
        if (emailTransport.id !== 'sendgrid') {
          return res.json({
            success: false,
            error: 'SendGrid is not the active email provider',
          });
        }
        
        const result = await emailTransport.testConnection();
        
        res.json({
          success: result.success,
          message: result.message,
          error: result.error,
          details: result.details,
        });
      } catch (error: any) {
        res.json({
          success: false,
          error: error?.message || "Failed to connect to SendGrid",
        });
      }
    }
  );
}
