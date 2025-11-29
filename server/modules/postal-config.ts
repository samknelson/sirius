import type { Express, Request, Response } from "express";
import { requireAccess } from "../accessControl";
import { policies } from "../policies";
import { z } from "zod";
import { serviceRegistry } from "../services/service-registry";
import type { PostalTransport, PostalAddress } from "../services/providers/postal";

export function registerPostalConfigRoutes(app: Express) {
  app.get(
    "/api/config/postal",
    requireAccess(policies.admin),
    async (req: Request, res: Response) => {
      try {
        const config = await serviceRegistry.getCategoryConfig('postal');
        const providers = await serviceRegistry.getProviderInfo('postal');
        
        const postalTransport = await serviceRegistry.resolve<PostalTransport>('postal');
        const providerConfig = await postalTransport.getConfiguration();
        const connectionTest = await postalTransport.testConnection();
        
        res.json({
          defaultProvider: config.defaultProvider,
          providers,
          currentProvider: {
            id: postalTransport.id,
            displayName: postalTransport.displayName,
            supportedFeatures: postalTransport.supportedFeatures,
            supportsPostal: postalTransport.supportsPostal(),
            config: providerConfig,
            connection: connectionTest,
          },
        });
      } catch (error: any) {
        res.status(500).json({ 
          message: "Failed to get postal configuration",
          error: error?.message 
        });
      }
    }
  );

  app.post(
    "/api/config/postal/test",
    requireAccess(policies.admin),
    async (req: Request, res: Response) => {
      try {
        serviceRegistry.invalidateCache('postal');
        const postalTransport = await serviceRegistry.resolve<PostalTransport>('postal');
        const result = await postalTransport.testConnection();
        
        if (!result.success) {
          return res.status(500).json(result);
        }
        
        res.json(result);
      } catch (error: any) {
        res.status(500).json({
          success: false,
          error: error?.message || "Failed to connect to postal provider",
        });
      }
    }
  );

  app.put(
    "/api/config/postal/provider",
    requireAccess(policies.admin),
    async (req: Request, res: Response) => {
      try {
        const schema = z.object({
          providerId: z.string().min(1),
        });
        
        const { providerId } = schema.parse(req.body);
        await serviceRegistry.setDefaultProvider('postal', providerId);
        
        res.json({ success: true, defaultProvider: providerId });
      } catch (error: any) {
        if (error instanceof z.ZodError) {
          return res.status(400).json({ message: "Invalid request", errors: error.errors });
        }
        res.status(500).json({ 
          message: "Failed to update postal provider",
          error: error?.message 
        });
      }
    }
  );

  app.get(
    "/api/config/postal/return-address",
    requireAccess(policies.admin),
    async (req: Request, res: Response) => {
      try {
        const postalTransport = await serviceRegistry.resolve<PostalTransport>('postal');
        const returnAddress = await postalTransport.getDefaultReturnAddress();
        
        res.json({ 
          returnAddress,
        });
      } catch (error: any) {
        res.status(500).json({ 
          message: "Failed to get default return address",
          error: error?.message 
        });
      }
    }
  );

  app.put(
    "/api/config/postal/return-address",
    requireAccess(policies.admin),
    async (req: Request, res: Response) => {
      try {
        const schema = z.object({
          name: z.string().optional(),
          company: z.string().optional(),
          addressLine1: z.string().min(1),
          addressLine2: z.string().optional(),
          city: z.string().min(1),
          state: z.string().min(1),
          zip: z.string().min(1),
          country: z.string().default("US"),
        });
        
        const address = schema.parse(req.body) as PostalAddress;
        
        const config = await serviceRegistry.getCategoryConfig('postal');
        const providerId = config.defaultProvider || 'lob';
        
        const settings = await serviceRegistry.getProviderSettings('postal', providerId);
        await serviceRegistry.saveProviderSettings('postal', providerId, {
          ...settings,
          defaultReturnAddress: address,
        });
        
        serviceRegistry.invalidateCache('postal');
        
        res.json({ success: true, returnAddress: address });
      } catch (error: any) {
        if (error instanceof z.ZodError) {
          return res.status(400).json({ message: "Invalid request", errors: error.errors });
        }
        res.status(500).json({ 
          message: "Failed to update default return address",
          error: error?.message 
        });
      }
    }
  );

  app.get(
    "/api/config/lob",
    requireAccess(policies.admin),
    async (req: Request, res: Response) => {
      try {
        const postalTransport = await serviceRegistry.resolve<PostalTransport>('postal');
        
        if (postalTransport.id !== 'lob') {
          return res.json({
            connected: false,
            error: 'Lob is not the active postal provider',
            currentProvider: postalTransport.id,
          });
        }
        
        const providerConfig = await postalTransport.getConfiguration();
        const returnAddress = await postalTransport.getDefaultReturnAddress();
        
        res.json({
          connected: providerConfig.connected || false,
          apiKeyConfigured: providerConfig.apiKeyConfigured || false,
          isTestMode: providerConfig.isTestMode || false,
          returnAddress,
          error: providerConfig.error,
        });
      } catch (error: any) {
        res.status(500).json({ 
          message: "Failed to get Lob configuration",
          error: error?.message 
        });
      }
    }
  );

  app.post(
    "/api/config/lob/test",
    requireAccess(policies.admin),
    async (req: Request, res: Response) => {
      try {
        serviceRegistry.invalidateCache('postal');
        const postalTransport = await serviceRegistry.resolve<PostalTransport>('postal');
        
        if (postalTransport.id !== 'lob') {
          return res.json({
            success: false,
            error: 'Lob is not the active postal provider',
          });
        }
        
        const result = await postalTransport.testConnection();
        
        res.json({
          success: result.success,
          message: result.message,
          error: result.error,
          details: result.details,
        });
      } catch (error: any) {
        res.json({
          success: false,
          error: error?.message || "Failed to connect to Lob",
        });
      }
    }
  );

  app.post(
    "/api/config/postal/verify-test-address",
    requireAccess(policies.admin),
    async (req: Request, res: Response) => {
      try {
        const schema = z.object({
          addressLine1: z.string().min(1),
          addressLine2: z.string().optional(),
          city: z.string().min(1),
          state: z.string().min(1),
          zip: z.string().min(1),
          country: z.string().default("US"),
        });
        
        const addressInput = schema.parse(req.body);
        const address = {
          ...addressInput,
          addressLine1: addressInput.addressLine1,
        };
        
        const postalTransport = await serviceRegistry.resolve<PostalTransport>('postal');
        const result = await postalTransport.verifyAddress(address);
        
        res.json(result);
      } catch (error: any) {
        if (error instanceof z.ZodError) {
          return res.status(400).json({ message: "Invalid address", errors: error.errors });
        }
        res.status(500).json({ 
          message: "Failed to verify address",
          error: error?.message 
        });
      }
    }
  );
}
