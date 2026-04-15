import type { Express, Request, Response, NextFunction } from "express";
import { randomBytes } from "crypto";
import { requireComponent } from "../../../components";
import { z } from "zod";

type AuthMiddleware = (req: Request, res: Response, next: NextFunction) => void | Promise<any>;
type PermissionMiddleware = (permissionKey: string) => (req: Request, res: Response, next: NextFunction) => void | Promise<any>;

interface T631Config {
  url: string;
  accountId: string;
  accessToken: string;
  employerId: string;
  employerToken: string;
}

interface T631RequestDiagnostics {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown[];
}

interface T631ResponseDiagnostics {
  status: number;
  statusText: string;
  headers: Record<string, string>;
}

interface T631FetchResult {
  success: boolean;
  action: string;
  request: T631RequestDiagnostics;
  response?: T631ResponseDiagnostics;
  data?: unknown;
  rawBody?: string;
  error?: string;
  timestamp: string;
  durationMs: number;
}

function getConfig(): T631Config {
  const url = process.env.SITESPECIFIC_T631_CLIENT_URL;
  const accountId = process.env.SITESPECIFIC_T631_CLIENT_ACCOUNT_ID;
  const accessToken = process.env.SITESPECIFIC_T631_CLIENT_ACCESS_TOKEN;
  const employerId = process.env.SITESPECIFIC_T631_CLIENT_EMPLOYER_ID;
  const employerToken = process.env.SITESPECIFIC_T631_CLIENT_EMPLOYER_TOKEN;

  if (!url || !accountId || !accessToken || !employerId || !employerToken) {
    const missing = [];
    if (!url) missing.push("SITESPECIFIC_T631_CLIENT_URL");
    if (!accountId) missing.push("SITESPECIFIC_T631_CLIENT_ACCOUNT_ID");
    if (!accessToken) missing.push("SITESPECIFIC_T631_CLIENT_ACCESS_TOKEN");
    if (!employerId) missing.push("SITESPECIFIC_T631_CLIENT_EMPLOYER_ID");
    if (!employerToken) missing.push("SITESPECIFIC_T631_CLIENT_EMPLOYER_TOKEN");
    throw new Error(`Missing T631 client configuration: ${missing.join(", ")}`);
  }

  return { url, accountId, accessToken, employerId, employerToken };
}

function maskCredential(value: string): string {
  if (value.length <= 8) return "****";
  return value.substring(0, 4) + "****" + value.substring(value.length - 4);
}

const VALID_ACTIONS = [
  "sirius_service_ping",
  "sirius_edls_server_worker_list",
  "sirius_dispatch_group_search",
  "sirius_dispatch_facility_dropdown",
  "sirius_edls_server_tos_list",
] as const;

type T631Action = typeof VALID_ACTIONS[number];

export async function t631Fetch(action: T631Action): Promise<T631FetchResult> {
  const startTime = Date.now();
  const timestamp = new Date().toISOString();

  const config = getConfig();

  const basicAuth = Buffer.from(`${config.accountId}:${config.accessToken}`).toString("base64");

  let requestBody: unknown[];
  let diagnosticsBody: unknown[];

  if (action === "sirius_service_ping") {
    const echoText = randomBytes(6).toString("hex");
    requestBody = [action, "Echo Text Follows", echoText];
    diagnosticsBody = [action, "Echo Text Follows", echoText];
  } else if (action === "sirius_dispatch_group_search") {
    const ts = Math.floor(Date.now() / 1000);
    const innerPayload = ["sirius_dispatch_group_search", { domain_root: 1, limit: 500, ts }];
    requestBody = [action, innerPayload];
    diagnosticsBody = [action, innerPayload];
  } else {
    requestBody = [action, config.employerId, config.employerToken];
    diagnosticsBody = [action, maskCredential(config.employerId), maskCredential(config.employerToken)];
  }

  const requestDiagnostics: T631RequestDiagnostics = {
    url: config.url,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Basic ${maskCredential(basicAuth)}`,
    },
    body: diagnosticsBody,
  };

  try {
    const response = await fetch(config.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Basic ${basicAuth}`,
      },
      body: JSON.stringify(requestBody),
    });

    const durationMs = Date.now() - startTime;

    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    const responseDiagnostics: T631ResponseDiagnostics = {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    };

    const rawBody = await response.text().catch(() => "");

    let parsedData: unknown = undefined;
    try {
      parsedData = JSON.parse(rawBody);
    } catch {
      // not JSON
    }

    return {
      success: response.ok,
      action,
      request: requestDiagnostics,
      response: responseDiagnostics,
      data: parsedData,
      rawBody: parsedData === undefined ? rawBody : undefined,
      error: !response.ok ? `HTTP ${response.status} ${response.statusText}` : undefined,
      timestamp,
      durationMs,
    };
  } catch (error) {
    const durationMs = Date.now() - startTime;
    return {
      success: false,
      action,
      request: requestDiagnostics,
      error: error instanceof Error ? error.message : "Unknown error",
      timestamp,
      durationMs,
    };
  }
}

const fetchRequestSchema = z.object({
  action: z.enum(VALID_ACTIONS),
});

export function registerT631ClientFetchRoutes(
  app: Express,
  requireAuth: AuthMiddleware,
  requirePermission: PermissionMiddleware
) {
  const edlsComponent = requireComponent("edls");
  const t631Component = requireComponent("sitespecific.t631.client");

  app.post(
    "/api/sitespecific/t631/client/fetch",
    requireAuth,
    requirePermission("admin"),
    edlsComponent,
    t631Component,
    async (req: Request, res: Response) => {
      try {
        const parsed = fetchRequestSchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({
            message: `Invalid request: ${parsed.error.errors.map(e => e.message).join(", ")}`,
            validActions: [...VALID_ACTIONS],
          });
        }

        const { action } = parsed.data;
        const result = await t631Fetch(action);

        res.json(result);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to execute T631 fetch";
        res.status(500).json({ message });
      }
    }
  );
}
