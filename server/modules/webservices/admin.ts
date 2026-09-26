import type { Express, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { storage } from "../../storage";
import { insertWsClientSchema, insertWsClientIpRuleSchema } from "@shared/schema";
import { entityMetadataStorage } from "../../storage/system/entity-metadata";
import { getEnvironmentVariable } from "../../config/env-registry";
import { runInTransaction } from "../../storage/transaction-context";
import { addDaysYmd, getTodayYmd, isValidYmd, isYmdAfter } from "@shared/utils/date";
import { buildTestRequestHeaders } from "./test-request-auth";
import { executeWsTestHttp } from "./test-request-http";
import { requiresFreemanBearerAuthorization } from "../../middleware/webservice-auth";
import { buildWsTestUrl, DEFAULT_WS_TEST_BASE, isLocalWsTestBase } from "@shared/utils/ws-test-url";
import { sendIfMaintenanceRefusal } from "../../services/maintenance-flag";

type RequireAuth = (req: Request, res: Response, next: NextFunction) => void;
type RequirePermission = (permission: string) => (req: Request, res: Response, next: NextFunction) => void;

/**
 * The usage read's range and filters.
 *
 * Days are Ymd strings all the way through — the counter stores a day, not a
 * timestamp, so nothing here has to decide what a day means.
 */
const statsQuerySchema = z.object({
  start: z.string().refine(isValidYmd, { message: "Expected a YYYY-MM-DD day" }).optional(),
  end: z.string().refine(isValidYmd, { message: "Expected a YYYY-MM-DD day" }).optional(),
  pluginId: z.string().trim().min(1).optional(),
  clientId: z.string().trim().min(1).optional(),
  operation: z.string().trim().min(1).optional(),
});

/** How far back the usage read looks when the caller names no range. */
const DEFAULT_STATS_DAYS = 30;

/**
 * When a record was created and by whom, as these screens show it.
 *
 * None of the four web-service tables keeps a creation date of its own any
 * more; the record's history does, and it also knows the person, which the old
 * columns never did. A record with no history recorded — one made before the
 * tables came under logging and never touched since, or one whose best-effort
 * provenance write did not land — answers with nulls rather than a guess.
 */
interface CreatedStamp {
  date: Date | null;
  personName: string | null;
}

const NO_STAMP: CreatedStamp = { date: null, personName: null };

/** One read of the history of every record a list is about to return. */
async function canViewMetadata(req: Request): Promise<boolean> {
  const user = req.user as any;
  if (!user?.claims) return false;

  const session = req.session as any;
  const { getEffectiveUser } = await import("../masquerade");
  const { dbUser } = await getEffectiveUser(session, user);
  if (!dbUser) return false;

  // Web-service pages are already admin-only. Keep that established admin
  // access while also allowing the dedicated permission for non-admin staff.
  const [canView, isAdmin] = await Promise.all([
    storage.users.userHasPermission(dbUser.id, "metadata.view"),
    storage.users.userHasPermission(dbUser.id, "admin"),
  ]);
  return canView || isAdmin;
}

async function createdStamps(ids: string[], req: Request): Promise<Map<string, CreatedStamp>> {
  if (!(await canViewMetadata(req))) return new Map();
  const views = await entityMetadataStorage.getMany(ids);
  const stamps = new Map<string, CreatedStamp>();
  for (const [id, view] of views) stamps.set(id, view.created);
  return stamps;
}

/** The same, for a single record. */
async function createdStamp(id: string, req: Request): Promise<CreatedStamp> {
  if (!(await canViewMetadata(req))) return NO_STAMP;
  return (await entityMetadataStorage.get(id))?.created ?? NO_STAMP;
}

export function registerWebServiceAdminRoutes(
  app: Express,
  requireAuth: RequireAuth,
  requirePermission: RequirePermission
): void {
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
      res.json({ ...client, created: await createdStamp(client.id, req) });
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
       const stamps = await createdStamps(credentials.map((c) => c.id), req);
      res.json(credentials.map(c => ({
        id: c.id,
        clientId: c.clientId,
        clientKey: c.clientKey,
        label: c.label,
        isActive: c.isActive,
        expiresAt: c.expiresAt,
        lastUsedAt: c.lastUsedAt,
        created: stamps.get(c.id) ?? NO_STAMP,
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

  // === Grants (client → web service configuration) ===

  /**
   * The configurations a client may call. Returns the raw grant rows; the
   * admin UI joins them against the generic web-service config list
   * (`/api/plugins/web-service/configs`) for names, aliases and operations.
   */
  app.get("/api/admin/ws-clients/:clientId/grants", requireAuth, requirePermission("admin"), async (req, res) => {
    try {
      const client = await storage.wsClients.get(req.params.clientId);
      if (!client) {
        return res.status(404).json({ message: "Client not found" });
      }
      const grants = await storage.wsClientGrants.getByClient(req.params.clientId);
      res.json(grants);
    } catch (error) {
      console.error("Failed to fetch WS client grants:", error);
      res.status(500).json({ message: "Failed to fetch grants" });
    }
  });

  const replaceGrantsSchema = z.object({
    configIds: z.array(z.string().min(1)),
  });

  /**
   * Replace a client's entire grant set. Granting and revoking never touches
   * the client's credentials, so a service can be taken away without rotating
   * a key.
   */
  app.put("/api/admin/ws-clients/:clientId/grants", requireAuth, requirePermission("admin"), async (req, res) => {
    try {
      const client = await storage.wsClients.get(req.params.clientId);
      if (!client) {
        return res.status(404).json({ message: "Client not found" });
      }
      const parsed = replaceGrantsSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid grant data", errors: parsed.error.issues });
      }

      // Every id must name an existing web-service configuration. Without
      // this, a typo would be stored as a grant that can never match anything
      // and would look identical to a correctly granted service in the UI.
      const configs = await storage.pluginConfigs.getByKind("web-service");
      const known = new Set(configs.map((c) => c.id));
      const unknown = parsed.data.configIds.filter((id) => !known.has(id));
      if (unknown.length > 0) {
        return res.status(400).json({
          message: `Not a web service configuration: ${unknown.join(", ")}`,
        });
      }

      const grants = await runInTransaction(() =>
        storage.wsClientGrants.replaceForClient(req.params.clientId, parsed.data.configIds),
      );
      res.json(grants);
    } catch (error) {
      console.error("Failed to update WS client grants:", error);
      res.status(500).json({ message: "Failed to update grants" });
    }
  });

  // === API document ===

  /**
   * The generated OpenAPI document for one client. Built by the SAME builder
   * the swagger web service uses, so what an administrator downloads here is
   * exactly what an integrator granted that service fetches for themselves.
   */
  app.get("/api/admin/ws-clients/:clientId/openapi", requireAuth, requirePermission("admin"), async (req, res) => {
    try {
      const client = await storage.wsClients.get(req.params.clientId);
      if (!client) {
        return res.status(404).json({ message: "Client not found" });
      }
      const { buildClientOpenApiDocument } = await import("./openapi");
      res.json(await buildClientOpenApiDocument(client));
    } catch (error) {
      console.error("Failed to build WS client API document:", error);
      res.status(500).json({ message: "Failed to build API document" });
    }
  });

  // === IP Rules ===

  app.get("/api/admin/ws-clients/:clientId/ip-rules", requireAuth, requirePermission("admin"), async (req, res) => {
    try {
      const rules = await storage.wsClientIpRules.getByClient(req.params.clientId);
       const stamps = await createdStamps(rules.map((r) => r.id), req);
      res.json(rules.map((rule) => ({ ...rule, created: stamps.get(rule.id) ?? NO_STAMP })));
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

  // === Test Execution ===

  const testRequestSchema = z.object({
    clientKey: z.string().min(1, "Client ID is required").max(8192),
    clientSecret: z.string().max(8192).optional().default(""),
    bearerToken: z.string().max(8192, "Bearer token is too long").optional(),
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
    baseUrl: z.string().max(2048).optional().default(DEFAULT_WS_TEST_BASE),
    /** Configuration id (or alias) — the first segment of the public URL. */
    configRef: z.string().min(1, "Configuration is required").max(200),
    /** Declared operation name — the second segment of the public URL. */
    operation: z.string().min(1, "Operation is required").max(200),
    queryParams: z.record(z.string().max(4096)).optional(),
    body: z.unknown().optional(),
  });

  app.post("/api/admin/ws-clients/:id/test", requireAuth, requirePermission("admin"), async function executeWebServiceTestRequest(req, res) {
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

      const { clientKey, clientSecret, bearerToken, method, configRef, operation, queryParams, body, baseUrl } = parseResult.data;
      const local = isLocalWsTestBase(baseUrl);
      let target: string;
      try {
        target = buildWsTestUrl(
          baseUrl, configRef, operation, queryParams,
          local ? `http://127.0.0.1:${getEnvironmentVariable("PORT") || 5000}` : "",
        );
      } catch (error) {
        return res.status(400).json({ message: error instanceof Error ? error.message : "Invalid base URL" });
      }
      const requestBody = body !== undefined && ["POST", "PUT", "PATCH"].includes(method)
        ? JSON.stringify(body)
        : undefined;
      if ((requestBody?.length ?? 0) > 128 * 1024 || target.length > 8192) {
        return res.status(400).json({ message: "The test request is too large" });
      }

      // A remote instance is the authority on its own credentials, client
      // status, grants, and service availability. Never count that traffic as
      // local usage or make a remote credential pass this database's checks.
      let credentialId: string | undefined;
      if (local) {
      // Freeman bearer is the sole checked credential for configured clients.
      // Its client id is only a selector, so no secret or credential-active
      // check may turn it back into a second factor.
      const usesFreemanBearer = requiresFreemanBearerAuthorization(client);
      const validation = usesFreemanBearer
        ? { valid: true, credential: await storage.wsClientCredentials.getByClientKey(clientKey) }
        : await storage.wsClientCredentials.validateSecret(clientKey, clientSecret);
      if (!validation.valid || !validation.credential) {
        return res.json({
          success: false,
          status: 401,
          error: "Invalid credentials",
          message: usesFreemanBearer
            ? "The provided client ID is incorrect"
            : "The provided client ID or secret is incorrect",
          duration: Date.now() - startTime,
        });
      }

      if (!usesFreemanBearer && !validation.credential.isActive) {
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
      credentialId = validation.credential.id;
      }

      // Make the internal request with auth headers
      const headers = buildTestRequestHeaders(client, clientKey, clientSecret, bearerToken);
      let response;
      try {
        response = await executeWsTestHttp(target, method, headers, requestBody, local);
      } catch (error) {
        if (sendIfMaintenanceRefusal(res, error)) return;
        // Do not relay low-level errors: they can contain the target address,
        // request data, or credential fragments. Known refusal messages are
        // fixed strings; everything else is a connection failure.
        const message = error instanceof Error && [
          "Private or local targets are not allowed",
          "Request timed out",
          "Response is too large (1 MB limit)",
        ].includes(error.message) ? error.message : "Could not connect to the selected server";
        return res.json({
          success: false, status: 0, error: "Request failed", message,
          duration: Date.now() - startTime,
          requestInfo: { method, url: local ? new URL(target).pathname + new URL(target).search : target },
        });
      }

      if (credentialId) await storage.wsClientCredentials.recordUsage(credentialId);
      // A remote service may echo credentials in its reply. Do not return or
      // log those echoes via the admin test response.
      const scrub = (text: string) => [clientKey, clientSecret, bearerToken]
        .filter((value): value is string => Boolean(value && value.length >= 3))
        .reduce((result, value) => result
          .replaceAll(value, "[REDACTED]")
          .replaceAll(encodeURIComponent(value), "[REDACTED]"), text);
      const safeData = typeof response.data === "string"
        ? scrub(response.data)
        : JSON.parse(scrub(JSON.stringify(response.data)));
      const safeHeaders = Object.fromEntries(
        Object.entries(response.headers).map(([key, value]) => [key, scrub(value)]),
      );

      res.json({
        success: response.status >= 200 && response.status < 300,
        status: response.status,
        statusText: scrub(response.statusText),
        headers: safeHeaders,
        data: safeData,
        duration: Date.now() - startTime,
        requestInfo: {
          method,
          url: local ? new URL(target).pathname + new URL(target).search : target,
        },
      });
    } catch (error) {
      // Never log a request containing admin-entered credentials.
      res.json({
        success: false,
        status: 500,
        error: "Internal error",
        message: "Unable to complete the test request",
        duration: Date.now() - startTime,
      });
    }
  });

  // === Usage ===

  // How many calls we served, per day and per dimension.
  //
  // The counts come from `ws_stats`, not from the request log: the log is
  // per-request and pruned on a retention schedule, so it stops being able to
  // answer "how much did this partner use us last quarter" the moment the
  // window closes.
  //
  // The figures are asked for as one report rather than gathered here, because
  // they are read as one account of the same traffic: the counter storage
  // reads them in a single snapshot and rolls the breakdowns up from one
  // grouped read, so a call arriving mid-request cannot land in the chart but
  // not the totals beneath it.
  //
  // The filter catalogue is the deliberate exception. It says which
  // combinations have ever been counted, not how many, so it does not have to
  // agree with anything and is read outside that snapshot.
  app.get("/api/admin/ws-stats", requireAuth, requirePermission("admin"), async (req, res) => {
    const parsed = statsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ message: "Invalid query parameters", errors: parsed.error.issues });
    }
    try {
      const end = parsed.data.end ?? getTodayYmd();
      const start = parsed.data.start ?? addDaysYmd(end, -(DEFAULT_STATS_DAYS - 1));
      if (isYmdAfter(start, end)) {
        return res.status(400).json({ message: "The range starts after it ends" });
      }

      const { pluginId, clientId, operation } = parsed.data;
      const range = { start, end, pluginId, clientId, operation };
      const [report, dimensions, clients] = await Promise.all([
        storage.wsStats.report(range),
        storage.wsStats.listDimensions(),
        storage.wsClients.getAll(),
      ]);

      // Clients are named, not numbered. A counted call always has a client
      // that still exists — the counter's rows are removed with the client
      // they belong to — but this stays defensive rather than asserting it,
      // because a usage screen that throws is worse than one that shows an id.
      const nameById = new Map(clients.map((client) => [client.id, client.name]));
      const named = (id: string) => nameById.get(id) ?? id;

      res.json({
        start,
        end,
        // Only the days that have calls. The range is stated above so the
        // caller can fill the silent days itself rather than being handed a
        // gap it has to guess the meaning of.
        days: report.days,
        total: report.total,
        byPlugin: report.byPlugin,
        byPluginOperation: report.byPluginOperation,
        byClient: report.byClient.map((row) => ({ ...row, clientName: named(row.clientId) })),
        // Every combination ever counted, for the filters — read from the
        // counts rather than the plugin registry, so an operation a release has
        // since retired stays selectable and its calls stay accounted for.
        dimensions: dimensions.map((row) => ({ ...row, clientName: named(row.clientId) })),
      });
    } catch (error) {
      console.error("Failed to read web service call stats:", error);
      res.status(500).json({ message: "Failed to read call stats" });
    }
  });
}
