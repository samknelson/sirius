import type { Express, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { storage } from "../../storage";
import { insertWsBundleSchema, insertWsClientSchema, insertWsClientIpRuleSchema } from "@shared/schema";

type RequireAuth = (req: Request, res: Response, next: NextFunction) => void;
type RequirePermission = (permission: string) => (req: Request, res: Response, next: NextFunction) => void;

export function registerWebServiceAdminRoutes(
  app: Express,
  requireAuth: RequireAuth,
  requirePermission: RequirePermission
): void {
  // === Bundles ===

  app.get("/api/admin/ws-bundles", requireAuth, requirePermission("admin"), async (req, res) => {
    try {
      const bundles = await storage.wsBundles.getAll();
      res.json(bundles);
    } catch (error) {
      console.error("Failed to fetch WS bundles:", error);
      res.status(500).json({ message: "Failed to fetch bundles" });
    }
  });

  app.get("/api/admin/ws-bundles/:id", requireAuth, requirePermission("admin"), async (req, res) => {
    try {
      const bundle = await storage.wsBundles.get(req.params.id);
      if (!bundle) {
        return res.status(404).json({ message: "Bundle not found" });
      }
      res.json(bundle);
    } catch (error) {
      console.error("Failed to fetch WS bundle:", error);
      res.status(500).json({ message: "Failed to fetch bundle" });
    }
  });

  app.post("/api/admin/ws-bundles", requireAuth, requirePermission("admin"), async (req, res) => {
    try {
      const parsed = insertWsBundleSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid bundle data", errors: parsed.error.issues });
      }

      const bundle = await storage.wsBundles.create(parsed.data);
      res.status(201).json(bundle);
    } catch (error: any) {
      console.error("Failed to create WS bundle:", error);
      if (error.code === "23505") {
        return res.status(409).json({ message: "Bundle with this code already exists" });
      }
      res.status(500).json({ message: "Failed to create bundle" });
    }
  });

  app.patch("/api/admin/ws-bundles/:id", requireAuth, requirePermission("admin"), async (req, res) => {
    try {
      const parsed = insertWsBundleSchema.partial().safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid bundle data", errors: parsed.error.issues });
      }

      const bundle = await storage.wsBundles.update(req.params.id, parsed.data);
      if (!bundle) {
        return res.status(404).json({ message: "Bundle not found" });
      }
      res.json(bundle);
    } catch (error) {
      console.error("Failed to update WS bundle:", error);
      res.status(500).json({ message: "Failed to update bundle" });
    }
  });

  app.delete("/api/admin/ws-bundles/:id", requireAuth, requirePermission("admin"), async (req, res) => {
    try {
      const deleted = await storage.wsBundles.delete(req.params.id);
      if (!deleted) {
        return res.status(404).json({ message: "Bundle not found" });
      }
      res.status(204).send();
    } catch (error) {
      console.error("Failed to delete WS bundle:", error);
      res.status(500).json({ message: "Failed to delete bundle" });
    }
  });

  // === Clients ===

  app.get("/api/admin/ws-clients", requireAuth, requirePermission("admin"), async (req, res) => {
    try {
      const clients = await storage.wsClients.getAll();
      res.json(clients);
    } catch (error) {
      console.error("Failed to fetch WS clients:", error);
      res.status(500).json({ message: "Failed to fetch clients" });
    }
  });

  app.get("/api/admin/ws-clients/:id", requireAuth, requirePermission("admin"), async (req, res) => {
    try {
      const client = await storage.wsClients.get(req.params.id);
      if (!client) {
        return res.status(404).json({ message: "Client not found" });
      }
      res.json(client);
    } catch (error) {
      console.error("Failed to fetch WS client:", error);
      res.status(500).json({ message: "Failed to fetch client" });
    }
  });

  app.post("/api/admin/ws-clients", requireAuth, requirePermission("admin"), async (req, res) => {
    try {
      const parsed = insertWsClientSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid client data", errors: parsed.error.issues });
      }

      const client = await storage.wsClients.create(parsed.data);
      res.status(201).json(client);
    } catch (error) {
      console.error("Failed to create WS client:", error);
      res.status(500).json({ message: "Failed to create client" });
    }
  });

  app.patch("/api/admin/ws-clients/:id", requireAuth, requirePermission("admin"), async (req, res) => {
    try {
      const parsed = insertWsClientSchema.partial().safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid client data", errors: parsed.error.issues });
      }

      const client = await storage.wsClients.update(req.params.id, parsed.data);
      if (!client) {
        return res.status(404).json({ message: "Client not found" });
      }
      res.json(client);
    } catch (error) {
      console.error("Failed to update WS client:", error);
      res.status(500).json({ message: "Failed to update client" });
    }
  });

  app.delete("/api/admin/ws-clients/:id", requireAuth, requirePermission("admin"), async (req, res) => {
    try {
      const deleted = await storage.wsClients.delete(req.params.id);
      if (!deleted) {
        return res.status(404).json({ message: "Client not found" });
      }
      res.status(204).send();
    } catch (error) {
      console.error("Failed to delete WS client:", error);
      res.status(500).json({ message: "Failed to delete client" });
    }
  });

  // === Client Credentials ===

  app.get("/api/admin/ws-clients/:clientId/credentials", requireAuth, requirePermission("admin"), async (req, res) => {
    try {
      const credentials = await storage.wsClientCredentials.getByClient(req.params.clientId);
      res.json(credentials.map(c => ({
        id: c.id,
        clientId: c.clientId,
        clientKey: c.clientKey,
        label: c.label,
        isActive: c.isActive,
        expiresAt: c.expiresAt,
        lastUsedAt: c.lastUsedAt,
        createdAt: c.createdAt,
      })));
    } catch (error) {
      console.error("Failed to fetch WS client credentials:", error);
      res.status(500).json({ message: "Failed to fetch credentials" });
    }
  });

  const createCredentialSchema = z.object({
    label: z.string().max(100).optional(),
    expiresAt: z.string().datetime().optional(),
  });

  app.post("/api/admin/ws-clients/:clientId/credentials", requireAuth, requirePermission("admin"), async (req, res) => {
    try {
      const parsed = createCredentialSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid credential data", errors: parsed.error.issues });
      }

      const { label, expiresAt } = parsed.data;
      const result = await storage.wsClientCredentials.create(
        req.params.clientId,
        label,
        expiresAt ? new Date(expiresAt) : undefined
      );

      res.status(201).json({
        id: result.credential.id,
        clientKey: result.clientKey,
        clientSecret: result.clientSecret,
        label: result.credential.label,
        expiresAt: result.credential.expiresAt,
        createdAt: result.credential.createdAt,
        message: "Store the clientSecret securely - it cannot be retrieved again",
      });
    } catch (error) {
      console.error("Failed to create WS client credential:", error);
      res.status(500).json({ message: "Failed to create credential" });
    }
  });

  app.post("/api/admin/ws-credentials/:id/deactivate", requireAuth, requirePermission("admin"), async (req, res) => {
    try {
      const deactivated = await storage.wsClientCredentials.deactivate(req.params.id);
      if (!deactivated) {
        return res.status(404).json({ message: "Credential not found" });
      }
      res.json({ message: "Credential deactivated" });
    } catch (error) {
      console.error("Failed to deactivate WS credential:", error);
      res.status(500).json({ message: "Failed to deactivate credential" });
    }
  });

  app.delete("/api/admin/ws-credentials/:id", requireAuth, requirePermission("admin"), async (req, res) => {
    try {
      const deleted = await storage.wsClientCredentials.delete(req.params.id);
      if (!deleted) {
        return res.status(404).json({ message: "Credential not found" });
      }
      res.status(204).send();
    } catch (error) {
      console.error("Failed to delete WS credential:", error);
      res.status(500).json({ message: "Failed to delete credential" });
    }
  });

  // === IP Rules ===

  app.get("/api/admin/ws-clients/:clientId/ip-rules", requireAuth, requirePermission("admin"), async (req, res) => {
    try {
      const rules = await storage.wsClientIpRules.getByClient(req.params.clientId);
      res.json(rules);
    } catch (error) {
      console.error("Failed to fetch WS IP rules:", error);
      res.status(500).json({ message: "Failed to fetch IP rules" });
    }
  });

  app.post("/api/admin/ws-clients/:clientId/ip-rules", requireAuth, requirePermission("admin"), async (req, res) => {
    try {
      const data = { ...req.body, clientId: req.params.clientId };
      const parsed = insertWsClientIpRuleSchema.safeParse(data);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid IP rule data", errors: parsed.error.issues });
      }

      const rule = await storage.wsClientIpRules.create(parsed.data);
      res.status(201).json(rule);
    } catch (error: any) {
      console.error("Failed to create WS IP rule:", error);
      if (error.code === "23505") {
        return res.status(409).json({ message: "IP rule already exists for this client" });
      }
      res.status(500).json({ message: "Failed to create IP rule" });
    }
  });

  app.patch("/api/admin/ws-ip-rules/:id", requireAuth, requirePermission("admin"), async (req, res) => {
    try {
      const parsed = insertWsClientIpRuleSchema.partial().safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid IP rule data", errors: parsed.error.issues });
      }

      const rule = await storage.wsClientIpRules.update(req.params.id, parsed.data);
      if (!rule) {
        return res.status(404).json({ message: "IP rule not found" });
      }
      res.json(rule);
    } catch (error) {
      console.error("Failed to update WS IP rule:", error);
      res.status(500).json({ message: "Failed to update IP rule" });
    }
  });

  app.delete("/api/admin/ws-ip-rules/:id", requireAuth, requirePermission("admin"), async (req, res) => {
    try {
      const deleted = await storage.wsClientIpRules.delete(req.params.id);
      if (!deleted) {
        return res.status(404).json({ message: "IP rule not found" });
      }
      res.status(204).send();
    } catch (error) {
      console.error("Failed to delete WS IP rule:", error);
      res.status(500).json({ message: "Failed to delete IP rule" });
    }
  });
}
