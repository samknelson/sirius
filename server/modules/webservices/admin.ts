import type { Express, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { storage } from "../../storage";
import { insertWsBundleSchema, insertWsClientSchema, insertWsClientIpRuleSchema } from "@shared/schema";

export interface BundleEndpointMetadata {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  description: string;
  sampleParams?: Record<string, string>;
  sampleBody?: Record<string, unknown>;
}

const bundleEndpointsRegistry: Record<string, BundleEndpointMetadata[]> = {
  edls: [
    {
      method: "GET",
      path: "/sheets",
      description: "List EDLS sheets with optional filters",
      sampleParams: {
        status: "active",
        page: "1",
        limit: "20",
      },
    },
    {
      method: "GET",
      path: "/sheets/:id",
      description: "Get a specific EDLS sheet by ID",
      sampleParams: {
        id: "<sheet-uuid>",
      },
    },
  ],
};

export function registerBundleEndpoints(bundleCode: string, endpoints: BundleEndpointMetadata[]): void {
  bundleEndpointsRegistry[bundleCode] = endpoints;
}

export function getBundleEndpoints(bundleCode: string): BundleEndpointMetadata[] {
  return bundleEndpointsRegistry[bundleCode] || [];
}

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

  app.post("/api/admin/ws-credentials/:id/reactivate", requireAuth, requirePermission("admin"), async (req, res) => {
    try {
      const reactivated = await storage.wsClientCredentials.reactivate(req.params.id);
      if (!reactivated) {
        return res.status(404).json({ message: "Credential not found" });
      }
      res.json({ message: "Credential reactivated" });
    } catch (error) {
      console.error("Failed to reactivate WS credential:", error);
      res.status(500).json({ message: "Failed to reactivate credential" });
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

  // === Bundle Endpoints Metadata ===

  app.get("/api/admin/ws-bundles/:id/endpoints", requireAuth, requirePermission("admin"), async (req, res) => {
    try {
      const bundle = await storage.wsBundles.get(req.params.id);
      if (!bundle) {
        return res.status(404).json({ message: "Bundle not found" });
      }
      const endpoints = getBundleEndpoints(bundle.code);
      res.json({ bundleCode: bundle.code, basePath: `/api/ws/${bundle.code}`, endpoints });
    } catch (error) {
      console.error("Failed to get bundle endpoints:", error);
      res.status(500).json({ message: "Failed to get bundle endpoints" });
    }
  });

  // === Test Execution ===

  const testRequestSchema = z.object({
    clientKey: z.string().min(1, "Client key is required"),
    clientSecret: z.string().min(1, "Client secret is required"),
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
    path: z.string().min(1, "Path is required"),
    queryParams: z.record(z.string()).optional(),
    body: z.unknown().optional(),
  });

  app.post("/api/admin/ws-clients/:id/test", requireAuth, requirePermission("admin"), async (req, res) => {
    const startTime = Date.now();
    
    try {
      const client = await storage.wsClients.get(req.params.id);
      if (!client) {
        return res.status(404).json({ message: "Client not found" });
      }

      const parseResult = testRequestSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({
          message: "Invalid request",
          errors: parseResult.error.issues.map(i => ({ field: i.path.join("."), message: i.message })),
        });
      }

      const { clientKey, clientSecret, method, path, queryParams, body } = parseResult.data;

      // Validate the credentials
      const validation = await storage.wsClientCredentials.validateSecret(clientKey, clientSecret);
      if (!validation.valid) {
        return res.json({
          success: false,
          status: 401,
          error: "Invalid credentials",
          message: "The provided client key or secret is incorrect",
          duration: Date.now() - startTime,
        });
      }

      if (!validation.credential?.isActive) {
        return res.json({
          success: false,
          status: 401,
          error: "Credential inactive",
          message: "The credential is not active",
          duration: Date.now() - startTime,
        });
      }

      // Check if credential belongs to this client
      if (validation.credential.clientId !== client.id) {
        return res.json({
          success: false,
          status: 401,
          error: "Credential mismatch",
          message: "The credential does not belong to this client",
          duration: Date.now() - startTime,
        });
      }

      // Check client status
      if (client.status !== "active") {
        return res.json({
          success: false,
          status: 403,
          error: "Client inactive",
          message: `Client is ${client.status}`,
          duration: Date.now() - startTime,
        });
      }

      // Get the bundle to construct the URL
      const bundle = await storage.wsBundles.get(client.bundleId);
      if (!bundle) {
        return res.json({
          success: false,
          status: 500,
          error: "Bundle not found",
          message: "The client's bundle configuration is missing",
          duration: Date.now() - startTime,
        });
      }

      // Construct the internal URL
      const basePath = `/api/ws/${bundle.code}`;
      const fullPath = `${basePath}${path.startsWith("/") ? path : "/" + path}`;
      
      // Build query string
      const queryString = queryParams && Object.keys(queryParams).length > 0
        ? "?" + new URLSearchParams(queryParams).toString()
        : "";
      
      const internalUrl = `http://localhost:${process.env.PORT || 5000}${fullPath}${queryString}`;

      // Make the internal request with auth headers
      const headers: Record<string, string> = {
        "X-WS-Client-Key": clientKey,
        "X-WS-Client-Secret": clientSecret,
        "Content-Type": "application/json",
      };

      const fetchOptions: RequestInit = {
        method,
        headers,
      };

      if (body && ["POST", "PUT", "PATCH"].includes(method)) {
        fetchOptions.body = JSON.stringify(body);
      }

      const response = await fetch(internalUrl, fetchOptions);
      const responseText = await response.text();
      
      let responseData: unknown;
      try {
        responseData = JSON.parse(responseText);
      } catch {
        responseData = responseText;
      }

      // Record credential usage
      await storage.wsClientCredentials.recordUsage(validation.credential.id);

      res.json({
        success: response.ok,
        status: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries(response.headers.entries()),
        data: responseData,
        duration: Date.now() - startTime,
        requestInfo: {
          method,
          url: fullPath + queryString,
        },
      });
    } catch (error) {
      console.error("Failed to execute test request:", error);
      res.json({
        success: false,
        status: 500,
        error: "Internal error",
        message: error instanceof Error ? error.message : "An unexpected error occurred",
        duration: Date.now() - startTime,
      });
    }
  });
}
